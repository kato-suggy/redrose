/**
 * Shared brochure fragments: nav, fixed mobile booking bar, buttons,
 * price rows. Used by the landing, /treatments, /about, and the /book
 * chooser so the brand renders identically everywhere.
 */

import { html } from "hono/html";
import site from "../content/site.json";
import { formatPence, pence } from "./types";

export interface BrochureServiceRow {
  id: number;
  section: string;
  name: string;
  duration_mins: number;
  price_pence: number;
  deposit_pence: number;
}

export const utilityCaps = "font-medium tracking-[.28em] text-teal text-[10.5px]";

/** A bookable service line: details left (price inline), Book button right. */
export const priceRow = (s: BrochureServiceRow) => html`
  <div class="flex items-center justify-between gap-4 border-b border-ink/15 py-3.5">
    <div>
      <span class="block text-[16px] font-medium text-ink md:text-[17px]">${s.name}</span>
      <span class="mt-0.5 block text-[13px] tracking-[.06em] text-ink/60 uppercase">
        ${s.duration_mins} mins ·
        <span class="font-medium text-crimson">${formatPence(pence(s.price_pence))}</span>
        · ${formatPence(pence(s.deposit_pence))} deposit
      </span>
    </div>
    <a
      href="/book/${s.id}"
      class="flex min-h-[44px] shrink-0 items-center justify-center border-[1.5px] border-crimson px-6 text-[12px] font-semibold uppercase tracking-[.2em] text-crimson no-underline transition-colors hover:bg-crimson hover:text-cream"
    >
      Book
    </a>
  </div>
`;

/** "Red Rose" plate-stamp overlaid inside an image container (clips with it). */
export const imageWordmark = () => html`
  <div
    class="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[45%] bg-gradient-to-t from-ink/35 to-transparent"
  ></div>
  <span
    class="font-display pointer-events-none absolute bottom-1 left-4 z-[2] whitespace-nowrap text-[19vw] font-medium italic leading-none tracking-[-.015em] text-cream [text-shadow:0_0_50px_rgba(0,0,0,.25)] md:text-[7vw]"
    >Red Rose</span
  >
`;

export const solidBtn = (href: string, label: string, extra = "") => html`
  <a
    href="${href}"
    class="flex min-h-[56px] items-center justify-center bg-crimson text-[13px] font-semibold uppercase tracking-[.2em] text-cream no-underline transition-colors hover:bg-crimson-deep ${extra}"
  >
    ${label}
  </a>
`;

export const outlineBtn = (href: string, label: string, extra = "") => html`
  <a
    href="${href}"
    class="flex min-h-[54px] items-center justify-center border-[1.5px] border-crimson text-[13px] font-semibold uppercase tracking-[.2em] text-crimson no-underline transition-colors hover:bg-crimson hover:text-cream ${extra}"
  >
    ${label}
  </a>
`;

/** Top nav: mobile = utility text / logo / utility text; desktop adds Book. */
export const brochureNav = () => html`
  <header>
    <div class="flex items-center justify-between gap-2.5 px-[18px] py-2.5 md:hidden">
      <span class="text-[9.5px] font-medium tracking-[.2em] text-ink">INK —— BEAUTY</span>
      <a href="/" class="no-underline">
        <img src="/redrose_logo.svg" alt="${site.businessName}" class="block h-[60px] w-auto" />
      </a>
      <span class="text-[9.5px] font-medium tracking-[.2em] text-ink">NEWCASTLE, UK</span>
    </div>
    <div class="hidden items-center justify-between px-8 py-2.5 md:flex">
      <a href="/" class="no-underline">
        <img src="/redrose_logo.svg" alt="${site.businessName}" class="block h-16 w-auto" />
      </a>
      <span class="text-[11px] font-medium tracking-[.26em] text-ink">NEWCASTLE, UK</span>
      <a
        href="/treatments"
        class="inline-flex min-h-[44px] items-center justify-center bg-crimson px-[26px] text-[12px] font-semibold tracking-[.22em] text-cream no-underline transition-colors hover:bg-crimson-deep"
        >BOOK NOW</a
      >
    </div>
  </header>
`;

/** Crimson site footer: wordmark, Instagram, policy line, privacy. */
export const brochureFooter = () => html`
  <footer class="bg-crimson px-[22px] pb-8 pt-9 text-cream md:px-16 md:pb-9 md:pt-12">
    <div class="md:flex md:items-end md:justify-between md:gap-12">
      <div>
        <p class="font-display m-0 text-[26px] font-medium italic md:text-[40px]">red rose</p>
        <p class="m-0 mt-1 text-[10.5px] tracking-[.26em] text-cream/75 md:mt-1.5 md:text-[11px] md:tracking-[.28em]">
          INK —— BEAUTY · NEWCASTLE, UK
        </p>
      </div>
      <a
        href="${site.instagram}"
        class="mt-[22px] inline-flex min-h-[44px] items-center text-[13px] font-medium tracking-[.18em] text-cream underline underline-offset-4 hover:opacity-75 md:mt-0"
        >INSTAGRAM — ${site.instagramLabel} ↗</a
      >
    </div>
    <div
      class="mt-4 border-cream/25 md:mt-[30px] md:flex md:items-baseline md:justify-between md:gap-6 md:border-t md:pt-[18px]"
    >
      <p class="m-0 max-w-[760px] text-[13px] leading-[1.6] text-cream/80 [text-wrap:pretty]">
        ${site.bookingNotice} ${site.cancellationPolicy}
      </p>
      <div
        class="mt-[22px] flex items-baseline justify-between gap-3 border-t border-cream/25 pt-4 text-[11.5px] text-cream/70 md:mt-0 md:justify-start md:gap-7 md:whitespace-nowrap md:border-t-0 md:pt-0"
      >
        <span>© 2026 ${site.businessName}</span>
        <a
          href="/privacy"
          class="inline-flex min-h-[44px] items-center tracking-[.12em] text-cream/70 underline underline-offset-[3px] hover:text-cream"
          >PRIVACY</a
        >
      </div>
    </div>
  </footer>
`;

/** Fixed mobile booking bar. Pages using it need pb-[60px] on their wrapper. */
export const fixedBookBar = () => html`
  <div
    class="fixed bottom-0 left-0 right-0 z-40 flex items-stretch border-t border-cream/15 bg-ink md:hidden"
  >
    <div class="flex flex-1 flex-col justify-center px-4 py-2.5">
      <span class="font-display text-[15px] italic text-cream">red rose</span>
      <span class="text-[9.5px] tracking-[.22em] text-cream/60">NEWCASTLE, UK</span>
    </div>
    ${solidBtn("/treatments", "Book now", "min-h-[60px] min-w-[150px]")}
  </div>
`;
