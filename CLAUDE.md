# Red Rose Ink & Beauty

Custom website + booking system for Lorena Garcia's cosmetic tattooing (SPMU) business in
Newcastle, UK. Built solo by Kate, part-time (~6 hrs/week). Target domain:
**redroseinknbeauty.com** (purchase pending; the old redroseholistics.org is abandoned).
Note: this repo is public (portfolio) — commercial arrangements and client-facing proposal
docs stay out of it (see .gitignore).

## Read first
- **DECISIONS.md** — locked decisions + open questions. Treat as settled unless Kate revisits them.
- **IMPLEMENTATION.md** — architecture, data model, booking flow, milestones. The build follows this.

## Stack (locked — do not relitigate)
- **TypeScript + Hono on Cloudflare Workers** (edge SSR). Mirrors Kate's proven
  `kato-suggy/davesguitars` repo patterns.
- **Cloudflare D1** (SQLite) for services / slots / bookings. Migrations in `/migrations`.
- **Tailwind CSS** via CLI build. No SPA framework — server-rendered HTML with small
  fetch/datastar sprinkles only.
- **Stripe Checkout** for booking deposits (test mode until launch). Webhook confirms bookings.
- **Resend** for transactional email (dev: `onboarding@resend.dev` → Kate's own inbox).
- Twilio SMS: deferred to post-launch. Rust: not in this build.

## Conventions
- **Brand:** deep crimson / teal / near-black / cream (working hexes: crimson `#8E1B2E`,
  teal `#2A6F77` — refine against the vectorised logo). Playfair Display headings, Jost body.
  Warm, personality-led, tattoo-flash influenced — never generic-template.
- **Content** = typed JSON in `/content` (schema in `src/types.ts`). Kate edits it for Lorena;
  Google Sheets self-service is deferred but the schema must keep that swap possible.
- **Time:** store unix-epoch UTC in D1; render Europe/London. Mind the BST/GMT switch.
- **Money:** integer pence, never floats.
- **Secrets:** `.dev.vars` locally (gitignored), `wrangler secret put` for prod. Never commit keys.
- Anything Lorena touches (the `/admin` UI, client-facing docs) must be phone-friendly and
  jargon-free — she is non-technical.

## Dev loop (once scaffolded)
- `npm run dev` — wrangler dev (:8787) + tailwind --watch
- `stripe listen --forward-to localhost:8787/webhooks/stripe` in a second terminal
- Deploy: push to GitHub → Cloudflare builds, or `npm run deploy`
