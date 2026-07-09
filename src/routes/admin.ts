/**
 * /admin — Lorena's side. Basic auth, plain forms, POST→redirect→GET.
 * Phone-first and jargon-free: "appointments" and "times", not slots/bookings.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { basicAuth } from "hono/basic-auth";
import type { Bindings } from "../env";
import { layout } from "../layout";
import { formatPence } from "../types";
import {
  formatLondon,
  formatLondonDay,
  formatLondonTime,
  londonToEpoch,
  nowEpoch,
} from "../lib/time";
import {
  cancelBooking,
  createSlot,
  getBookingById,
  listSlotsAdmin,
  listUpcomingBookings,
  setSlotStatus,
} from "../lib/db";
import { refundDeposit, stripeClient } from "../lib/stripe";
import { sendCancellationEmails } from "../lib/email";

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "*",
  basicAuth({
    verifyUser: (_user, pass, c) => pass === (c.env as Bindings).ADMIN_PASSWORD,
    realm: "Red Rose admin",
  })
);

// Banner messages, keyed by ?msg= on the redirect target.
const MESSAGES: Record<string, { text: string; isError: boolean }> = {
  created: { text: "Time added ✓", isError: false },
  blocked: { text: "Time blocked — clients can't book it now.", isError: false },
  unblocked: { text: "Time reopened ✓", isError: false },
  cancelled: {
    text: "Appointment cancelled and the deposit refunded. The client has been emailed.",
    isError: false,
  },
  bad_time: { text: "Please pick a date, a start time and an end time.", isError: true },
  backwards: { text: "The end time needs to be after the start time.", isError: true },
  past: { text: "That time is in the past — please pick a future date.", isError: true },
  has_booking: {
    text: "That time has an appointment on it, so it can't be blocked. Cancel the appointment first.",
    isError: true,
  },
  cancel_failed: {
    text: "Couldn't cancel that appointment — it may already be cancelled. Refresh and check.",
    isError: true,
  },
  refund_failed: {
    text: "The refund didn't go through, so nothing was cancelled. Try again in a few minutes.",
    isError: true,
  },
};

const banner = (msgKey: string | undefined) => {
  const msg = MESSAGES[msgKey ?? ""];
  if (!msg) return "";
  return html`<p
    class="${msg.isError
      ? "mt-6 rounded border border-crimson/40 bg-crimson/10 px-4 py-3 text-crimson"
      : "mt-6 rounded border border-teal/40 bg-teal/10 px-4 py-3 text-teal"}"
    role="${msg.isError ? "alert" : "status"}"
  >
    ${msg.text}
  </p>`;
};

const adminPage = (
  title: string,
  active: "appointments" | "times",
  body: unknown
) =>
  layout(
    title,
    html`
      <main class="mx-auto max-w-2xl px-6 py-10">
        <p class="text-sm opacity-60">Red Rose admin</p>
        <nav class="mt-2 flex gap-3">
          <a
            href="/admin"
            class="${active === "appointments"
              ? "rounded bg-crimson px-4 py-2 font-medium text-cream"
              : "rounded border border-teal/50 px-4 py-2 text-teal"}"
          >
            Appointments
          </a>
          <a
            href="/admin/times"
            class="${active === "times"
              ? "rounded bg-crimson px-4 py-2 font-medium text-cream"
              : "rounded border border-teal/50 px-4 py-2 text-teal"}"
          >
            Times
          </a>
        </nav>
        ${body}
      </main>
    `
  );

// ---------- appointments ----------
app.get("/", async (c) => {
  const bookings = await listUpcomingBookings(c.env.DB, nowEpoch());

  return c.html(
    adminPage(
      "Appointments",
      "appointments",
      html`
        ${banner(c.req.query("msg"))}
        <h1 class="mt-6 font-display text-2xl font-bold text-crimson">
          Upcoming appointments
        </h1>
        ${bookings.length === 0
          ? html`<p class="mt-4 opacity-70">Nothing booked yet.</p>`
          : html`
              <ul class="mt-4 space-y-3">
                ${bookings.map(
                  (b) => html`
                    <li class="rounded border border-teal/30 bg-white/60 p-4">
                      <p class="font-medium">${formatLondon(b.slotStartsAt)}</p>
                      <p class="mt-1">${b.serviceName}</p>
                      <p class="mt-1 text-sm">
                        ${b.clientName} ·
                        <a class="text-teal underline" href="mailto:${b.clientEmail}"
                          >${b.clientEmail}</a
                        >
                        ${b.clientPhone
                          ? html` ·
                              <a class="text-teal underline" href="tel:${b.clientPhone}"
                                >${b.clientPhone}</a
                              >`
                          : ""}
                      </p>
                      ${b.status === "pending_payment"
                        ? html`<p class="mt-2 text-sm italic opacity-70">
                            Paying now — not confirmed yet
                          </p>`
                        : html`
                            <p class="mt-1 text-sm opacity-70">
                              Deposit paid: ${formatPence(b.depositPence)}
                            </p>
                            <form
                              method="post"
                              action="/admin/appointments/${b.id}/cancel"
                              class="mt-3"
                              onsubmit="return confirm('Cancel this appointment and refund the deposit?')"
                            >
                              <button
                                type="submit"
                                class="rounded border border-crimson px-4 py-2 text-sm text-crimson"
                              >
                                Cancel &amp; refund deposit
                              </button>
                            </form>
                          `}
                    </li>
                  `
                )}
              </ul>
            `}
      `
    )
  );
});

// Admin cancellation: no 48h cutoff — Lorena is doing the cancelling, so the
// client always gets their deposit back. (Revisit if she ever needs to
// cancel-without-refund, e.g. no-show policy enforcement.)
app.post("/appointments/:id/cancel", async (c) => {
  const booking = await getBookingById(c.env.DB, c.req.param("id"));
  if (!booking || booking.status !== "confirmed") {
    return c.redirect("/admin?msg=cancel_failed", 303);
  }
  if (!booking.stripePaymentIntent) {
    console.error(`booking ${booking.id} confirmed without a payment intent`);
    return c.redirect("/admin?msg=refund_failed", 303);
  }

  const stripe = stripeClient(c.env.STRIPE_SECRET_KEY);
  const refund = await refundDeposit(stripe, booking.stripePaymentIntent);
  if (!refund.ok) {
    console.error("admin refund failed:", refund.error);
    return c.redirect("/admin?msg=refund_failed", 303);
  }

  await cancelBooking(c.env.DB, booking.id);
  c.executionCtx.waitUntil(
    sendCancellationEmails(c.env.RESEND_API_KEY, booking, true)
  );
  return c.redirect("/admin?msg=cancelled", 303);
});

// ---------- times ----------
app.get("/times", async (c) => {
  const slots = await listSlotsAdmin(c.env.DB, nowEpoch());

  return c.html(
    adminPage(
      "Times",
      "times",
      html`
        ${banner(c.req.query("msg"))}

        <h1 class="mt-6 font-display text-2xl font-bold text-crimson">
          Add a time
        </h1>
        <p class="mt-1 text-sm opacity-70">
          Clients can book any open time. Make it as long as the treatment
          needs — one appointment per time.
        </p>
        <form method="post" action="/admin/times" class="mt-4 space-y-4">
          <label class="block">
            <span class="text-sm">Date</span>
            <input
              type="date"
              name="date"
              required
              class="mt-1 w-full rounded border border-teal/50 bg-white px-3 py-2"
            />
          </label>
          <div class="flex gap-4">
            <label class="block flex-1">
              <span class="text-sm">From</span>
              <input
                type="time"
                name="start"
                required
                class="mt-1 w-full rounded border border-teal/50 bg-white px-3 py-2"
              />
            </label>
            <label class="block flex-1">
              <span class="text-sm">Until</span>
              <input
                type="time"
                name="end"
                required
                class="mt-1 w-full rounded border border-teal/50 bg-white px-3 py-2"
              />
            </label>
          </div>
          <button
            type="submit"
            class="w-full rounded bg-crimson px-6 py-3 font-medium text-cream"
          >
            Add time
          </button>
        </form>

        <h1 class="mt-10 font-display text-2xl font-bold text-crimson">
          Your times
        </h1>
        ${slots.length === 0
          ? html`<p class="mt-4 opacity-70">No upcoming times yet.</p>`
          : html`
              <ul class="mt-4 space-y-3">
                ${slots.map((s) => {
                  const state = s.booking_id
                    ? s.booking_status === "confirmed"
                      ? html`<span class="text-sm font-medium text-crimson"
                          >Booked — ${s.client_name}</span
                        >`
                      : html`<span class="text-sm italic opacity-70"
                          >Being booked right now…</span
                        >`
                    : s.status === "blocked"
                      ? html`<span class="text-sm opacity-70">Blocked</span>`
                      : html`<span class="text-sm text-teal">Open</span>`;
                  return html`
                    <li
                      class="flex items-center justify-between gap-3 rounded border border-teal/30 bg-white/60 p-4"
                    >
                      <div>
                        <p class="font-medium">${formatLondonDay(s.starts_at)}</p>
                        <p class="text-sm">
                          ${formatLondonTime(s.starts_at)}&thinsp;–&thinsp;${formatLondonTime(s.ends_at)}
                          · ${state}
                        </p>
                      </div>
                      ${!s.booking_id
                        ? html`
                            <form
                              method="post"
                              action="/admin/times/${s.id}/${s.status === "blocked"
                                ? "unblock"
                                : "block"}"
                            >
                              <button
                                type="submit"
                                class="shrink-0 rounded border border-teal/50 px-4 py-2 text-sm text-teal"
                              >
                                ${s.status === "blocked" ? "Reopen" : "Block"}
                              </button>
                            </form>
                          `
                        : ""}
                    </li>
                  `;
                })}
              </ul>
            `}
      `
    )
  );
});

app.post("/times", async (c) => {
  const body = await c.req.parseBody();
  const date = String(body["date"] ?? "");
  const start = String(body["start"] ?? "");
  const end = String(body["end"] ?? "");

  const startsAt = londonToEpoch(date, start);
  const endsAt = londonToEpoch(date, end);
  if (startsAt === null || endsAt === null) {
    return c.redirect("/admin/times?msg=bad_time", 303);
  }
  if (endsAt <= startsAt) {
    return c.redirect("/admin/times?msg=backwards", 303);
  }
  if (startsAt <= nowEpoch()) {
    return c.redirect("/admin/times?msg=past", 303);
  }

  await createSlot(c.env.DB, startsAt, endsAt);
  return c.redirect("/admin/times?msg=created", 303);
});

app.post("/times/:id/block", async (c) => {
  const ok = await setSlotStatus(c.env.DB, Number(c.req.param("id")), "blocked");
  return c.redirect(`/admin/times?msg=${ok ? "blocked" : "has_booking"}`, 303);
});

app.post("/times/:id/unblock", async (c) => {
  const ok = await setSlotStatus(c.env.DB, Number(c.req.param("id")), "open");
  return c.redirect(`/admin/times?msg=${ok ? "unblocked" : "has_booking"}`, 303);
});

export default app;
