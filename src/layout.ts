import { html } from "hono/html";
import site from "../content/site.json";

/** Shared HTML shell. M1–M3: minimal utilitarian styling; M4 restyles. */
export const layout = (title: string, body: unknown) => html`<!doctype html>
  <html lang="en-GB">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title} · ${site.businessName}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
      <link
        href="https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&display=swap"
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
