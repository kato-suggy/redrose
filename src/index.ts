import { Hono } from "hono";
import { html } from "hono/html";
import site from "../content/site.json";
import { formatPence, pence, type Service } from "./types";

type Bindings = {
  DB: D1Database;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
  ADMIN_PASSWORD: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// ---------- layout ----------
const layout = (title: string, body: unknown) => html`<!doctype html>
  <html lang="en-GB">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title} · ${site.businessName}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
      <link
        href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600&family=Playfair+Display:wght@500;700&display=swap"
        rel="stylesheet"
      />
      <link rel="stylesheet" href="/styles.css" />
      <link rel="icon" href="/favicon.ico" sizes="48x48" />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    </head>
    <body class="min-h-screen bg-cream font-body text-ink">
      ${body}
    </body>
  </html>`;

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
            M0 scaffold — booking system under construction. Placeholder
            services below prove the D1 → SSR pipeline works.
          </p>
          <ul class="mt-6 space-y-2">
            ${results.map(
              (s) => html`
                <li class="rounded border border-teal/30 bg-white/60 px-4 py-3">
                  <span class="font-medium">${s.name}</span>
                  <span class="ml-2 text-sm opacity-70">
                    ${s.duration_mins} mins ·
                    ${formatPence(pence(s.price_pence))} (deposit
                    ${formatPence(pence(s.deposit_pence))})
                  </span>
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
