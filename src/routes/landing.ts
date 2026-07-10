/**
 * Landing page — implements "Red Rose Landing.dc.html" from Kate's
 * claude.ai/design project (fetched 11 Jul 2026). Mobile-first: stacked
 * hero panels with a vertical wordmark; desktop: split two-up hero with
 * the giant wordmark breaking the seam. Section meta lives in
 * content/site.json; prices come live from D1.
 */

import { Hono } from "hono";
import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import site from "../../content/site.json";
import type { Bindings } from "../env";
import { layout } from "../layout";
import { formatPence, pence, type SectionContent } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

export interface LandingServiceRow {
  id: number;
  section: string;
  name: string;
  duration_mins: number;
  price_pence: number;
  deposit_pence: number;
}
type ServiceRow = LandingServiceRow;

// ---------- shared fragments (also used by the /book chooser) ----------

export const utilityCaps = "font-medium tracking-[.28em] text-teal text-[10.5px]";

export const priceRow = (s: ServiceRow) => html`
  <a
    href="/book/${s.id}"
    class="group flex items-baseline justify-between gap-4 border-b border-ink/15 py-3.5 no-underline"
  >
    <span class="text-[16px] font-medium text-ink md:text-[17px]">
      ${s.name}
      <span
        class="mt-0.5 block text-[13px] font-normal tracking-[.06em] text-ink/60 uppercase"
      >
        ${s.duration_mins} mins · ${formatPence(pence(s.deposit_pence))} deposit
      </span>
    </span>
    <span
      class="font-display whitespace-nowrap text-[19px] text-crimson group-hover:underline md:text-[20px]"
    >
      ${formatPence(pence(s.price_pence))}
    </span>
  </a>
`;

const solidBtn = (href: string, label: string, extra = "") => html`
  <a
    href="${href}"
    class="flex min-h-[56px] items-center justify-center bg-crimson text-[13px] font-semibold uppercase tracking-[.2em] text-cream no-underline transition-colors hover:bg-crimson-deep ${extra}"
  >
    ${label}
  </a>
`;

const outlineBtn = (href: string, label: string, extra = "") => html`
  <a
    href="${href}"
    class="flex min-h-[54px] items-center justify-center border-[1.5px] border-crimson text-[13px] font-semibold uppercase tracking-[.2em] text-crimson no-underline transition-colors hover:bg-crimson hover:text-cream ${extra}"
  >
    ${label}
  </a>
`;

/** Section body: number, title, price rows, blurb, book button. */
const sectionBody = (
  meta: SectionContent,
  services: ServiceRow[],
  button: HtmlEscapedString | Promise<HtmlEscapedString>
) => html`
  <p class="${utilityCaps} m-0 mb-1">
    ${meta.number} — ${meta.key.toUpperCase()}
  </p>
  <h2 class="font-display m-0 mb-2 text-[26px] font-medium italic text-ink md:mb-3 md:text-[30px]">
    ${meta.title}
  </h2>
  ${services.map(priceRow)}
  ${meta.blurb
    ? html`<p class="mb-0 mt-3.5 text-[13px] text-ink/65 md:text-[14px]">
        ${meta.blurb}
      </p>`
    : ""}
  ${button}
`;

// ---------- GET / ----------

app.get("/", async (c) => {
  const { results: services } = await c.env.DB.prepare(
    "SELECT id, section, name, duration_mins, price_pence, deposit_pence FROM services WHERE active = 1 ORDER BY section, sort"
  ).all<ServiceRow>();

  const bySection = new Map<string, ServiceRow[]>();
  for (const s of services) {
    const list = bySection.get(s.section);
    if (list) list.push(s);
    else bySection.set(s.section, [s]);
  }
  const sections = site.sections as SectionContent[];
  const meta = (key: string) => sections.find((s) => s.key === key)!;
  /** One service → book it directly; several → the /book chooser. */
  const bookHref = (key: string) => {
    const list = bySection.get(key) ?? [];
    const only = list.length === 1 ? list[0] : undefined;
    return only ? `/book/${only.id}` : `/book#${key}`;
  };

  return c.html(
    layout(
      site.tagline,
      html`
        <div class="pb-[60px] md:pb-0">
          <!-- ============ nav ============ -->
          <header>
            <div
              class="flex items-center justify-between gap-2.5 px-[18px] py-2.5 md:hidden"
            >
              <span class="text-[9.5px] font-medium tracking-[.2em] text-ink"
                >INK —— BEAUTY</span
              >
              <a href="/" class="no-underline">
                <img
                  src="/redrose_logo.svg"
                  alt="${site.businessName}"
                  class="block h-[60px] w-auto"
                />
              </a>
              <span class="text-[9.5px] font-medium tracking-[.2em] text-ink"
                >NEWCASTLE, UK</span
              >
            </div>
            <div
              class="hidden items-center justify-between px-8 py-2.5 md:flex"
            >
              <a href="/" class="no-underline">
                <img
                  src="/redrose_logo.svg"
                  alt="${site.businessName}"
                  class="block h-16 w-auto"
                />
              </a>
              <span class="text-[11px] font-medium tracking-[.26em] text-ink"
                >NEWCASTLE, UK</span
              >
              <a
                href="/book"
                class="inline-flex min-h-[44px] items-center justify-center bg-crimson px-[26px] text-[12px] font-semibold tracking-[.22em] text-cream no-underline transition-colors hover:bg-crimson-deep"
                >BOOK NOW</a
              >
            </div>
          </header>

          <!-- ============ hero ============ -->
          <div class="relative overflow-hidden">
            <div
              class="grid grid-rows-[430px_430px] md:h-[720px] md:grid-cols-2 md:grid-rows-1"
            >
              <div class="relative overflow-hidden">
                <img
                  src="/img/brows@2x.webp"
                  alt="Brows — cosmetic tattoo portrait"
                  class="block h-full w-full object-cover object-[72%_22%] md:object-[60%_18%]"
                />
                <div
                  class="absolute inset-0 bg-crimson/60 mix-blend-multiply"
                ></div>
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

            <!-- desktop bottom scrim -->
            <div
              class="absolute inset-x-0 bottom-0 z-[2] hidden h-[300px] bg-gradient-to-t from-ink/40 to-transparent md:block"
            ></div>

            <!-- mobile: vertical wordmark spanning both panels -->
            <div
              class="pointer-events-none absolute -left-3 top-1.5 z-[2] h-full md:hidden"
            >
              <span
                class="font-display text-[150px] font-medium italic leading-[.78] tracking-[.01em] text-cream [text-shadow:0_0_60px_rgba(0,0,0,.2)] [writing-mode:vertical-rl]"
                >red rose</span
              >
            </div>
            <!-- mobile: utility text at the seam -->
            <div
              class="absolute right-5 top-[430px] z-[2] -translate-y-1/2 md:hidden"
            >
              <span
                class="text-[10px] font-medium tracking-[.32em] text-cream [writing-mode:vertical-rl]"
                >INK ——— BEAUTY</span
              >
            </div>
            <div class="absolute right-[52px] top-[394px] z-[2] md:hidden">
              <span
                class="text-[9.5px] tracking-[.28em] text-cream [writing-mode:vertical-rl]"
                >NEWCASTLE, UK</span
              >
            </div>

            <!-- desktop: seam utility text + tagline -->
            <div
              class="absolute right-1/2 top-[36%] z-[2] hidden flex-col items-end gap-2 pr-[26px] md:flex"
            >
              <span
                class="whitespace-nowrap text-[11px] font-medium tracking-[.3em] text-cream"
                >INK ——— BEAUTY</span
              >
              <span
                class="whitespace-nowrap text-[10.5px] tracking-[.28em] text-cream"
                >NEWCASTLE, UK</span
              >
            </div>
            <div class="absolute left-9 top-8 z-[2] hidden md:block">
              <p
                class="m-0 text-[11px] font-medium tracking-[.3em] text-cream/85"
              >
                LORENA · SEMI-PERMANENT MAKEUP
              </p>
            </div>

            <!-- desktop: giant wordmark breaking the seam -->
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

          <!-- ============ 01 lashes + 02 freckles ============ -->
          <div class="grid md:grid-cols-2">
            <section id="lashes" class="border-b border-crimson/30 md:border-b-0 md:border-r">
              <div class="h-[420px] overflow-hidden md:h-[520px]">
                <img
                  src="/img/lashes@2x.webp"
                  alt="Lash extensions and lifts"
                  class="block h-full w-full object-cover object-[center_30%] md:object-[center_46%]"
                />
              </div>
              <div class="border-t-0 px-[22px] pb-9 pt-[26px] md:border-t md:border-crimson/30 md:px-9 md:pb-11 md:pt-8">
                ${sectionBody(
                  meta("lashes"),
                  bySection.get("lashes") ?? [],
                  outlineBtn(bookHref("lashes"), "Book lashes", "mt-5 md:mt-6")
                )}
              </div>
            </section>
            <section id="freckles" class="border-b border-crimson/30 md:border-b-0">
              <div class="h-[420px] overflow-hidden md:h-[520px]">
                <img
                  src="/img/freckles@2x.webp"
                  alt="Faux freckles"
                  class="block h-full w-full object-cover object-[center_24%] md:object-[center_20%]"
                />
              </div>
              <div class="px-[22px] pb-9 pt-[26px] md:border-t md:border-crimson/30 md:px-9 md:pb-11 md:pt-8">
                ${sectionBody(
                  meta("freckles"),
                  bySection.get("freckles") ?? [],
                  outlineBtn(bookHref("freckles"), "Book freckles", "mt-5 md:mt-6")
                )}
              </div>
            </section>
          </div>

          <!-- ============ 03 brows: split editorial ============ -->
          <section
            id="brows"
            class="grid border-b border-crimson/30 md:grid-cols-2 md:border-t md:border-b-0"
          >
            <div class="h-[420px] overflow-hidden md:h-[640px]">
              <img
                src="/img/brows@2x.webp"
                alt="Ombré powder brows"
                class="block h-full w-full object-cover object-[center_12%] md:object-[center_10%]"
              />
            </div>
            <div
              class="flex flex-col px-[22px] pb-9 pt-[26px] md:justify-center md:px-16 md:py-14"
            >
              ${sectionBody(
                meta("brows"),
                bySection.get("brows") ?? [],
                solidBtn(bookHref("brows"), "Book brows", "mt-5 md:mt-[26px]")
              )}
            </div>
          </section>

          <!-- ============ 04 lips: split editorial, flipped ============ -->
          <section id="lips" class="grid md:grid-cols-2 md:border-t md:border-crimson/30">
            <div class="h-[420px] overflow-hidden md:order-2 md:h-[640px]">
              <img
                src="/img/lips@2x.webp"
                alt="Lip blush"
                class="block h-full w-full object-cover object-[center_40%] md:object-[center_42%]"
              />
            </div>
            <div
              class="flex flex-col px-[22px] pb-10 pt-[26px] md:order-1 md:justify-center md:px-16 md:py-14"
            >
              ${sectionBody(
                meta("lips"),
                bySection.get("lips") ?? [],
                solidBtn(bookHref("lips"), "Book lips", "mt-5 md:mt-[26px]")
              )}
            </div>
          </section>

          <!-- ============ footer ============ -->
          <footer class="bg-crimson px-[22px] pb-8 pt-9 text-cream md:px-16 md:pb-9 md:pt-12">
            <div class="md:flex md:items-end md:justify-between md:gap-12">
              <div>
                <p class="font-display m-0 text-[26px] font-medium italic md:text-[40px]">
                  red rose
                </p>
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

          <!-- ============ fixed mobile booking bar ============ -->
          <div
            class="fixed bottom-0 left-0 right-0 z-40 flex items-stretch border-t border-cream/15 bg-ink md:hidden"
          >
            <div class="flex flex-1 flex-col justify-center px-4 py-2.5">
              <span class="font-display text-[15px] italic text-cream">red rose</span>
              <span class="text-[9.5px] tracking-[.22em] text-cream/60">NEWCASTLE, UK</span>
            </div>
            ${solidBtn("/book", "Book now", "min-h-[60px] min-w-[150px]")}
          </div>
        </div>
      `
    )
  );
});

export default app;
