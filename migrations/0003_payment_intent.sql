-- Migration number: 0003
-- Captured from the checkout.session.completed webhook; needed to issue
-- deposit refunds without an extra Stripe API call at cancellation time.

ALTER TABLE bookings ADD COLUMN stripe_payment_intent TEXT;
