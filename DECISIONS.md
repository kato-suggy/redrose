# Red Rose Ink & Beauty — Project Decisions

_Living log of locked decisions and open questions. Last updated: 9 July 2026._

## Locked decisions

### Domain & identity
- Working assumption: **`redroseinknbeauty.com`** — matches Lorena's Instagram handle.
  (Checked 29 Jun 2026: available; so is `redroseinkandbeauty.com`.) Buy via Cloudflare
  Registrar as soon as Lorena confirms the spelling.
- **`redroseholistics.org` is abandoned** — never had email, nothing to migrate; the Hostinger
  plan can lapse. Holistics gets its own linked site later if wanted.

### Architecture & stack
- **Fresh repo**, modelled on Kate's `kato-suggy/davesguitars` stack:
  **TypeScript + Hono on Cloudflare Workers** (edge SSR), **Tailwind CSS**, content as typed JSON.
- **Cloudflare D1** storage; slot-based booking model. Cal.com dropped (Next.js + Postgres,
  doesn't fit Workers); double-booking prevented by a partial unique index in SQLite.
- Interactivity stays hypermedia-style (SSR + fetch sprinkles); **no SPA framework**.
- **M2 booking UI: vanilla fetch + HTML fragments** (decided 9 Jul 2026). Datastar deferred —
  likely for M3 admin / later features; keep fragment endpoints library-agnostic so it can be
  adopted without restructuring.
- **Rust: confirmed out for this project** — saved for a future one ("right stack for the job").
  Instead the booking code is written **Rust-style TypeScript**: discriminated-union state
  machine for booking status, exhaustive `switch` with `never`, branded `Pence` type,
  `Result`-shaped errors from the Stripe layer.
- Hosting on **Cloudflare Workers from day one**; `workers.dev` until the domain is bought.

### Booking & payments
- **Custom booking ships in the first launch.** Fresha (~£15/mo) is a **contingency fallback
  only** if something goes wrong late in the build.
- **Deposit = 20% of the service price**, stored per-service (`deposit_pence`, seeded at 20%,
  overridable per service later). Balance paid in person. Charge upfront — no auth-holds.
- **Pending-payment hold: 30 minutes** (matches Stripe Checkout's minimum session expiry). Confirmed.
- **Cancellation policy (Lorena's):** cancel **≥ 48 hours** before the appointment → full deposit
  refund; **< 48 hours** → deposit forfeited. v1 implementation: self-serve cancel link
  (unguessable token) in the confirmation email; refund via Stripe API; reschedule = cancel +
  rebook. Policy displayed at checkout and in emails.
- Apple/Google Pay come free with Stripe Checkout. Klarna ruled out. Twilio SMS post-launch.
- **Resend** for transactional email — reusing Kate's existing account (new API key for this
  project; Dave's key untouched).

### Content & design
- v1 sections (Kate's placeholders — Lorena may adjust): **brows, lashes, lips, freckles**.
  Four sections fills the home grid, which closes the old "second card slot" question.
- **Placeholder pricing** until Lorena confirms the real list: e.g. brows £200 / 120 min →
  £40 deposit.
- **Functionality before styling.** Tailwind **token-first** setup: brand colours/fonts as CSS
  variables (working hexes crimson `#8E1B2E`, teal `#2A6F77`; Playfair Display + Jost), minimal
  utilitarian components while M1–M3 are built. The visual pass (M4) swaps token values and
  restyles components against Kate's fresh Claude Design mockups — markup shouldn't restructure.
- **Vectorise Lorena's current logo now**; hero photos later (logo-led hero as fallback).
- Typed JSON in `/content`, schema in `src/types.ts`; Google Sheets self-service deferred.

## Open questions / waiting on
- **Lorena:** confirm domain spelling (buy same day) · improved logo image · hero photos for the
  4 sections · real treatment list (names, durations, prices) · confirm/adjust section names.
- **By launch:** salon address + Lorena's notification email address (both go in confirmation
  emails) · Lorena's mailbox route — free (Cloudflare Email Routing → Gmail, send-as via Resend
  SMTP) vs Google Workspace (~£5/mo).
- **Client proposal** (kept out of the public repo, see .gitignore) still describes the old
  Fresha-first plan — needs revising before it goes to Lorena.

## Key documents
- `CLAUDE.md` — session context anchor (stack, conventions, pointers).
- `IMPLEMENTATION.md` — architecture, data model, booking flow, milestones. The build plan.
- Client proposal docs — local only, not committed (public repo).
