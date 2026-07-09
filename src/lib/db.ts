/**
 * D1 access layer. Every write that can fail for a business reason returns
 * Result rather than throwing; the caller must handle slot_taken etc.
 *
 * Concurrency model: the partial unique index `one_live_booking_per_slot`
 * is the only guard. There are no transactions here — a race between two
 * holders is settled by whichever INSERT lands second violating the index.
 */

import {
  Err,
  Ok,
  pence,
  type BookingStatus,
  type Pence,
  type Result,
} from "../types";
import { HOLD_MINUTES } from "../config";
import { nowEpoch } from "./time";

export interface SlotRow {
  id: number;
  starts_at: number;
  ends_at: number;
}

export interface ServiceRow {
  id: number;
  section: string;
  name: string;
  duration_mins: number;
  price_pence: number;
  deposit_pence: number;
}

/** A booking joined with its slot + service — what emails and pages need. */
export interface BookingDetail {
  id: string;
  status: BookingStatus;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  depositPence: Pence;
  cancelToken: string;
  stripeSessionId: string | null;
  stripePaymentIntent: string | null;
  slotId: number;
  slotStartsAt: number;
  slotEndsAt: number;
  serviceName: string;
  serviceSection: string;
}

const DETAIL_SELECT = `
  SELECT b.id, b.status, b.client_name, b.client_email, b.client_phone,
         b.deposit_pence, b.cancel_token, b.stripe_session_id, b.stripe_payment_intent,
         s.id AS slot_id, s.starts_at, s.ends_at,
         sv.name AS service_name, sv.section AS service_section
  FROM bookings b
  JOIN slots s ON s.id = b.slot_id
  JOIN services sv ON sv.id = b.service_id
`;

interface DetailRow {
  id: string;
  status: BookingStatus;
  client_name: string;
  client_email: string;
  client_phone: string;
  deposit_pence: number;
  cancel_token: string;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  slot_id: number;
  starts_at: number;
  ends_at: number;
  service_name: string;
  service_section: string;
}

function toDetail(r: DetailRow): BookingDetail {
  return {
    id: r.id,
    status: r.status,
    clientName: r.client_name,
    clientEmail: r.client_email,
    clientPhone: r.client_phone,
    depositPence: pence(r.deposit_pence),
    cancelToken: r.cancel_token,
    stripeSessionId: r.stripe_session_id,
    stripePaymentIntent: r.stripe_payment_intent,
    slotId: r.slot_id,
    slotStartsAt: r.starts_at,
    slotEndsAt: r.ends_at,
    serviceName: r.service_name,
    serviceSection: r.service_section,
  };
}

/**
 * Open slots in [from, to) with no live booking. A pending booking whose
 * hold has lapsed no longer blocks the listing (the row is flipped to
 * 'expired' lazily, on the next hold attempt for that slot).
 */
export async function listOpenSlots(
  db: D1Database,
  from: number,
  to: number
): Promise<SlotRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.starts_at, s.ends_at FROM slots s
       WHERE s.status = 'open' AND s.starts_at >= ?1 AND s.starts_at < ?2
         AND NOT EXISTS (
           SELECT 1 FROM bookings b
           WHERE b.slot_id = s.id
             AND (b.status = 'confirmed'
                  OR (b.status = 'pending_payment' AND b.expires_at >= ?3))
         )
       ORDER BY s.starts_at`
    )
    .bind(from, to, nowEpoch())
    .all<SlotRow>();
  return results;
}

export async function getActiveService(
  db: D1Database,
  id: number
): Promise<ServiceRow | null> {
  return db
    .prepare(
      "SELECT id, section, name, duration_mins, price_pence, deposit_pence FROM services WHERE id = ? AND active = 1"
    )
    .bind(id)
    .first<ServiceRow>();
}

export async function getOpenSlot(
  db: D1Database,
  id: number
): Promise<SlotRow | null> {
  return db
    .prepare(
      "SELECT id, starts_at, ends_at FROM slots WHERE id = ? AND status = 'open'"
    )
    .bind(id)
    .first<SlotRow>();
}

export interface HoldRequest {
  slotId: number;
  serviceId: number;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  depositPence: Pence;
}

export interface Hold {
  bookingId: string;
  cancelToken: string;
  expiresAt: number;
}

/**
 * Atomically claim a slot: sweep any lapsed hold on it, then INSERT a
 * pending booking. If someone else holds it live, the partial unique index
 * rejects the INSERT and we return slot_taken.
 */
export async function holdSlot(
  db: D1Database,
  req: HoldRequest
): Promise<Result<Hold>> {
  const now = nowEpoch();
  const bookingId = crypto.randomUUID();
  const cancelToken = crypto.randomUUID();
  const expiresAt = now + HOLD_MINUTES * 60;

  try {
    await db.batch([
      db
        .prepare(
          "UPDATE bookings SET status = 'expired' WHERE slot_id = ?1 AND status = 'pending_payment' AND expires_at < ?2"
        )
        .bind(req.slotId, now),
      db
        .prepare(
          `INSERT INTO bookings
             (id, slot_id, service_id, client_name, client_email, client_phone,
              status, deposit_pence, cancel_token, expires_at, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending_payment', ?7, ?8, ?9, ?10)`
        )
        .bind(
          bookingId,
          req.slotId,
          req.serviceId,
          req.clientName,
          req.clientEmail,
          req.clientPhone,
          req.depositPence,
          cancelToken,
          expiresAt,
          now
        ),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE constraint failed")) {
      return Err({ kind: "slot_taken" });
    }
    return Err({ kind: "db", detail: msg });
  }
  return Ok({ bookingId, cancelToken, expiresAt });
}

export async function attachStripeSession(
  db: D1Database,
  bookingId: string,
  sessionId: string
): Promise<void> {
  await db
    .prepare("UPDATE bookings SET stripe_session_id = ? WHERE id = ?")
    .bind(sessionId, bookingId)
    .run();
}

/** If the hold couldn't reach Stripe, release it immediately. */
export async function releaseHold(
  db: D1Database,
  bookingId: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE bookings SET status = 'expired' WHERE id = ? AND status = 'pending_payment'"
    )
    .bind(bookingId)
    .run();
}

export type ConfirmOutcome =
  | { kind: "confirmed" }
  | { kind: "already_processed" } // webhook retry — nothing to do
  | { kind: "late_payment" }; // hold lapsed before payment landed

/**
 * Flip pending → confirmed. Guarded on current status, so webhook retries
 * and the late-payment race are both detected rather than double-applied.
 */
export async function confirmBooking(
  db: D1Database,
  bookingId: string,
  paymentIntent: string | null
): Promise<ConfirmOutcome> {
  const res = await db
    .prepare(
      "UPDATE bookings SET status = 'confirmed', expires_at = NULL, stripe_payment_intent = ?1 WHERE id = ?2 AND status = 'pending_payment'"
    )
    .bind(paymentIntent, bookingId)
    .run();
  if (res.meta.changes === 1) return { kind: "confirmed" };

  const row = await db
    .prepare("SELECT status FROM bookings WHERE id = ?")
    .bind(bookingId)
    .first<{ status: BookingStatus }>();
  if (row?.status === "expired") return { kind: "late_payment" };
  return { kind: "already_processed" };
}

export async function expireBooking(
  db: D1Database,
  bookingId: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE bookings SET status = 'expired' WHERE id = ? AND status = 'pending_payment'"
    )
    .bind(bookingId)
    .run();
}

/** Flip confirmed → cancelled. Returns false if it wasn't confirmed (double click, retry). */
export async function cancelBooking(
  db: D1Database,
  bookingId: string
): Promise<boolean> {
  const res = await db
    .prepare(
      "UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'"
    )
    .bind(bookingId)
    .run();
  return res.meta.changes === 1;
}

// ---------- admin ----------

export async function createSlot(
  db: D1Database,
  startsAt: number,
  endsAt: number
): Promise<number> {
  const row = await db
    .prepare(
      "INSERT INTO slots (starts_at, ends_at) VALUES (?1, ?2) RETURNING id"
    )
    .bind(startsAt, endsAt)
    .first<{ id: number }>();
  return row!.id;
}

/** A slot with whatever live booking sits on it (for the admin list). */
export interface AdminSlotRow {
  id: number;
  starts_at: number;
  ends_at: number;
  status: "open" | "blocked";
  booking_id: string | null;
  booking_status: BookingStatus | null;
  client_name: string | null;
}

export async function listSlotsAdmin(
  db: D1Database,
  from: number
): Promise<AdminSlotRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.starts_at, s.ends_at, s.status,
              b.id AS booking_id, b.status AS booking_status, b.client_name
       FROM slots s
       LEFT JOIN bookings b ON b.slot_id = s.id
         AND (b.status = 'confirmed'
              OR (b.status = 'pending_payment' AND b.expires_at >= ?2))
       WHERE s.starts_at >= ?1
       ORDER BY s.starts_at`
    )
    .bind(from, nowEpoch())
    .all<AdminSlotRow>();
  return results;
}

/**
 * Block/unblock a slot. Refuses (returns false) if a live booking sits on
 * it — blocking must never orphan a paid appointment.
 */
export async function setSlotStatus(
  db: D1Database,
  slotId: number,
  status: "open" | "blocked"
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE slots SET status = ?1 WHERE id = ?2 AND NOT EXISTS (
         SELECT 1 FROM bookings b WHERE b.slot_id = slots.id
           AND (b.status = 'confirmed'
                OR (b.status = 'pending_payment' AND b.expires_at >= ?3)))`
    )
    .bind(status, slotId, nowEpoch())
    .run();
  return res.meta.changes === 1;
}

/** Upcoming live bookings (confirmed + genuinely-pending), soonest first. */
export async function listUpcomingBookings(
  db: D1Database,
  from: number
): Promise<BookingDetail[]> {
  const { results } = await db
    .prepare(
      `${DETAIL_SELECT}
       WHERE s.starts_at >= ?1
         AND (b.status = 'confirmed'
              OR (b.status = 'pending_payment' AND b.expires_at >= ?2))
       ORDER BY s.starts_at`
    )
    .bind(from, nowEpoch())
    .all<DetailRow>();
  return results.map(toDetail);
}

export async function getBookingByToken(
  db: D1Database,
  token: string
): Promise<BookingDetail | null> {
  const row = await db
    .prepare(`${DETAIL_SELECT} WHERE b.cancel_token = ?`)
    .bind(token)
    .first<DetailRow>();
  return row ? toDetail(row) : null;
}

export async function getBookingById(
  db: D1Database,
  id: string
): Promise<BookingDetail | null> {
  const row = await db
    .prepare(`${DETAIL_SELECT} WHERE b.id = ?`)
    .bind(id)
    .first<DetailRow>();
  return row ? toDetail(row) : null;
}

export async function getBookingBySession(
  db: D1Database,
  sessionId: string
): Promise<BookingDetail | null> {
  const row = await db
    .prepare(`${DETAIL_SELECT} WHERE b.stripe_session_id = ?`)
    .bind(sessionId)
    .first<DetailRow>();
  return row ? toDetail(row) : null;
}
