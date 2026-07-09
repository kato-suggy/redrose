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
import { formatLondon, nowEpoch } from "../lib/time";
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

  if (!Number.isInteger(slotId) || !Number.isInteger(serviceId)) {
    return c.json({ error: "slot_id and service_id are required" }, 400);
  }
  if (name.length < 1 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return c.json({ error: "valid name and email are required" }, 400);
  }

  const [service, slot] = await Promise.all([
    getActiveService(c.env.DB, serviceId),
    getOpenSlot(c.env.DB, slotId),
  ]);
  if (!service) return c.json({ error: "unknown service" }, 404);
  if (!slot || slot.starts_at <= nowEpoch()) {
    return c.json({ error: "that slot is no longer available" }, 409);
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
      return c.json({ error: "sorry — that slot was just taken" }, 409);
    }
    console.error("hold failed:", hold.error);
    return c.json({ error: "something went wrong, please try again" }, 500);
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
    return c.json({ error: "payment system unavailable, please try again" }, 502);
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
