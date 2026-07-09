/** Business-policy constants. See DECISIONS.md before changing. */

/** How long a pending booking holds its slot before payment must complete. */
export const HOLD_MINUTES = 30;

/** Full deposit refund if cancelling at least this many hours before the slot. */
export const CANCEL_CUTOFF_HOURS = 48;

/**
 * Email sender/recipients. Dev: Resend's onboarding address only delivers to
 * the account owner's inbox, so test bookings must use Kate's email.
 * Launch: swap to bookings@redroseinknbeauty.com + Lorena's real address.
 */
export const EMAIL_FROM = "Red Rose Ink & Beauty <onboarding@resend.dev>";
export const NOTIFY_EMAIL = "katejsugden@gmail.com"; // PLACEHOLDER — Lorena's at launch
