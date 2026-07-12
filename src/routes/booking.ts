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
import { formatPence, pence } from "../types";
import { CANCEL_CUTOFF_HOURS } from "../config";
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

const FORM_ERRORS: Record<string, string> = {
  slot_taken:
    "Sorry — that time was booked while you were choosing. Please pick another.",
  unavailable: "That time is no longer available — please pick another.",
  invalid: "Please choose a time and fill in your name and email.",
  payment:
    "The payment system is having a moment — nothing was charged. Please try again.",
  oops: "Something went wrong at our end — please try again.",
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

  const errorMsg = FORM_ERRORS[c.req.query("error") ?? ""];
  const prefill = {
    name: c.req.query("name") ?? "",
    email: c.req.query("email") ?? "",
    phone: c.req.query("phone") ?? "",
  };
  const deposit = formatPence(pence(service.deposit_pence));

  return c.html(
    layout(
      `Book ${service.name}`,
      html`
        <main class="mx-auto max-w-2xl px-6 py-10">
          <a class="text-sm text-teal underline" href="/">&larr; All treatments</a>
          <h1 class="mt-4 font-display text-3xl font-bold text-crimson">
            ${service.name}
          </h1>
          <p class="mt-2 text-sm opacity-80">
            ${service.duration_mins} mins ·
            ${formatPence(pence(service.price_pence))} · ${deposit} deposit to book
          </p>

          ${errorMsg
            ? html`<p
                class="mt-6 rounded border border-crimson/40 bg-crimson/10 px-4 py-3 text-crimson"
                role="alert"
              >
                ${errorMsg}
              </p>`
            : ""}
          ${days.size === 0
            ? html`
                <p class="mt-10">
                  No appointments are open right now — new times are added
                  regularly, so please check back soon or message Lorena on
                  <a class="text-teal underline" href="${site.instagram}">Instagram</a>.
                </p>
              `
            : html`
                <form method="post" action="/book" class="mt-8">
                  <input type="hidden" name="service_id" value="${service.id}" />

                  <h2 class="font-display text-xl text-ink">Pick a time</h2>
                  ${[...days.entries()].map(
                    ([day, daySlots]) => html`
                      <fieldset class="mt-5">
                        <legend class="font-medium">${day}</legend>
                        <div class="mt-2 flex flex-wrap gap-2">
                          ${daySlots.map(
                            (s) => html`
                              <label class="cursor-pointer">
                                <input
                                  type="radio"
                                  name="slot_id"
                                  value="${s.id}"
                                  class="peer sr-only"
                                  required
                                />
                                <span
                                  class="inline-block rounded border border-teal/50 bg-white/60 px-4 py-2 peer-checked:border-crimson peer-checked:bg-crimson peer-checked:text-cream"
                                >
                                  ${formatLondonTime(s.starts_at)}&thinsp;–&thinsp;${formatLondonTime(s.ends_at)}
                                </span>
                              </label>
                            `
                          )}
                        </div>
                      </fieldset>
                    `
                  )}

                  <h2 class="mt-10 font-display text-xl text-ink">Your details</h2>
                  <div class="mt-4 space-y-4">
                    <label class="block">
                      <span class="text-sm">Name</span>
                      <input
                        name="name"
                        required
                        autocomplete="name"
                        value="${prefill.name}"
                        class="mt-1 w-full rounded border border-teal/50 bg-white px-3 py-2"
                      />
                    </label>
                    <label class="block">
                      <span class="text-sm">Email</span>
                      <input
                        name="email"
                        type="email"
                        required
                        autocomplete="email"
                        value="${prefill.email}"
                        class="mt-1 w-full rounded border border-teal/50 bg-white px-3 py-2"
                      />
                    </label>
                    <label class="block">
                      <span class="text-sm">Phone <span class="opacity-60">(optional)</span></span>
                      <input
                        name="phone"
                        type="tel"
                        autocomplete="tel"
                        value="${prefill.phone}"
                        class="mt-1 w-full rounded border border-teal/50 bg-white px-3 py-2"
                      />
                    </label>
                  </div>

                  <p class="mt-6 text-sm opacity-80">${site.bookingNotice}</p>
                  <p class="mt-2 text-sm opacity-80">${site.cancellationPolicy}</p>

                  <button
                    type="submit"
                    class="mt-6 w-full rounded bg-crimson px-6 py-3 font-medium text-cream disabled:opacity-40"
                  >
                    Continue to payment — ${deposit} deposit
                  </button>
                </form>

                <script>
                  // Enhancement only: gate submit until a time is chosen.
                  // Without JS the required radios + server checks still hold.
                  {
                    const form = document.querySelector("form");
                    const btn = form.querySelector("button[type=submit]");
                    const update = () => {
                      btn.disabled = !form.querySelector("input[name=slot_id]:checked");
                    };
                    form.addEventListener("change", update);
                    update();
                  }
                </script>
              `}
        </main>
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
    if (isJson) return c.json({ error: FORM_ERRORS[code] }, status);
    if (!Number.isInteger(serviceId)) return c.json({ error: FORM_ERRORS[code] }, status);
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
function refundable(b: BookingDetail): boolean {
  return b.slotStartsAt - nowEpoch() >= CANCEL_CUTOFF_HOURS * 3600;
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
  if (!refundable(booking)) {
    return c.html(
      cancelPage(
        "Cancellation",
        html`<h1 class="font-display text-3xl font-bold text-crimson">
            Within ${CANCEL_CUTOFF_HOURS} hours of your appointment
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
        <p class="mt-4">
          You're more than ${CANCEL_CUTOFF_HOURS} hours ahead, so your deposit
          will be refunded in full.
        </p>
        <form method="post" class="mt-8">
          <button
            type="submit"
            class="rounded bg-crimson px-6 py-3 font-medium text-cream"
          >
            Cancel booking &amp; refund my deposit
          </button>
        </form>`
    )
  );
});

app.post("/booking/cancel/:token", async (c) => {
  const booking = await getBookingByToken(c.env.DB, c.req.param("token"));
  if (!booking || booking.status !== "confirmed" || !refundable(booking)) {
    // State changed since the GET (double submit, or the 48h line crossed
    // while the page was open) — re-render the current truth.
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

  // Refund first: Stripe rejects a duplicate full refund, so a race between
  // two submits can't pay out twice. Only then flip the status.
  const stripe = stripeClient(c.env.STRIPE_SECRET_KEY);
  const refund = await refundDeposit(stripe, booking.stripePaymentIntent);
  if (!refund.ok) {
    console.error("refund failed:", refund.error);
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

  await cancelBooking(c.env.DB, booking.id);
  c.executionCtx.waitUntil(
    sendCancellationEmails(c.env.RESEND_API_KEY, booking, true)
  );

  return c.html(
    cancelPage(
      "Booking cancelled",
      html`<h1 class="font-display text-3xl font-bold text-crimson">
          Booking cancelled
        </h1>
        <p class="mt-4">
          Your ${formatPence(booking.depositPence)} deposit has been refunded —
          it should reach your account within 5–10 working days.
        </p>
        <p class="mt-4">We'd love to see you another time.</p>`
    )
  );
});

export default app;
