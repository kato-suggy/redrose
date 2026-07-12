/**
 * Landing page. Evolved from "Red Rose Landing.dc.html" (Kate's Claude
 * Design project): the hero and visual language are the mockup's, but the
 * per-section price lists moved to /treatments — the landing now shows each
 * image exactly once (brows, lashes in the hero; freckles, lips as cards),
 * a four-row treatments menu, a reviews band, and a mini bio for /about.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import site from "../../content/site.json";
import type { Bindings } from "../env";
import { layout } from "../layout";
import { formatPence, pence, type SectionContent } from "../types";
import {
  brochureFooter,
  brochureNav,
  fixedBookBar,
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
  const card = (key: "freckles" | "lips", objPos: string) => {
    const meta = sections.find((s) => s.key === key)!;
    return html`
      <section class="border-b border-crimson/30 md:border-b-0">
        <a href="/treatments#${key}" class="block no-underline">
          <div class="h-[420px] overflow-hidden md:h-[520px]">
            <img
              src="/img/${key}@2x.webp"
              alt="${meta.title}"
              class="block h-full w-full object-cover ${objPos}"
            />
          </div>
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

          <!-- ============ hero: brows + lashes ============ -->
          <div class="relative overflow-hidden">
            <div class="grid grid-rows-[430px_430px] md:h-[720px] md:grid-cols-2 md:grid-rows-1">
              <div class="relative overflow-hidden">
                <img
                  src="/img/brows@2x.webp"
                  alt="Brows — cosmetic tattoo portrait"
                  class="block h-full w-full object-cover object-[72%_22%] md:object-[60%_18%]"
                />
                <div class="absolute inset-0 bg-crimson/60 mix-blend-multiply"></div>
              </div>
              <div class="relative overflow-hidden">
                <img
                  src="/img/lashes@2x.webp"
                  alt="Lashes — cosmetic tattoo portrait"
                  class="block h-full w-full object-cover object-[center_26%] md:object-[center_20%]"
                />
                <div
                  class="absolute inset-0 bg-gradient-to-r from-ink/40 to-transparent to-55% md:hidden"
                ></div>
              </div>
            </div>

            <div
              class="absolute inset-x-0 bottom-0 z-[2] hidden h-[300px] bg-gradient-to-t from-ink/40 to-transparent md:block"
            ></div>

            <div class="pointer-events-none absolute -left-3 top-1.5 z-[2] h-full md:hidden">
              <span
                class="font-display text-[150px] font-medium italic leading-[.78] tracking-[.01em] text-cream [text-shadow:0_0_60px_rgba(0,0,0,.2)] [writing-mode:vertical-rl]"
                >red rose</span
              >
            </div>
            <div class="absolute right-5 top-[430px] z-[2] -translate-y-1/2 md:hidden">
              <span
                class="text-[10px] font-medium tracking-[.32em] text-cream [writing-mode:vertical-rl]"
                >INK ——— BEAUTY</span
              >
            </div>
            <div class="absolute right-[52px] top-[394px] z-[2] md:hidden">
              <span class="text-[9.5px] tracking-[.28em] text-cream [writing-mode:vertical-rl]"
                >NEWCASTLE, UK</span
              >
            </div>

            <div
              class="absolute right-1/2 top-[36%] z-[2] hidden flex-col items-end gap-2 pr-[26px] md:flex"
            >
              <span class="whitespace-nowrap text-[11px] font-medium tracking-[.3em] text-cream"
                >INK ——— BEAUTY</span
              >
              <span class="whitespace-nowrap text-[10.5px] tracking-[.28em] text-cream"
                >NEWCASTLE, UK</span
              >
            </div>
            <div class="absolute left-9 top-8 z-[2] hidden md:block">
              <p class="m-0 text-[11px] font-medium tracking-[.3em] text-cream/85">
                LORENA · SEMI-PERMANENT MAKEUP
              </p>
            </div>

            <div
              class="pointer-events-none absolute inset-x-0 bottom-[-58px] z-[3] hidden text-center md:block"
            >
              <span
                class="font-display whitespace-nowrap text-[min(19.6vw,252px)] font-medium italic leading-none tracking-[-.015em] text-cream [text-shadow:0_0_80px_rgba(0,0,0,.18)]"
                >red rose</span
              >
            </div>
          </div>

          <!-- ============ intro strip ============ -->
          <div class="border-b border-crimson/30 md:hidden">
            <div class="px-[22px] pb-[38px] pt-[34px]">
              <p class="m-0 mb-1.5 text-[11px] font-medium tracking-[.26em] text-teal">
                LORENA · EST. NEWCASTLE
              </p>
              <h1
                class="font-display m-0 text-[29px] font-medium leading-[1.16] text-ink [text-wrap:pretty]"
              >
                ${site.tagline}
              </h1>
              ${solidBtn("/book", "Book now", "mt-6 min-h-[56px] text-[14px]")}
            </div>
          </div>
          <div
            class="hidden items-end justify-between gap-12 border-b border-crimson/30 px-16 py-14 md:flex"
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
            ${solidBtn("/book", "Book now", "min-h-[60px] whitespace-nowrap px-12 text-[14px]")}
          </div>

          <!-- ============ treatments menu ============ -->
          <div class="border-b border-crimson/30 px-[22px] py-9 md:px-16 md:py-14">
            <p class="${utilityCaps} m-0 mb-1">TREATMENTS</p>
            <h2 class="font-display m-0 mb-2 text-[26px] font-medium italic text-ink md:text-[30px]">
              What would you like done?
            </h2>
            ${sections.map(
              (meta) => html`
                <a
                  href="/treatments#${meta.key}"
                  class="group flex items-baseline justify-between gap-4 border-b border-crimson/30 py-4 no-underline md:py-5"
                >
                  <span class="flex items-baseline gap-3 md:gap-5">
                    <span class="${utilityCaps}">${meta.number}</span>
                    <span
                      class="font-display text-[22px] font-medium italic text-ink group-hover:text-crimson md:text-[28px]"
                      >${meta.title}</span
                    >
                  </span>
                  <span
                    class="whitespace-nowrap text-[13px] tracking-[.06em] text-ink/60 uppercase group-hover:text-crimson"
                    >from ${fromPrice(meta.key)} →</span
                  >
                </a>
              `
            )}
          </div>

          <!-- ============ freckles + lips cards ============ -->
          <div class="grid md:grid-cols-2">
            <div class="md:border-r md:border-crimson/30">
              ${card("freckles", "object-[center_24%] md:object-[center_20%]")}
            </div>
            <div>${card("lips", "object-[center_40%] md:object-[center_42%]")}</div>
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
                    <img
                      src="/redrose_logo.svg"
                      alt=""
                      class="w-44 opacity-30 md:w-56"
                    />
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
                >About Lorena →</a
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
