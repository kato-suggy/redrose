/**
 * Stripe on Workers: the npm SDK with its fetch client (no Node http), and
 * SubtleCrypto for webhook signature verification (no Node crypto).
 */

import Stripe from "stripe";
import { Err, Ok, type Pence, type Result } from "../types";
import { HOLD_MINUTES } from "../config";

export function stripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export interface CheckoutRequest {
  bookingId: string;
  serviceName: string;
  depositPence: Pence;
  clientEmail: string;
  origin: string; // e.g. http://localhost:8787 — success/cancel URLs
  cancellationPolicy: string;
}

/** Create the deposit Checkout session; the booking id rides in metadata. */
export async function createCheckoutSession(
  stripe: Stripe,
  req: CheckoutRequest
): Promise<Result<{ sessionId: string; url: string }>> {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: req.depositPence,
            product_data: {
              name: `Deposit — ${req.serviceName}`,
              description: req.cancellationPolicy,
            },
          },
        },
      ],
      customer_email: req.clientEmail,
      metadata: { booking_id: req.bookingId },
      // Stripe's minimum is 30 min from creation; +60s so our DB hold
      // (exactly HOLD_MINUTES) never outlives the session.
      expires_at: Math.floor(Date.now() / 1000) + HOLD_MINUTES * 60 + 60,
      success_url: `${req.origin}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.origin}/booking/cancelled`,
    });
    if (!session.url) {
      return Err({ kind: "stripe", detail: "session created without a URL" });
    }
    return Ok({ sessionId: session.id, url: session.url });
  } catch (e) {
    return Err({
      kind: "stripe",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Verify the webhook signature and parse the event. Rejects forgeries. */
export async function verifyWebhook(
  stripe: Stripe,
  rawBody: string,
  signature: string,
  webhookSecret: string
): Promise<Result<Stripe.Event>> {
  try {
    const event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider()
    );
    return Ok(event);
  } catch (e) {
    return Err({
      kind: "stripe",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Full refund of the deposit's payment intent. */
export async function refundDeposit(
  stripe: Stripe,
  paymentIntent: string
): Promise<Result<{ refundId: string }>> {
  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntent,
    });
    return Ok({ refundId: refund.id });
  } catch (e) {
    return Err({
      kind: "stripe",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}
