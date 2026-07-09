import { Hono } from "hono";
import { html } from "hono/html";
import site from "../content/site.json";
import { formatPence, pence, type Service } from "./types";
import type { Bindings } from "./env";
import { layout } from "./layout";
import booking from "./routes/booking";

const app = new Hono<{ Bindings: Bindings }>();

// Booking engine: /api/slots, /book, /booking/*, /webhooks/stripe
app.route("/", booking);

// ---------- routes ----------
app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, section, name, duration_mins, price_pence, deposit_pence FROM services WHERE active = 1 ORDER BY section, sort"
  ).all<{
    id: number;
    section: string;
    name: string;
    duration_mins: number;
    price_pence: number;
    deposit_pence: number;
  }>();

  return c.html(
    layout(
      "Scaffold",
      html`
        <main class="mx-auto max-w-2xl px-6 py-16">
          <img
            src="/redrose_logo.svg"
            alt="${site.businessName} logo"
            class="mx-auto mb-8 w-56"
          />
          <h1 class="font-display text-4xl font-bold text-crimson">
            ${site.businessName}
          </h1>
          <p class="mt-2 text-teal">${site.tagline}</p>
          <p class="mt-8 text-sm opacity-70">
            M2 — booking is live end to end (test mode). Services below are
            placeholders until Lorena confirms the real list.
          </p>
          <ul class="mt-6 space-y-2">
            ${results.map(
              (s) => html`
                <li
                  class="flex items-center justify-between gap-3 rounded border border-teal/30 bg-white/60 px-4 py-3"
                >
                  <div>
                    <span class="font-medium">${s.name}</span>
                    <span class="ml-2 text-sm opacity-70">
                      ${s.duration_mins} mins ·
                      ${formatPence(pence(s.price_pence))} (deposit
                      ${formatPence(pence(s.deposit_pence))})
                    </span>
                  </div>
                  <a
                    href="/book/${s.id}"
                    class="shrink-0 rounded bg-crimson px-4 py-2 text-sm font-medium text-cream"
                  >
                    Book
                  </a>
                </li>
              `
            )}
          </ul>
        </main>
      `
    )
  );
});

app.get("/health", (c) => c.json({ ok: true, service: "redrose" }));

export default app;
export type { Bindings, Service };
