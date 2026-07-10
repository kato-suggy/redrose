/**
 * Core domain types. Written "Rust-style": branded primitives, discriminated
 * unions for state, exhaustive matching enforced via `never`.
 */

// ---------- Money ----------
// All money is integer pence. The brand makes it a compile error to pass a
// raw number (or, worse, a float of pounds) where pence are expected.
export type Pence = number & { readonly __brand: "Pence" };

export function pence(n: number): Pence {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`invalid pence value: ${n}`);
  }
  return n as Pence;
}

/** Format for display: 4000 → "£40", 4050 → "£40.50" */
export function formatPence(p: Pence): string {
  const pounds = p / 100;
  return p % 100 === 0 ? `£${pounds}` : `£${pounds.toFixed(2)}`;
}

// ---------- Sections & services ----------
export const SECTIONS = ["brows", "lashes", "lips", "freckles"] as const;
export type Section = (typeof SECTIONS)[number];

export function isSection(s: string): s is Section {
  return (SECTIONS as readonly string[]).includes(s);
}

export interface Service {
  id: number;
  section: Section;
  name: string;
  description: string;
  durationMins: number;
  pricePence: Pence;
  depositPence: Pence;
  active: boolean;
  sort: number;
}

// ---------- Booking state machine ----------
// The discriminated union means code can only touch fields that exist in the
// state it has proven it's in — e.g. no stripeSessionId on a raw new booking.
export type BookingStatus =
  | "pending_payment"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "no_show";

export interface Booking {
  id: string;
  slotId: number;
  serviceId: number;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  status: BookingStatus;
  depositPence: Pence;
  stripeSessionId: string | null;
  cancelToken: string;
  expiresAt: number | null; // epoch seconds, only meaningful while pending
  createdAt: number; // epoch seconds
}

export interface Slot {
  id: number;
  startsAt: number; // epoch seconds, UTC
  endsAt: number; // epoch seconds, UTC
  status: "open" | "blocked";
}

// ---------- Result (Rust-style error handling) ----------
// External calls (Stripe, Resend, D1) return Result instead of throwing, so
// callers are forced to acknowledge the failure path.
export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type AppError =
  | { kind: "slot_taken" }
  | { kind: "not_found"; what: string }
  | { kind: "stripe"; detail: string }
  | { kind: "email"; detail: string }
  | { kind: "db"; detail: string };

/** Exhaustiveness helper: `default: assertNever(x)` fails to compile if a case is missed. */
export function assertNever(x: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`);
}

// ---------- Site content (content/site.json) ----------
export interface SectionContent {
  key: Section;
  number: string; // "01" … "04" — editorial section numbering on the landing
  title: string; // display title ("Lash extensions & lifts"), not the DB name
  blurb: string; // one-liner under the price list; empty = omit
}

export interface SiteContent {
  businessName: string;
  tagline: string;
  heroHeadline: string;
  instagram: string;
  instagramLabel: string;
  salonAddress: string; // TBC — placeholder until Lorena confirms
  bookingNotice: string;
  cancellationPolicy: string;
  sections: SectionContent[];
}
