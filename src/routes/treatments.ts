/**
 * /treatments — all four sections in landing order, each with its image,
 * live price list (rows deep-link to the slot picker), and a back link.
 * /about — Lorena's page; placeholder text until she supplies it.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import site from "../../content/site.json";
import type { Bindings } from "../env";
import { layout } from "../layout";
import type { SectionContent } from "../types";
import {
  brochureFooter,
  brochureNav,
  fixedBookBar,
  priceRow,
  utilityCaps,
  type BrochureServiceRow,
} from "../brochure";

const app = new Hono<{ Bindings: Bindings }>();

// object-position per image, tuned in the Claude Design mockup
const IMG_POS: Record<string, string> = {
  brows: "object-[center_12%] md:object-[center_10%]",
  lashes: "object-[center_30%] md:object-[center_46%]",
  freckles: "object-[center_24%] md:object-[center_20%]",
  lips: "object-[center_40%] md:object-[center_42%]",
};

app.get("/treatments", async (c) => {
  const { results: services } = await c.env.DB.prepare(
    "SELECT id, section, name, duration_mins, price_pence, deposit_pence FROM services WHERE active = 1 ORDER BY section, sort"
  ).all<BrochureServiceRow>();
  const sections = site.sections as SectionContent[];

  return c.html(
    layout(
      "Treatments",
      html`
        <div class="pb-[60px] md:pb-0">
          ${brochureNav()}

          <div class="border-b border-crimson/30 px-[22px] pb-8 pt-4 md:px-16 md:pb-10">
            <a
              href="/"
              class="text-[12px] font-medium tracking-[.12em] text-teal underline underline-offset-4"
              >← BACK TO HOME</a
            >
            <h1 class="font-display m-0 mt-4 text-[32px] font-medium italic text-ink md:text-[44px]">
              Treatments
            </h1>
            <p class="m-0 mt-1 text-[14px] text-ink/70">${site.bookingNotice}</p>
          </div>

          ${sections.map((meta, i) => {
            const list = services.filter((s) => s.section === meta.key);
            const flip = i % 2 === 1; // alternate image side on desktop
            return html`
              <section
                id="${meta.key}"
                class="grid scroll-mt-4 border-b border-crimson/30 md:grid-cols-2"
              >
                <div
                  class="h-[420px] overflow-hidden md:h-[560px] ${flip ? "md:order-2" : ""}"
                >
                  <img
                    src="/img/${meta.key}@2x.webp"
                    alt="${meta.title}"
                    class="block h-full w-full object-cover ${IMG_POS[meta.key] ?? ""}"
                  />
                </div>
                <div
                  class="flex flex-col px-[22px] pb-9 pt-[26px] md:justify-center md:px-16 md:py-14 ${flip ? "md:order-1" : ""}"
                >
                  <p class="${utilityCaps} m-0 mb-1">
                    ${meta.number} — ${meta.key.toUpperCase()}
                  </p>
                  <h2
                    class="font-display m-0 mb-2 text-[26px] font-medium italic text-ink md:mb-3 md:text-[32px]"
                  >
                    ${meta.title}
                  </h2>
                  ${list.map(priceRow)}
                  ${meta.blurb
                    ? html`<p class="mb-0 mt-3.5 text-[13px] text-ink/65 md:text-[14px]">
                        ${meta.blurb}
                      </p>`
                    : ""}
                  <a
                    href="/"
                    class="mt-6 inline-flex min-h-[44px] items-center text-[12px] font-medium tracking-[.12em] text-teal underline underline-offset-4"
                    >← BACK TO HOME</a
                  >
                </div>
              </section>
            `;
          })}
          ${brochureFooter()} ${fixedBookBar()}
        </div>
      `
    )
  );
});

app.get("/about", (c) => {
  return c.html(
    layout(
      "About Lorena",
      html`
        <div class="pb-[60px] md:pb-0">
          ${brochureNav()}

          <div class="grid md:grid-cols-2">
            <div class="h-[420px] overflow-hidden bg-crimson/10 md:h-auto md:min-h-[640px]">
              ${site.lorenaPhoto
                ? html`<img
                    src="${site.lorenaPhoto}"
                    alt="Lorena — Red Rose Ink & Beauty"
                    class="block h-full w-full object-cover"
                  />`
                : html`<div class="flex h-full min-h-[420px] items-center justify-center">
                    <img src="/redrose_logo.svg" alt="" class="w-44 opacity-30 md:w-64" />
                  </div>`}
            </div>
            <div class="flex flex-col px-[22px] pb-10 pt-[26px] md:justify-center md:px-16 md:py-14">
              <a
                href="/"
                class="text-[12px] font-medium tracking-[.12em] text-teal underline underline-offset-4"
                >← BACK TO HOME</a
              >
              <p class="${utilityCaps} m-0 mb-1 mt-5">YOUR ARTIST</p>
              <h1 class="font-display m-0 mb-4 text-[32px] font-medium italic text-ink md:text-[44px]">
                About Lorena
              </h1>
              ${site.aboutBody.map(
                (p) => html`<p class="m-0 mb-4 text-[15px] leading-[1.7] text-ink/75 md:text-[16px]">
                  ${p}
                </p>`
              )}
              <a
                href="/book"
                class="mt-2 inline-flex min-h-[44px] items-center text-[13px] font-semibold uppercase tracking-[.2em] text-crimson underline underline-offset-4 hover:text-crimson-deep"
                >Book with Lorena →</a
              >
            </div>
          </div>

          ${brochureFooter()} ${fixedBookBar()}
        </div>
      `
    )
  );
});

export default app;
