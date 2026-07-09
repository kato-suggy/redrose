# Implementation Plan — Red Rose Ink & Beauty

_Build plan for the site + custom booking system. Decisions and stack: see DECISIONS.md.
Last updated: 29 June 2026._

## Shape

One Cloudflare Worker serves everything — brochure pages and booking engine share a runtime,
a repo, and a deploy:

```
browser ──► Hono router (Cloudflare Worker)
             ├─ GET  pages (SSR HTML + Tailwind)          ◄── content/*.json
             ├─ GET  /api/slots?from&to                   ◄── D1
             ├─ POST /book        → hold slot + create Stripe Checkout session
             ├─ POST /webhooks/stripe → confirm booking → Resend emails
             └─ /admin/*  (basic auth) → Lorena: manage slots, view bookings
```

No SPA. Server-rendered HTML; the booking calendar updates via small fetch calls returning
HTML fragments (or datastar — decision point below).

## Data model (D1 / SQLite)

```sql
-- what can be booked (also feeds the price lists)
CREATE TABLE services (
  id            INTEGER PRIMARY KEY,
  section       TEXT NOT NULL,               -- 'brows' | 'lashes' | ...
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  duration_mins INTEGER NOT NULL,
  price_pence   INTEGER NOT NULL,
  deposit_pence INTEGER NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  sort          INTEGER NOT NULL DEFAULT 0
);

-- bookable windows Lorena publishes
CREATE TABLE slots (
  id        INTEGER PRIMARY KEY,
  starts_at INTEGER NOT NULL,                -- unix epoch, UTC
  ends_at   INTEGER NOT NULL,
  status    TEXT NOT NULL DEFAULT 'open'     -- 'open' | 'blocked'
);

CREATE TABLE bookings (
  id                TEXT PRIMARY KEY,        -- uuid
  slot_id           INTEGER NOT NULL REFERENCES slots(id),
  service_id        INTEGER NOT NULL REFERENCES services(id),
  client_name       TEXT NOT NULL,
  client_email      TEXT NOT NULL,
  client_phone      TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL,           -- 'pending_payment' | 'confirmed' | 'cancelled' | 'expired' | 'no_show'
  deposit_pence     INTEGER NOT NULL,
  stripe_session_id TEXT,
  cancel_token      TEXT NOT NULL,           -- capability token for self-serve cancellation
  expires_at        INTEGER,                 -- pending-hold deadline
  created_at        INTEGER NOT NULL
);

-- THE concurrency guard: the DB itself enforces "at most one live booking per slot"
CREATE UNIQUE INDEX one_live_booking_per_slot
  ON bookings(slot_id) WHERE status IN ('pending_payment','confirmed');

CREATE UNIQUE INDEX bookings_cancel_token ON bookings(cancel_token);
```

Notes
- **Time:** epoch UTC in the DB, rendered Europe/London. Admin enters local times; convert on write.
- **Money:** integer pence everywhere.
- **v1 simplification:** a booking consumes its whole slot regardless of service duration —
  Lorena sizes slots when she creates them. (Duration-aware packing is a later refinement.)
- **Data protection:** bookings hold ordinary contact data only. Medical/consent forms stay on
  paper at the appointment — never in this DB. Privacy page required at launch.

## Booking flow

1. Service page → **Book** → calendar of days with open slots (`GET /api/slots`).
2. Client picks a slot, enters name/email/phone → `POST /book`:
   a. expire stale holds: `UPDATE bookings SET status='expired' WHERE slot_id=? AND status='pending_payment' AND expires_at < unixepoch()`
   b. `INSERT` booking `status='pending_payment'`, `expires_at = now + 30 min`
      → the unique index rejects a race loser cleanly ("sorry — that slot was just taken")
   c. create Stripe Checkout Session (deposit amount, `expires_at` ≈ 30 min,
      `metadata.booking_id`) → 303 redirect to Stripe.
3. Stripe-hosted payment page (card / Apple Pay / Google Pay — automatic).
4. Webhook:
   - `checkout.session.completed` → booking `confirmed` → Resend: confirmation to client +
     notification to Lorena.
   - `checkout.session.expired` → booking `expired` (slot frees itself).
5. `GET /booking/success` | `/booking/cancelled` outcome pages.
6. **Cancellation (self-serve):** the confirmation email carries `/booking/cancel/:token`
   (unguessable per-booking token, not the booking id).
   - **≥ 48 h before the slot:** page shows the booking + a cancel button → full deposit refund
     via Stripe's refund API → status `cancelled` → slot frees automatically (the unique index
     only counts live statuses) → emails to client and Lorena.
   - **< 48 h:** non-refundable notice + Lorena's contact details for rearranging.
   - Cutoff is a config constant (`CANCEL_CUTOFF_HOURS = 48`). Policy text appears on the
     checkout page and in the confirmation email. Reschedule in v1 = cancel + rebook.

Stripe on Workers (npm `stripe` — the SDK, not the CLI):
```ts
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
// webhook verification (Workers has no Node crypto):
await stripe.webhooks.constructEventAsync(rawBody, sig, env.STRIPE_WEBHOOK_SECRET,
  undefined, Stripe.createSubtleCryptoProvider());
```

## Admin (v1)

- `/admin` behind basic auth (`ADMIN_PASSWORD` secret). Upgrade path: Cloudflare Access.
- Create slots (date + times; a "repeat weekly" helper if manual entry proves tedious),
  view/cancel bookings, block slots.
- Phone-friendly and jargon-free — Lorena is the user.

## Routes

| Route | Purpose |
|---|---|
| `GET /` | landing — logo hero, section cards |
| `GET /treatments/:section` | description + price list, Book button per service |
| `GET /book/:serviceId` | calendar / slot picker |
| `GET /api/slots?from&to` | open slots (HTML fragment or JSON) |
| `POST /book` | hold slot + create Checkout session |
| `GET /booking/success` `/booking/cancelled` | outcome pages |
| `GET/POST /booking/cancel/:token` | self-serve cancellation (48 h refund policy) |
| `POST /webhooks/stripe` | Stripe events |
| `GET/POST /admin/*` | slot + booking management |

## Email (Resend)

- On confirmation: client email (details, deposit paid, salon address, prep notes, cancellation
  policy + cancel link) + Lorena notification.
- On cancellation: refund confirmation to client + notification to Lorena.
- Post-launch: day-before reminder via Workers **cron trigger**; Twilio SMS hangs off the same
  trigger later.
- Dev: send from `onboarding@resend.dev` to Kate's own inbox (no domain needed).
  Launch: verify domain in Resend → send from `bookings@redroseinknbeauty.com`.

## Milestones (Kate ≈ 6 hrs/week; the Fable sprint may compress M0–M2 substantially)

| # | What | ~Hours |
|---|---|---|
| M0 | Scaffold: git + GitHub, wrangler + Hono hello-world, Tailwind build, D1 + first migration, deploy to workers.dev, `.dev.vars` | 2–3 |
| M1 | **Booking core:** schema, slot queries, atomic hold, Checkout session, webhook, cancellation + Stripe refund, emails — fully testable via curl before any UI | 10–14 |
| M2 | Booking UI: calendar page, slot picker, details form, outcome pages | 6–10 |
| M3 | Admin: auth, slot creation, bookings list | 6–8 |
| M4 | Brochure: landing, section pages, price lists from content JSON, brand styling from Claude Design mockups | 8–12 |
| M5 | Launch: domain, DNS, Resend verify, Stripe live keys + prod webhook, Apple Pay domain registration, privacy page, reminders cron, live £1 test booking + refund | 4–6 |

## Secrets / env (`.dev.vars` locally — gitignored; `wrangler secret put` in prod)

| Name | Source |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe dashboard — **test** `sk_test_…` until launch |
| `STRIPE_WEBHOOK_SECRET` | printed by `stripe listen` locally; dashboard endpoint at launch |
| `RESEND_API_KEY` | Resend dashboard |
| `ADMIN_PASSWORD` | choose one |

## Local dev loop

```
terminal 1:  npm run dev            # wrangler dev :8787 + tailwind --watch
terminal 2:  stripe listen --forward-to localhost:8787/webhooks/stripe
```
Test card: `4242 4242 4242 4242`, any future expiry, any CVC.

## Styling approach (functionality first)

- Tailwind **token-first**: brand as CSS variables (Tailwind v4 `@theme`) —
  `--color-crimson: #8E1B2E`, `--color-teal: #2A6F77`, near-black, cream;
  `--font-display: "Playfair Display"`, `--font-body: "Jost"`.
- M1–M3 ship with minimal utilitarian styling on semantic markup — just enough structure to
  test the booking flow on a phone.
- The visual pass (M4) swaps token values and restyles components against Kate's fresh Claude
  Design mockups; markup shouldn't need restructuring.

## Placeholders (until Lorena confirms)

- Sections: **brows, lashes, lips, freckles** (Kate's picks — easily renamed).
- Services seeded with obviously-placeholder values: brows £200 / 120 min → £40 deposit
  (20%); other sections scaled similarly.
- Deposit rule: **20% of service price**, precomputed into `deposit_pence` at seed time so
  Lorena can override individual services later without changing code.
- Salon address + Lorena's notification email: TBC — placeholder strings in email templates.

## Decision points for Kate

- **Calendar interactivity (decide at M2):** vanilla fetch + HTML fragments vs **datastar**
  (~10KB, declarative, the htmx itch scratched properly). Either fits the SSR shape.
- **Slot entry UX:** start with explicit slot creation; add a weekly-template helper only if
  Lorena finds it tedious.

*(Resolved: hold window 30 min ✓ · deposits per-service at 20% ✓ · cancellation 48 h ✓ ·
booking ships in first launch, Fresha contingency ✓)*
