/**
 * /admin — Lorena's diary. Implements "Admin.dc.html" from Kate's Claude
 * Design project: two-tab phone-first layout (Appointments / Times), paper
 * cards, PRG banners with a dismiss ×. Basic auth, plain forms — all the
 * M3 logic (refunds, validation, block guards) unchanged.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import { basicAuth } from "hono/basic-auth";
import type { Bindings } from "../env";
import { layout } from "../layout";
import { formatPence } from "../types";
import {
  formatLondonDayShort,
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
  blocked: { text: "Time blocked — no one can book it ✓", isError: false },
  unblocked: { text: "Time reopened ✓", isError: false },
  cancelled: {
    text: "Cancelled — the deposit has been refunded and the client emailed ✓",
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

// ---------- chrome (Admin.dc.html) ----------

const badgeBase =
  "whitespace-nowrap px-[9px] py-[5px] text-[10px] font-semibold uppercase tracking-[.18em]";
const badge = (
  label: string,
  tone: "teal" | "crimson" | "muted" | "solid"
) => html`
  <span
    class="${badgeBase} ${tone === "teal"
      ? "border border-teal/50 text-teal"
      : tone === "crimson"
        ? "border border-crimson/50 text-crimson"
        : tone === "muted"
          ? "border border-ink/35 text-ink/60"
          : "bg-crimson text-cream"}"
    >${label}</span
  >
`;

const adminShell = (
  title: string,
  active: "appointments" | "times",
  msgKey: string | undefined,
  body: unknown
) => {
  const msg = MESSAGES[msgKey ?? ""];
  const here = active === "appointments" ? "/admin" : "/admin/times";
  const tab = (href: string, label: string, on: boolean, extra = "") => html`
    <a
      href="${href}"
      class="flex min-h-[54px] items-center justify-center border border-crimson text-[12px] uppercase tracking-[.2em] no-underline ${extra} ${on
        ? "bg-crimson font-semibold text-cream"
        : "font-medium text-crimson hover:bg-crimson/5"}"
      >${label}</a
    >
  `;
  return layout(
    title,
    html`
      <div class="mx-auto flex min-h-screen w-full max-w-[420px] flex-col">
        <header class="flex items-baseline justify-between px-5 pb-3.5 pt-[18px]">
          <span class="font-display text-[18px] font-semibold italic text-crimson"
            >Red Rose</span
          >
          <span class="text-[10px] uppercase tracking-[.22em] text-ink"
            >Lorena&rsquo;s diary</span
          >
        </header>

        <nav class="grid grid-cols-2">
          ${tab("/admin", "Appointments", active === "appointments", "border-r-0")}
          ${tab("/admin/times", "Times", active === "times")}
        </nav>

        ${msg
          ? html`
              <div
                role="${msg.isError ? "alert" : "status"}"
                class="flex items-center justify-between gap-2.5 border-b px-4 py-3 ${msg.isError
                  ? "border-crimson bg-crimson/10 text-crimson"
                  : "border-teal bg-teal/10 text-teal"}"
              >
                <span class="text-[13px] font-semibold tracking-[.06em]">${msg.text}</span>
                <a
                  href="${here}"
                  aria-label="Dismiss"
                  class="px-2 py-1 text-[16px] no-underline ${msg.isError
                    ? "text-crimson"
                    : "text-teal"}"
                  >&times;</a
                >
              </div>
            `
          : ""}

        <main class="flex flex-1 flex-col px-5 pb-10 pt-6">${body}</main>
      </div>
    `
  );
};

const cardClass =
  "flex flex-col border border-crimson/35 bg-paper";
const capsLine = "text-[12px] font-semibold uppercase tracking-[.18em] text-ink";
const contactChip =
  "inline-flex min-h-[44px] items-center border border-teal/50 px-3.5 text-[13px] tracking-[.03em] text-teal no-underline";

// ---------- appointments ----------

app.get("/", async (c) => {
  const bookings = await listUpcomingBookings(c.env.DB, nowEpoch());

  return c.html(
    adminShell(
      "Appointments",
      "appointments",
      c.req.query("msg"),
      html`
        <h1 class="font-display m-0 text-[28px] font-medium italic text-ink">
          Coming up
        </h1>

        ${bookings.length === 0
          ? html`<p class="m-0 mt-4 text-[15px] text-ink/70">
              Nothing booked yet — when someone books, it appears here.
            </p>`
          : html`
              <div class="mt-[18px] flex flex-col gap-4">
                ${bookings.map(
                  (b) => html`
                    <article class="${cardClass} gap-3 px-4 py-[18px]">
                      <div class="flex flex-wrap items-baseline justify-between gap-2.5">
                        <span class="${capsLine} whitespace-nowrap"
                          >${formatLondonDayShort(b.slotStartsAt)} ·
                          ${formatLondonTime(b.slotStartsAt)} –
                          ${formatLondonTime(b.slotEndsAt)}</span
                        >
                        ${b.status === "confirmed"
                          ? badge("Deposit paid", "teal")
                          : badge("Paying now — not confirmed yet", "crimson")}
                      </div>
                      <div class="flex flex-col gap-[3px]">
                        <span class="font-display text-[19px] italic text-ink"
                          >${b.serviceName}</span
                        >
                        <span class="text-[15px] text-ink">${b.clientName}</span>
                      </div>
                      <div class="flex flex-wrap gap-2.5">
                        <a href="mailto:${b.clientEmail}" class="${contactChip}"
                          >✉︎ ${b.clientEmail}</a
                        >
                        ${b.clientPhone
                          ? html`<a href="tel:${b.clientPhone}" class="${contactChip}"
                              >✆ ${b.clientPhone}</a
                            >`
                          : ""}
                      </div>
                      ${b.status === "confirmed"
                        ? html`
                            <div class="flex flex-col gap-2.5 border-t border-ink/10 pt-3">
                              <span class="text-[12px] uppercase tracking-[.16em] text-ink"
                                >${formatPence(b.depositPence)} deposit paid</span
                              >
                              <form
                                method="post"
                                action="/admin/appointments/${b.id}/cancel"
                                class="m-0"
                                onsubmit="return confirm('Cancel this appointment and refund the deposit?')"
                              >
                                <button
                                  type="submit"
                                  class="min-h-[48px] w-full cursor-pointer border-[1.5px] border-crimson bg-transparent text-[12px] font-semibold uppercase tracking-[.18em] text-crimson transition-colors hover:bg-crimson hover:text-cream"
                                >
                                  Cancel &amp; refund deposit
                                </button>
                              </form>
                            </div>
                          `
                        : html`
                            <p
                              class="m-0 border-t border-ink/10 pt-3 text-[13px] leading-[1.5] text-ink/70"
                            >
                              They&rsquo;re at the payment page now. This becomes
                              a booking when they pay, or the time reopens by
                              itself.
                            </p>
                          `}
                    </article>
                  `
                )}
              </div>
            `}
      `
    )
  );
});

// Admin cancellation: no notice cutoff — Lorena is doing the cancelling, so
// the client always gets their full deposit back.
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
    // Admin cancellations always refund the full deposit — Lorena's call.
    sendCancellationEmails(c.env.RESEND_API_KEY, booking, booking.depositPence)
  );
  return c.redirect("/admin?msg=cancelled", 303);
});

// ---------- times ----------

const fieldLabel = "text-[11px] font-semibold uppercase tracking-[.2em] text-ink";
const timeInput =
  "h-[52px] rounded-none border border-ink/30 bg-cream px-3.5 font-body text-[16px] text-ink outline-teal";

app.get("/times", async (c) => {
  const slots = await listSlotsAdmin(c.env.DB, nowEpoch());

  return c.html(
    adminShell(
      "Times",
      "times",
      c.req.query("msg"),
      html`
        <h1 class="font-display m-0 text-[28px] font-medium italic text-ink">
          Add a time
        </h1>

        <form
          method="post"
          action="/admin/times"
          class="${cardClass} mt-4 gap-4 px-4 py-[18px]"
        >
          <label class="flex flex-col gap-[7px]">
            <span class="${fieldLabel}">Date</span>
            <input type="date" name="date" required class="${timeInput}" />
          </label>
          <div class="grid grid-cols-2 gap-3">
            <label class="flex flex-col gap-[7px]">
              <span class="${fieldLabel}">From</span>
              <input type="time" name="start" required class="${timeInput}" />
            </label>
            <label class="flex flex-col gap-[7px]">
              <span class="${fieldLabel}">Until</span>
              <input type="time" name="end" required class="${timeInput}" />
            </label>
          </div>
          <button
            type="submit"
            class="min-h-[54px] cursor-pointer border-0 bg-crimson text-[12px] font-semibold uppercase tracking-[.2em] text-cream transition-colors hover:bg-crimson-deep"
          >
            Add this time
          </button>
        </form>

        <h2 class="font-display m-0 mt-[34px] text-[24px] font-medium italic text-ink">
          Your times
        </h2>

        ${slots.length === 0
          ? html`<p class="m-0 mt-3.5 text-[15px] text-ink/70">
              No upcoming times yet — add one above.
            </p>`
          : html`
              <div class="mt-3.5 flex flex-col gap-3.5">
                ${slots.map((s) => {
                  const isBooked = s.booking_status === "confirmed";
                  const isPending = !!s.booking_id && !isBooked;
                  const isBlocked = !s.booking_id && s.status === "blocked";
                  const isOpen = !s.booking_id && s.status === "open";
                  return html`
                    <article class="${cardClass} gap-2.5 p-4">
                      <div class="flex flex-wrap items-baseline justify-between gap-2.5">
                        <div class="flex flex-col gap-0.5">
                          <span class="${capsLine}">${formatLondonDayShort(s.starts_at)}</span>
                          <span class="text-[15px] text-ink"
                            >${formatLondonTime(s.starts_at)} –
                            ${formatLondonTime(s.ends_at)}</span
                          >
                        </div>
                        ${isBooked
                          ? badge(`Booked — ${s.client_name ?? ""}`, "solid")
                          : isPending
                            ? badge("Being booked right now", "crimson")
                            : isBlocked
                              ? badge("Blocked", "muted")
                              : badge("Open", "teal")}
                      </div>
                      ${isPending
                        ? html`<p class="m-0 text-[13px] leading-[1.5] text-ink/70">
                            Someone is paying for this time. If they don&rsquo;t
                            finish, it reopens by itself.
                          </p>`
                        : ""}
                      ${isOpen
                        ? html`
                            <form method="post" action="/admin/times/${s.id}/block" class="m-0">
                              <button
                                type="submit"
                                class="min-h-[48px] w-full cursor-pointer border-[1.5px] border-ink/45 bg-transparent text-[12px] font-semibold uppercase tracking-[.18em] text-ink transition-colors hover:border-ink hover:bg-ink/5"
                              >
                                Block this time
                              </button>
                            </form>
                          `
                        : ""}
                      ${isBlocked
                        ? html`
                            <form method="post" action="/admin/times/${s.id}/unblock" class="m-0">
                              <button
                                type="submit"
                                class="min-h-[48px] w-full cursor-pointer border-[1.5px] border-teal bg-transparent text-[12px] font-semibold uppercase tracking-[.18em] text-teal transition-colors hover:bg-teal hover:text-cream"
                              >
                                Reopen this time
                              </button>
                            </form>
                          `
                        : ""}
                    </article>
                  `;
                })}
              </div>
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
