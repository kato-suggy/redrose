/**
 * Transactional email via Resend's REST API — a plain fetch, no SDK needed.
 *
 * Dev caveat: onboarding@resend.dev only delivers to the Resend account
 * owner's inbox, so test bookings must be made with Kate's email address.
 * Email failures are logged, never fatal — a paid booking must not fail
 * because an email bounced.
 */

import { formatPence, type Pence, type Result, Ok, Err } from "../types";
import {
  EMAIL_FROM,
  NOTIFY_EMAIL,
  FULL_REFUND_CUTOFF_HOURS,
  HALF_REFUND_CUTOFF_HOURS,
} from "../config";
import { formatLondon } from "./time";
import type { BookingDetail } from "./db";
import site from "../../content/site.json";

interface Email {
  to: string;
  subject: string;
  html: string;
}

async function send(apiKey: string, email: Email): Promise<Result<void>> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: EMAIL_FROM, ...email }),
  });
  if (!res.ok) {
    return Err({ kind: "email", detail: `${res.status} ${await res.text()}` });
  }
  return Ok(undefined);
}

/** Send both booking-confirmed emails; log failures, never throw. */
export async function sendConfirmationEmails(
  apiKey: string,
  b: BookingDetail,
  origin: string
): Promise<void> {
  const when = formatLondon(b.slotStartsAt);
  const cancelUrl = `${origin}/booking/cancel/${b.cancelToken}`;

  const client = send(apiKey, {
    to: b.clientEmail,
    subject: `Booking confirmed — ${b.serviceName}, ${when}`,
    html: `
      <h2>You're booked in ✨</h2>
      <p>Hi ${escapeHtml(b.clientName)},</p>
      <p>Your <strong>${escapeHtml(b.serviceName)}</strong> appointment is confirmed for
         <strong>${when}</strong>.</p>
      <p>Deposit paid: <strong>${formatPence(b.depositPence)}</strong>.
         ${escapeHtml(site.bookingNotice)}</p>
      <p>Where: ${escapeHtml(site.salonAddress)}</p>
      <hr>
      <p><strong>Need to cancel or rearrange?</strong><br>
         ${escapeHtml(site.cancellationPolicy)}</p>
      <p><a href="${cancelUrl}">Cancel this booking</a></p>
    `,
  });

  const lorena = send(apiKey, {
    to: NOTIFY_EMAIL,
    subject: `New booking: ${b.serviceName} — ${when}`,
    html: `
      <h2>New booking</h2>
      <p><strong>${escapeHtml(b.serviceName)}</strong> at <strong>${when}</strong></p>
      <ul>
        <li>Client: ${escapeHtml(b.clientName)}</li>
        <li>Email: ${escapeHtml(b.clientEmail)}</li>
        <li>Phone: ${escapeHtml(b.clientPhone) || "—"}</li>
        <li>Deposit paid: ${formatPence(b.depositPence)}</li>
      </ul>
    `,
  });

  for (const r of await Promise.all([client, lorena])) {
    if (!r.ok) console.error("confirmation email failed:", r.error);
  }
}

/**
 * Send both cancellation emails (client refund notice + Lorena heads-up).
 * `refundPence` is what was actually refunded: the full deposit, half of it
 * (24–48 h notice), or 0 (kept).
 */
export async function sendCancellationEmails(
  apiKey: string,
  b: BookingDetail,
  refundPence: Pence
): Promise<void> {
  const when = formatLondon(b.slotStartsAt);

  const refundLine =
    refundPence >= b.depositPence
      ? `<p>Your ${formatPence(b.depositPence)} deposit has been refunded in full —
         it should reach your account within 5–10 working days.</p>`
      : refundPence > 0
        ? `<p>As this was within ${FULL_REFUND_CUTOFF_HOURS} hours of the appointment,
           half your deposit (${formatPence(refundPence)}) has been refunded —
           it should reach your account within 5–10 working days.</p>`
        : `<p>As this was within ${HALF_REFUND_CUTOFF_HOURS} hours of the appointment,
           the deposit is non-refundable.</p>`;

  const client = send(apiKey, {
    to: b.clientEmail,
    subject: `Booking cancelled — ${b.serviceName}, ${when}`,
    html: `
      <h2>Booking cancelled</h2>
      <p>Hi ${escapeHtml(b.clientName)},</p>
      <p>Your <strong>${escapeHtml(b.serviceName)}</strong> appointment on
         <strong>${when}</strong> has been cancelled.</p>
      ${refundLine}
      <p>We'd love to see you another time — book again any time.</p>
    `,
  });

  const depositNote =
    refundPence >= b.depositPence
      ? "refunded in full"
      : refundPence > 0
        ? `half refunded (${formatPence(refundPence)})`
        : "kept (late cancellation)";

  const lorena = send(apiKey, {
    to: NOTIFY_EMAIL,
    subject: `Cancelled: ${b.serviceName} — ${when}`,
    html: `
      <h2>Booking cancelled</h2>
      <p><strong>${escapeHtml(b.serviceName)}</strong> at <strong>${when}</strong>
         — the slot is open again.</p>
      <ul>
        <li>Client: ${escapeHtml(b.clientName)} (${escapeHtml(b.clientEmail)})</li>
        <li>Deposit ${formatPence(b.depositPence)}: ${depositNote}</li>
      </ul>
    `,
  });

  for (const r of await Promise.all([client, lorena])) {
    if (!r.ok) console.error("cancellation email failed:", r.error);
  }
}

/** One-off operational heads-up to the notify inbox (e.g. late-payment refund). */
export async function sendOpsNotice(
  apiKey: string,
  subject: string,
  html: string
): Promise<void> {
  const r = await send(apiKey, { to: NOTIFY_EMAIL, subject, html });
  if (!r.ok) console.error("ops notice failed:", r.error);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
