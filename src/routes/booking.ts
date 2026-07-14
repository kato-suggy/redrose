/**
 * Booking engine routes: slot listing, atomic hold + Stripe Checkout,
 * webhook confirmation, outcome pages, self-serve cancellation.
 * All curl-testable — no UI required (that's M2).
 */

import { Hono } from "hono";
import { html } from "hono/html";
import type Stripe from "stripe";
import type { Bindings } from "../env";
import { layout } from "../layout";
import { formatPence, pence, type Pence } from "../types";
import {
  FULL_REFUND_CUTOFF_HOURS,
  HALF_REFUND_CUTOFF_HOURS,
} from "../config";
import {
  formatLondon,
  formatLondonDay,
  formatLondonTime,
  nowEpoch,
} from "../lib/time";
import {
  attachStripeSession,
  cancelBooking,
  confirmBooking,
  expireBooking,
  getActiveService,
  getBookingById,
  getBookingBySession,
  getBookingByToken,
  getOpenSlot,
  holdSlot,
  listOpenSlots,
  reinstateBooking,
  releaseHold,
  type BookingDetail,
  type SlotRow,
} from "../lib/db";
import {
  createCheckoutSession,
  refundDeposit,
  stripeClient,
  verifyWebhook,
} from "../lib/stripe";
import {
  sendCancellationEmails,
  sendConfirmationEmails,
  sendOpsNotice,
} from "../lib/email";
import site from "../../content/site.json";

const app = new Hono<{ Bindings: Bindings }>();

// ---------- GET /api/slots?from&to ----------
// from/to accept epoch seconds or YYYY-MM-DD. Defaults: now → +6 weeks.
app.get("/api/slots", async (c) => {
  const parse = (v: string | undefined, fallback: number): number => {
    if (!v) return fallback;
    if (/^\d+$/.test(v)) return parseInt(v, 10);
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? fallback : Math.floor(ms / 1000);
  };
  const now = nowEpoch();
  const from = Math.max(parse(c.req.query("from"), now), now);
  const to = parse(c.req.query("to"), now + 42 * 86400);

  const slots = await listOpenSlots(c.env.DB, from, to);
  return c.json({
    slots: slots.map((s) => ({
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      starts_at_london: formatLondon(s.starts_at),
    })),
  });
});

// ---------- GET /book → /treatments ----------
// The chooser page is retired: /treatments lists every service with its own
// Book button. Old links and muscle memory land there instead of a 404.
// (POST /book — the hold + Checkout flow — is unaffected.)
app.get("/book", (c) => c.redirect("/treatments", 301));

// ---------- GET /book/:serviceId — slot picker + details form ----------
// Server-renders the next 6 weeks of open slots grouped by London day.
// Works with JS disabled; a tiny script only gates the submit button.

const BOOKING_WINDOW_DAYS = 42;

const FORM_ERRORS: Record<string, { title: string; body: string }> = {
  slot_taken: {
    title: "That time was just taken",
    body: "Someone booked it moments before you. The times below are still open.",
  },
  unavailable: {
    title: "That time is no longer available",
    body: "Please pick another from the times below.",
  },
  invalid: {
    title: "Something was missing",
    body: "Please choose a time and fill in your name and email.",
  },
  payment: {
    title: "The payment system is having a moment",
    body: "Nothing was charged. Please try again.",
  },
  oops: {
    title: "Something went wrong at our end",
    body: "Please try again.",
  },
};

app.get("/book/:serviceId", async (c) => {
  const serviceId = Number(c.req.param("serviceId"));
  const service = Number.isInteger(serviceId)
    ? await getActiveService(c.env.DB, serviceId)
    : null;
  if (!service) {
    return c.html(
      layout(
        "Not found",
        html`<main class="mx-auto max-w-2xl px-6 py-16">
          <h1 class="font-display text-3xl font-bold text-crimson">
            Treatment not found
          </h1>
          <p class="mt-4"><a class="text-teal underline" href="/">Back to all treatments</a></p>
        </main>`
      ),
      404
    );
  }

  const now = nowEpoch();
  const slots = await listOpenSlots(c.env.DB, now, now + BOOKING_WINDOW_DAYS * 86400);

  // group by London calendar day, preserving chronological order
  const days = new Map<string, SlotRow[]>();
  for (const s of slots) {
    const key = formatLondonDay(s.starts_at);
    const list = days.get(key);
    if (list) list.push(s);
    else days.set(key, [s]);
  }

  const error = FORM_ERRORS[c.req.query("error") ?? ""];
  const prefill = {
    name: c.req.query("name") ?? "",
    email: c.req.query("email") ?? "",
    phone: c.req.query("phone") ?? "",
  };
  const deposit = formatPence(pence(service.deposit_pence));
  const sectionMeta = site.sections.find((m) => m.key === service.section);
  const inputClass =
    "h-[52px] rounded-none border border-ink/30 bg-paper px-3.5 font-body text-[16px] text-ink outline-teal";
  const fieldLabel =
    "text-[11px] font-semibold uppercase tracking-[.2em] text-ink";

  return c.html(
    layout(
      `Book ${service.name}`,
      html`
        <div class="mx-auto flex min-h-screen w-full max-w-[420px] flex-col">
          <!-- top bar (Booking Slot Picker.dc) -->
          <header
            class="flex items-baseline justify-between border-b border-crimson px-5 pb-3.5 pt-[18px]"
          >
            <a href="/" class="font-display text-[18px] font-semibold italic text-crimson no-underline"
              >Red Rose</a
            >
            <span class="text-[10px] uppercase tracking-[.22em] text-ink"
              >Ink &amp; Beauty · Newcastle</span
            >
          </header>

          <main class="flex flex-1 flex-col px-5 pb-10 pt-6">
            <a
              href="/treatments"
              class="text-[11px] font-medium uppercase tracking-[.2em] text-teal no-underline hover:text-crimson"
              >&larr; All treatments</a
            >

            <!-- service header -->
            <div class="mt-[22px] flex flex-col gap-2">
              ${sectionMeta
                ? html`<span class="text-[11px] font-medium uppercase tracking-[.24em] text-teal"
                    >${sectionMeta.number} — ${service.section}</span
                  >`
                : ""}
              <h1
                class="font-display m-0 text-[34px] font-medium italic leading-[1.1] text-ink"
              >
                ${service.name}
              </h1>
              <p class="m-0 mt-0.5 text-[12px] uppercase tracking-[.18em] text-ink">
                ${service.duration_mins} mins ·
                <span class="font-semibold text-crimson"
                  >${formatPence(pence(service.price_pence))}</span
                >
                · ${deposit} deposit
              </p>
            </div>

            <hr class="mb-0 mt-[26px] border-0 border-t border-crimson" />

            ${error
              ? html`<div
                  role="alert"
                  class="mt-[22px] flex flex-col gap-0.5 border-[1.5px] border-crimson bg-crimson/5 px-4 py-3.5"
                >
                  <span class="text-[11px] font-semibold uppercase tracking-[.2em] text-crimson"
                    >${error.title}</span
                  >
                  <span class="text-[14px] leading-[1.5] text-ink">${error.body}</span>
                </div>`
              : ""}

            <section class="mt-[26px]">
              <h2 class="font-display m-0 text-[22px] font-medium italic text-ink">
                Pick a time
              </h2>

              ${days.size === 0
                ? html`
                    <div
                      class="mt-[18px] flex flex-col items-center gap-3.5 border border-crimson/35 px-[22px] py-7 text-center"
                    >
                      <p class="font-display m-0 text-[19px] italic leading-[1.4] text-ink">
                        No appointments open right now.
                      </p>
                      <p class="m-0 text-[14px] leading-[1.55] text-ink/75">
                        Lorena adds new times regularly. Message her on Instagram
                        and she&rsquo;ll let you know when the diary opens.
                      </p>
                      <a
                        href="${site.instagram}"
                        class="inline-flex min-h-[48px] items-center justify-center border-[1.5px] border-crimson px-6 text-[12px] font-semibold uppercase tracking-[.2em] text-crimson no-underline transition-colors hover:bg-crimson hover:text-cream"
                        >Message Lorena</a
                      >
                    </div>
                  `
                : html`
                    <div class="mt-1.5 flex flex-col gap-[22px] pt-3" id="time-groups">
                      ${[...days.entries()].map(
                        ([day, daySlots]) => html`
                          <fieldset class="m-0 flex flex-col gap-2.5 border-0 p-0">
                            <legend
                              class="m-0 p-0 text-[12px] font-semibold uppercase tracking-[.2em] text-ink"
                            >
                              ${day}
                            </legend>
                            <div class="flex flex-wrap gap-2.5">
                              ${daySlots.map(
                                (s) => html`
                                  <label class="cursor-pointer">
                                    <input
                                      type="radio"
                                      name="slot_id"
                                      value="${s.id}"
                                      form="booking-form"
                                      class="peer sr-only"
                                      required
                                    />
                                    <span
                                      class="inline-flex min-h-[48px] items-center justify-center border-[1.5px] border-crimson/45 bg-paper px-5 text-[15px] tracking-[.04em] text-ink transition-colors peer-checked:border-crimson peer-checked:bg-crimson peer-checked:font-semibold peer-checked:text-cream"
                                    >
                                      ${formatLondonTime(s.starts_at)} –
                                      ${formatLondonTime(s.ends_at)}
                                    </span>
                                  </label>
                                `
                              )}
                            </div>
                          </fieldset>
                        `
                      )}
                    </div>
                  `}
            </section>

            ${days.size > 0
              ? html`
                  <form method="post" action="/book" id="booking-form" class="mt-9 flex flex-col">
                    <input type="hidden" name="service_id" value="${service.id}" />
                    <h2 class="font-display m-0 text-[22px] font-medium italic text-ink">
                      Your details
                    </h2>

                    <div class="mt-[18px] flex flex-col gap-[18px]">
                      <label class="flex flex-col gap-[7px]">
                        <span class="${fieldLabel}">Name</span>
                        <input
                          name="name"
                          required
                          autocomplete="name"
                          value="${prefill.name}"
                          class="${inputClass}"
                        />
                      </label>
                      <label class="flex flex-col gap-[7px]">
                        <span class="${fieldLabel}">Email</span>
                        <input
                          name="email"
                          type="email"
                          required
                          autocomplete="email"
                          value="${prefill.email}"
                          class="${inputClass}"
                        />
                      </label>
                      <label class="flex flex-col gap-[7px]">
                        <span class="${fieldLabel}"
                          >Phone
                          <span class="font-normal normal-case tracking-[.05em] text-ink/50"
                            >(optional)</span
                          ></span
                        >
                        <input
                          name="phone"
                          type="tel"
                          autocomplete="tel"
                          value="${prefill.phone}"
                          class="${inputClass}"
                        />
                      </label>
                    </div>

                    <div class="mt-[26px] flex flex-col gap-2.5">
                      <p class="m-0 text-[13px] leading-[1.6] text-ink/75">
                        ${site.bookingNotice}
                      </p>
                      <p class="m-0 text-[13px] leading-[1.6] text-ink/75">
                        ${site.cancellationPolicy}
                      </p>
                    </div>

                    <button
                      type="submit"
                      class="mt-[26px] min-h-[58px] cursor-pointer border-0 bg-crimson text-[13px] font-semibold uppercase tracking-[.2em] text-cream transition-colors hover:bg-crimson-deep disabled:opacity-40"
                    >
                      Continue to payment — ${deposit} deposit
                    </button>
                  </form>

                  <script>
                    // Enhancement only: gate submit until a time is chosen.
                    // Without JS the required radios + server checks still hold.
                    {
                      const form = document.getElementById("booking-form");
                      const btn = form.querySelector("button[type=submit]");
                      const update = () => {
                        btn.disabled = !document.querySelector(
                          "input[name=slot_id]:checked"
                        );
                      };
                      document.addEventListener("change", update);
                      update();
                    }
                  </script>
                `
              : ""}
          </main>

          <footer
            class="flex items-baseline justify-between border-t border-crimson p-5"
          >
            <span class="text-[10px] uppercase tracking-[.2em] text-ink/60"
              >© 2026 ${site.businessName}</span
            >
            <a
              href="/privacy"
              class="text-[10px] uppercase tracking-[.2em] text-teal underline"
              >Privacy</a
            >
          </footer>
        </div>
      `
    )
  );
});

// ---------- POST /book ----------
// Accepts form-encoded (browser) or JSON (curl). Holds the slot, creates the
// Checkout session, then 303-redirects (form) or returns the URL (JSON).
app.post("/book", async (c) => {
  const isJson = c.req.header("content-type")?.includes("application/json");
  const body: Record<string, unknown> = isJson
    ? await c.req.json<Record<string, unknown>>().catch(() => ({}))
    : await c.req.parseBody();

  const slotId = Number(body["slot_id"]);
  const serviceId = Number(body["service_id"]);
  const name = String(body["name"] ?? "").trim();
  const email = String(body["email"] ?? "").trim();
  const phone = String(body["phone"] ?? "").trim();

  // JSON callers get an error body; browsers bounce back to the picker with
  // a banner code and their typed details preserved.
  const fail = (code: keyof typeof FORM_ERRORS, status: 400 | 404 | 409 | 500 | 502) => {
    const err = FORM_ERRORS[code]!;
    if (isJson) return c.json({ error: err.body, title: err.title }, status);
    if (!Number.isInteger(serviceId)) return c.json({ error: err.body }, status);
    const back = new URLSearchParams({ error: code, name, email, phone });
    return c.redirect(`/book/${serviceId}?${back}`, 303);
  };

  if (!Number.isInteger(slotId) || !Number.isInteger(serviceId)) {
    return fail("invalid", 400);
  }
  if (name.length < 1 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return fail("invalid", 400);
  }

  const [service, slot] = await Promise.all([
    getActiveService(c.env.DB, serviceId),
    getOpenSlot(c.env.DB, slotId),
  ]);
  if (!service) return fail("invalid", 404);
  if (!slot || slot.starts_at <= nowEpoch()) {
    return fail("unavailable", 409);
  }

  const hold = await holdSlot(c.env.DB, {
    slotId,
    serviceId,
    clientName: name,
    clientEmail: email,
    clientPhone: phone,
    depositPence: pence(service.deposit_pence),
  });
  if (!hold.ok) {
    if (hold.error.kind === "slot_taken") {
      return fail("slot_taken", 409);
    }
    console.error("hold failed:", hold.error);
    return fail("oops", 500);
  }

  const stripe = stripeClient(c.env.STRIPE_SECRET_KEY);
  const session = await createCheckoutSession(stripe, {
    bookingId: hold.value.bookingId,
    serviceName: service.name,
    depositPence: pence(service.deposit_pence),
    clientEmail: email,
    origin: new URL(c.req.url).origin,
    cancellationPolicy: site.cancellationPolicy,
  });
  if (!session.ok) {
    // Couldn't reach Stripe — free the slot straight away rather than
    // leaving a 30-minute hold nobody can pay for.
    await releaseHold(c.env.DB, hold.value.bookingId);
    console.error("checkout session failed:", session.error);
    return fail("payment", 502);
  }

  await attachStripeSession(c.env.DB, hold.value.bookingId, session.value.sessionId);

  if (isJson) {
    return c.json({
      booking_id: hold.value.bookingId,
      checkout_url: session.value.url,
      hold_expires_at: hold.value.expiresAt,
    });
  }
  return c.redirect(session.value.url, 303);
});

// ---------- POST /webhooks/stripe ----------
app.post("/webhooks/stripe", async (c) => {
  const signature = c.req.header("stripe-signature");
  if (!signature) return c.json({ error: "missing signature" }, 400);

  const stripe = stripeClient(c.env.STRIPE_SECRET_KEY);
  const verified = await verifyWebhook(
    stripe,
    await c.req.text(),
    signature,
    c.env.STRIPE_WEBHOOK_SECRET
  );
  if (!verified.ok) {
    console.error("webhook verification failed:", verified.error);
    return c.json({ error: "invalid signature" }, 400);
  }
  const event = verified.value;

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const bookingId = session.metadata?.booking_id;
      if (!bookingId) break; // not one of ours

      const paymentIntent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);

      const outcome = await confirmBooking(c.env.DB, bookingId, paymentIntent);
      switch (outcome.kind) {
        case "confirmed": {
          const booking = await getBookingById(c.env.DB, bookingId);
          if (booking) {
            c.executionCtx.waitUntil(
              sendConfirmationEmails(
                c.env.RESEND_API_KEY,
                booking,
                new URL(c.req.url).origin
              )
            );
          }
          break;
        }
        case "late_payment":
          c.executionCtx.waitUntil(
            resolveLatePayment(c.env, stripe, bookingId, paymentIntent)
          );
          break;
        case "already_processed":
          break; // webhook retry — idempotent no-op
      }
      break;
    }
    case "checkout.session.expired": {
      const bookingId = event.data.object.metadata?.booking_id;
      if (bookingId) await expireBooking(c.env.DB, bookingId);
      break;
    }
    default:
      break; // unhandled event types are fine
  }

  return c.json({ received: true });
});

/**
 * DECISION POINT (Kate): payment completed *after* the 30-minute hold lapsed
 * — usually because the client paid at the last second and someone else has
 * since taken (or could take) the slot.
 *
 * Options: (a) refund automatically and keep the booking expired — never
 * charge without a guaranteed slot (current default); (b) try to re-confirm
 * if the slot is still free, refund only if it's gone; (c) hold the money
 * and let Lorena decide. (b) is nicer for the client but needs a careful
 * re-run of the uniqueness dance; (c) puts a human in a race-condition path.
 */
async function resolveLatePayment(
  env: Bindings,
  stripe: Stripe,
  bookingId: string,
  paymentIntent: string | null
): Promise<void> {
  console.error(`late payment on expired booking ${bookingId} — refunding`);
  let refundNote = "no payment intent — REFUND MANUALLY in the Stripe dashboard";
  if (paymentIntent) {
    const refund = await refundDeposit(stripe, paymentIntent);
    refundNote = refund.ok
      ? "deposit refunded automatically"
      : `automatic refund FAILED (${refund.error.kind === "stripe" ? refund.error.detail : "error"}) — refund manually in the Stripe dashboard`;
  }
  await sendOpsNotice(
    env.RESEND_API_KEY,
    "Late payment on an expired booking",
    `<p>Booking <code>${bookingId}</code> was paid after its hold expired.
     The booking stays expired; the slot may have been re-booked.</p>
     <p><strong>${refundNote}</strong></p>`
  );
}

// ---------- outcome pages ----------
app.get("/booking/success", async (c) => {
  const sessionId = c.req.query("session_id");
  const booking = sessionId
    ? await getBookingBySession(c.env.DB, sessionId)
    : null;

  return c.html(
    layout(
      "Booking confirmed",
      html`
        <main class="mx-auto max-w-2xl px-6 py-16">
          <h1 class="font-display text-3xl font-bold text-crimson">
            Thank you — payment received
          </h1>
          ${booking
            ? html`
                <p class="mt-4">
                  <strong>${booking.serviceName}</strong> on
                  <strong>${formatLondon(booking.slotStartsAt)}</strong> —
                  deposit of ${formatPence(booking.depositPence)} paid.
                </p>
              `
            : html`<p class="mt-4">Your booking is being confirmed.</p>`}
          <p class="mt-4">
            A confirmation email is on its way with all the details and a
            cancellation link.
          </p>
        </main>
      `
    )
  );
});

app.get("/booking/cancelled", (c) =>
  c.html(
    layout(
      "Checkout cancelled",
      html`
        <main class="mx-auto max-w-2xl px-6 py-16">
          <h1 class="font-display text-3xl font-bold text-crimson">
            Checkout cancelled
          </h1>
          <p class="mt-4">
            No payment was taken and the slot has not been booked. It's held
            for a short while, so if you change your mind, just book again.
          </p>
        </main>
      `
    )
  )
);

// ---------- self-serve cancellation ----------
// Lorena's policy: ≥48h notice → full deposit back; 24–48h → half; <24h → none.
type RefundTier = { kind: "full" | "half"; refund: Pence } | { kind: "none" };

function refundTier(b: BookingDetail): RefundTier {
  const hoursAhead = (b.slotStartsAt - nowEpoch()) / 3600;
  if (hoursAhead >= FULL_REFUND_CUTOFF_HOURS) {
    return { kind: "full", refund: b.depositPence };
  }
  if (hoursAhead >= HALF_REFUND_CUTOFF_HOURS) {
    return { kind: "half", refund: pence(Math.round(b.depositPence / 2)) };
  }
  return { kind: "none" };
}

const cancelPage = (title: string, body: unknown) =>
  layout(
    title,
    html`<main class="mx-auto max-w-2xl px-6 py-16">${body}</main>`
  );

app.get("/booking/cancel/:token", async (c) => {
  const booking = await getBookingByToken(c.env.DB, c.req.param("token"));
  if (!booking) {
    return c.html(
      cancelPage(
        "Booking not found",
        html`<h1 class="font-display text-3xl font-bold text-crimson">
            Booking not found
          </h1>
          <p class="mt-4">
            That link doesn't match a booking. If you think this is a mistake,
            reply to your confirmation email.
          </p>`
      ),
      404
    );
  }

  if (booking.status !== "confirmed") {
    return c.html(
      cancelPage(
        "Booking already closed",
        html`<h1 class="font-display text-3xl font-bold text-crimson">
            Nothing to cancel
          </h1>
          <p class="mt-4">
            This booking is no longer active
            (status: ${booking.status.replace("_", " ")}).
          </p>`
      )
    );
  }

  const when = formatLondon(booking.slotStartsAt);
  const tier = refundTier(booking);

  if (tier.kind === "none") {
    return c.html(
      cancelPage(
        "Cancellation",
        html`<h1 class="font-display text-3xl font-bold text-crimson">
            Within ${HALF_REFUND_CUTOFF_HOURS} hours of your appointment
          </h1>
          <p class="mt-4">
            <strong>${booking.serviceName}</strong> on <strong>${when}</strong>.
          </p>
          <p class="mt-4">${site.cancellationPolicy}</p>
          <p class="mt-4">
            Message Lorena on
            <a class="text-teal underline" href="${site.instagram}">Instagram</a>
            and she'll do her best to rearrange.
          </p>`
      )
    );
  }

  return c.html(
    cancelPage(
      "Cancel booking",
      html`<h1 class="font-display text-3xl font-bold text-crimson">
          Cancel this booking?
        </h1>
        <p class="mt-4">
          <strong>${booking.serviceName}</strong> on <strong>${when}</strong> —
          deposit ${formatPence(booking.depositPence)}.
        </p>
        ${tier.kind === "full"
          ? html`<p class="mt-4">
              You're more than ${FULL_REFUND_CUTOFF_HOURS} hours ahead, so your
              deposit will be refunded in full.
            </p>`
          : html`<p class="mt-4">
              It's less than ${FULL_REFUND_CUTOFF_HOURS} hours before your
              appointment, so half your deposit
              (${formatPence(tier.refund)}) will be refunded.
            </p>`}
        <form method="post" class="mt-8">
          <input type="hidden" name="tier" value="${tier.kind}" />
          <button
            type="submit"
            class="rounded bg-crimson px-6 py-3 font-medium text-cream"
          >
            Cancel booking &amp; refund ${formatPence(tier.refund)}
          </button>
        </form>`
    )
  );
});

app.post("/booking/cancel/:token", async (c) => {
  const booking = await getBookingByToken(c.env.DB, c.req.param("token"));
  const tier = booking ? refundTier(booking) : { kind: "none" as const };
  if (!booking || booking.status !== "confirmed" || tier.kind === "none") {
    // State changed since the GET (double submit, or a cutoff crossed while
    // the page was open) — re-render the current truth.
    return c.redirect(`/booking/cancel/${c.req.param("token")}`, 303);
  }

  // The page promised a specific tier; if the clock has since crossed a
  // cutoff, bounce back so the client confirms the new amount, rather than
  // silently refunding less than they were shown.
  const body = await c.req.parseBody();
  if (String(body["tier"] ?? "") !== tier.kind) {
    return c.redirect(`/booking/cancel/${c.req.param("token")}`, 303);
  }

  if (!booking.stripePaymentIntent) {
    console.error(`booking ${booking.id} confirmed without a payment intent`);
    return c.html(
      cancelPage(
        "Something went wrong",
        html`<h1 class="font-display text-3xl font-bold text-crimson">
            We couldn't process the refund
          </h1>
          <p class="mt-4">
            Please message Lorena on
            <a class="text-teal underline" href="${site.instagram}">Instagram</a>
            and she'll sort it out.
          </p>`
      ),
      500
    );
  }

  // Flip the status first: the guarded UPDATE means exactly one submit wins,
  // so a double-click can't trigger two half-refunds (Stripe only dedupes
  // duplicate FULL refunds). If the refund then fails, reinstate.
  const cancelled = await cancelBooking(c.env.DB, booking.id);
  if (!cancelled) {
    return c.redirect(`/booking/cancel/${c.req.param("token")}`, 303);
  }

  const stripe = stripeClient(c.env.STRIPE_SECRET_KEY);
  const refund = await refundDeposit(
    stripe,
    booking.stripePaymentIntent,
    tier.kind === "full" ? undefined : tier.refund
  );
  if (!refund.ok) {
    console.error("refund failed:", refund.error);
    const reinstated = await reinstateBooking(c.env.DB, booking.id);
    if (!reinstated) {
      // cancelled but not refunded and the slot may be gone — needs a human
      c.executionCtx.waitUntil(
        sendOpsNotice(
          c.env.RESEND_API_KEY,
          "Cancellation needs attention",
          `<p>Booking <code>${booking.id}</code> (${booking.clientName},
           ${booking.serviceName}) was cancelled but the
           ${formatPence(tier.refund)} refund FAILED and the booking could
           not be reinstated. Refund manually in the Stripe dashboard.</p>`
        )
      );
    }
    return c.html(
      cancelPage(
        "Something went wrong",
        html`<h1 class="font-display text-3xl font-bold text-crimson">
            We couldn't process the refund
          </h1>
          <p class="mt-4">
            Your booking has <strong>not</strong> been cancelled. Please try
            again in a few minutes, or message Lorena on
            <a class="text-teal underline" href="${site.instagram}">Instagram</a>.
          </p>`
      ),
      502
    );
  }

  c.executionCtx.waitUntil(
    sendCancellationEmails(c.env.RESEND_API_KEY, booking, tier.refund)
  );

  return c.html(
    cancelPage(
      "Booking cancelled",
      html`<h1 class="font-display text-3xl font-bold text-crimson">
          Booking cancelled
        </h1>
        <p class="mt-4">
          ${tier.kind === "full"
            ? html`Your ${formatPence(booking.depositPence)} deposit has been
              refunded in full`
            : html`Half your deposit (${formatPence(tier.refund)}) has been
              refunded`}
          — it should reach your account within 5–10 working days.
        </p>
        <p class="mt-4">We'd love to see you another time.</p>`
    )
  );
});

export default app;
