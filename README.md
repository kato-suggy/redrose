# Red Rose Ink & Beauty

Website + custom booking system for a semi-permanent makeup studio in Newcastle, UK.
Built from scratch — no booking SaaS, no site builder, no SPA framework.

## Stack

- **[Hono](https://hono.dev)** on **Cloudflare Workers** — server-rendered HTML at the edge
- **Cloudflare D1** (SQLite) — services, availability slots, bookings
- **Stripe Checkout** — booking deposits (Apple Pay / Google Pay included)
- **Resend** — transactional email
- **Tailwind CSS v4** — token-first theming, CLI build, no Node in production

## Architecture notes

- **Booking model:** the owner publishes availability slots; clients pick one and pay a
  deposit online, balance in person. Double-booking is prevented *in the database* — a
  partial unique index allows at most one live booking per slot, so a race loser gets a
  clean constraint violation, not a corrupted calendar.
- **Holds:** unpaid bookings hold a slot for 30 minutes (matching Stripe Checkout session
  expiry), then lapse automatically.
- **Cancellation:** capability-URL cancel links (unguessable token in the confirmation
  email) — no client accounts. 48-hour refund policy enforced server-side, refunds via
  the Stripe API.
- **Style:** "Rust-style TypeScript" — branded `Pence` type for money, discriminated-union
  booking state machine with exhaustiveness checking, `Result`-shaped errors around
  external services.
- **Time:** stored as unix-epoch UTC, rendered Europe/London. **Money:** integer pence.

## Development

```sh
npm install
cp .dev.vars.example .dev.vars   # fill in test keys
npm run db:migrate:local
npm run dev                      # wrangler dev :8787 + tailwind --watch
stripe listen --forward-to localhost:8787/webhooks/stripe   # second terminal
```

## Status

🚧 M0 scaffold. Booking core (M1) in progress — see `IMPLEMENTATION.md` for the plan.
