/**
 * Landing page. Four treatment cards in one pattern — image with a
 * "Red Rose" plate-stamp overlay, caption + Book CTA beneath. Brows and
 * lashes lead as the (grander, tinted) hero pair; freckles and lips
 * follow. Then reviews and the mini bio. Price lists live on /treatments;
 * every Book CTA points there.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import site from "../../content/site.json";
import type { Bindings } from "../env";
import { layout } from "../layout";
import { formatPence, pence, type Section, type SectionContent } from "../types";
import {
  brochureFooter,
  brochureNav,
  fixedBookBar,
  imageWordmark,
  solidBtn,
  outlineBtn,
  utilityCaps,
  type BrochureServiceRow,
} from "../brochure";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async (c) => {
  const { results: services } = await c.env.DB.prepare(
    "SELECT id, section, name, duration_mins, price_pence, deposit_pence FROM services WHERE active = 1 ORDER BY section, sort"
  ).all<BrochureServiceRow>();

  const sections = site.sections as SectionContent[];
  const fromPrice = (key: string) => {
    const prices = services
      .filter((s) => s.section === key)
      .map((s) => s.price_pence);
    return prices.length ? formatPence(pence(Math.min(...prices))) : "";
  };

  /** One treatment card: image (wordmark inside), caption + CTA below. */
  const card = (
    key: Section,
    opts: {
      imgClass: string;
      tint?: boolean;
      heroImg?: boolean;
      alt: string;
      wordmark?: Parameters<typeof imageWordmark>[0];
    }
  ) => {
    const meta = sections.find((s) => s.key === key)!;
    return html`
      <section id="${key}" class="border-b border-crimson/30 md:border-b-0">
        <a href="/treatments#${key}" class="relative block overflow-hidden no-underline">
          <div class="${opts.heroImg ? "h-[430px] md:h-[640px]" : "h-[420px] md:h-[520px]"} overflow-hidden">
            <img
              src="/img/${key}@2x.webp"
              alt="${opts.alt}"
              class="block h-full w-full object-cover ${opts.imgClass}"
            />
          </div>
          ${opts.tint
            ? html`<div class="absolute inset-0 bg-crimson/60 mix-blend-multiply"></div>`
            : ""}
          ${imageWordmark(opts.wordmark)}
        </a>
        <div class="px-[22px] pb-9 pt-[26px] md:border-t md:border-crimson/30 md:px-9 md:pb-11 md:pt-8">
          <p class="${utilityCaps} m-0 mb-1">${meta.number} — ${key.toUpperCase()}</p>
          <h2 class="font-display m-0 mb-1 text-[26px] font-medium italic text-ink md:text-[30px]">
            ${meta.title}
          </h2>
          <p class="m-0 text-[13px] tracking-[.06em] text-ink/60 uppercase md:text-[14px]">
            from ${fromPrice(key)}
          </p>
          ${outlineBtn(`/treatments#${key}`, `Book ${key}`, "mt-5 md:mt-6")}
        </div>
      </section>
    `;
  };

  return c.html(
    layout(
      site.tagline,
      html`
        <div class="pb-[60px] md:pb-0">
          ${brochureNav()}

          <!-- ============ hero pair: brows + lashes ============ -->
          <div class="grid md:grid-cols-2">
            <div class="relative md:border-r md:border-crimson/30">
              <div class="absolute left-5 top-5 z-[3] hidden md:block">
                <p class="m-0 text-[11px] font-medium tracking-[.3em] text-cream/85">
                  LORENA · SEMI-PERMANENT MAKEUP
                </p>
              </div>
              ${card("brows", {
                imgClass: "object-[72%_22%] md:object-[60%_18%]",
                tint: true,
                heroImg: true,
                alt: "Brows — cosmetic tattoo portrait",
              })}
            </div>
            <div>
              ${card("lashes", {
                imgClass: "object-[center_26%] md:object-[center_20%]",
                heroImg: true,
                alt: "Lashes — cosmetic tattoo portrait",
                wordmark: { tone: "crimson", anchor: "top" },
              })}
            </div>
          </div>

          <!-- ============ intro strip ============ -->
          <div class="border-t border-crimson/30 md:hidden">
            <div class="px-[22px] pb-[38px] pt-[34px]">
              <p class="m-0 mb-1.5 text-[11px] font-medium tracking-[.26em] text-teal">
                LORENA · EST. NEWCASTLE
              </p>
              <h1
                class="font-display m-0 text-[29px] font-medium leading-[1.16] text-ink [text-wrap:pretty]"
              >
                ${site.tagline}
              </h1>
              ${solidBtn("/treatments", "Book now", "mt-6 min-h-[56px] text-[14px]")}
            </div>
          </div>
          <div
            class="hidden items-end justify-between gap-12 border-t border-crimson/30 px-16 py-14 md:flex"
          >
            <div class="max-w-[560px]">
              <p class="m-0 mb-2 text-[11px] font-medium tracking-[.28em] text-teal">
                SEMI-PERMANENT MAKEUP · NEWCASTLE
              </p>
              <h1
                class="font-display m-0 text-[44px] font-medium leading-[1.12] text-ink [text-wrap:pretty]"
              >
                ${site.heroHeadline}
              </h1>
            </div>
            ${solidBtn("/treatments", "Book now", "min-h-[60px] whitespace-nowrap px-12 text-[14px]")}
          </div>

          <!-- ============ freckles + lips ============ -->
          <div class="grid border-t border-crimson/30 md:grid-cols-2">
            <div class="md:border-r md:border-crimson/30">
              ${card("freckles", {
                imgClass: "object-[center_24%] md:object-[center_20%]",
                alt: "Faux freckles",
                wordmark: { tone: "crimson", anchor: "top", side: "right" },
              })}
            </div>
            <div>
              ${card("lips", {
                imgClass: "object-[center_40%] md:object-[center_42%]",
                tint: true,
                alt: "Lip blush",
                wordmark: { tone: "cream", side: "right" },
              })}
            </div>
          </div>

          <!-- ============ reviews ============ -->
          <div class="border-t border-crimson/30 px-[22px] py-9 md:px-16 md:py-14">
            <p class="${utilityCaps} m-0 mb-1">KIND WORDS</p>
            <h2 class="font-display m-0 mb-6 text-[26px] font-medium italic text-ink md:text-[30px]">
              What clients say
            </h2>
            <div class="grid gap-5 md:grid-cols-3 md:gap-8">
              ${site.reviews.map(
                (r) => html`
                  <figure class="m-0 border-l-2 border-crimson/40 pl-4 md:pl-5">
                    <blockquote
                      class="font-display m-0 text-[17px] italic leading-[1.5] text-ink/85 md:text-[18px]"
                    >
                      “${r.quote}”
                    </blockquote>
                    <figcaption class="mt-3 text-[12px] tracking-[.12em] text-ink/60 uppercase">
                      ${r.name} · <span class="text-teal">${r.source}</span>
                    </figcaption>
                  </figure>
                `
              )}
            </div>
          </div>

          <!-- ============ mini bio ============ -->
          <div class="grid border-t border-crimson/30 md:grid-cols-2">
            <div class="h-[380px] overflow-hidden bg-crimson/10 md:h-auto">
              ${site.lorenaPhoto
                ? html`<img
                    src="${site.lorenaPhoto}"
                    alt="Lorena — Red Rose Ink & Beauty"
                    class="block h-full w-full object-cover"
                  />`
                : html`<div class="flex h-full min-h-[380px] items-center justify-center">
                    <img src="/redrose_logo.svg" alt="" class="w-44 opacity-30 md:w-56" />
                  </div>`}
            </div>
            <div class="flex flex-col justify-center px-[22px] py-9 md:px-16 md:py-14">
              <p class="${utilityCaps} m-0 mb-1">YOUR ARTIST</p>
              <h2 class="font-display m-0 mb-3 text-[26px] font-medium italic text-ink md:text-[30px]">
                Meet Lorena
              </h2>
              <p class="m-0 text-[15px] leading-[1.7] text-ink/75 md:text-[16px]">
                ${site.bioIntro}
              </p>
              <a
                href="/about"
                class="mt-5 inline-flex min-h-[44px] items-center text-[13px] font-semibold uppercase tracking-[.2em] text-crimson underline underline-offset-4 hover:text-crimson-deep"
                >About Lorena</a
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
