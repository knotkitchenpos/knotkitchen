import React, { useState } from "react";
import { Backdrop, Cta, MobileLinks } from "./kit";
import {
  DAYS, addressLines, featuredDishes, paras, socialLinks, useGoogleFont, useLandingData, useScrolled,
} from "./data";

/**
 * Farm to Table — the seasonal kitchen.
 *
 * Warm charcoal and ember orange, headings in a heavy condensed grotesk set
 * in caps. Where the tasting room whispers, this one states things: a strip of
 * hard numbers under the hero, the growers named on the page, today's dishes
 * on what reads as a chalkboard.
 *
 * Naming the suppliers is the whole proposition of a restaurant like this, so
 * the selling points are given a section of their own rather than a row of
 * cards, and each one is presented as a producer.
 */

const FONT = "family=Oswald:wght@300;400;500;600;700&family=Manrope:wght@300;400;500;600;700";
const WRAP = "mx-auto w-full max-w-6xl px-5 sm:px-8";
const HEAD = "font-[Oswald] uppercase tracking-[0.01em]";
const CAPS = "font-[Manrope] text-[11px] font-semibold uppercase tracking-[0.18em]";
const EMBER = "text-[#e2701e]";
const LINE = "border-white/10";
const BTN = `${CAPS} inline-flex items-center justify-center bg-[#e2701e] px-8 py-3.5 text-[#160f0a] transition hover:bg-[#f08536]`;
const GHOST = `${CAPS} inline-flex items-center justify-center border border-white/25 px-7 py-3.5 text-white transition hover:border-[#e2701e] hover:text-[#e2701e]`;

export default function FarmToTable({ landing, store, menuPath }) {
  useGoogleFont(FONT);
  const { symbol, categories, offers, hours, contact, features, gallery, show } =
    useLandingData(landing, store);
  const scrolled = useScrolled(60);
  const [open, setOpen] = useState(false);
  const dishes = featuredDishes(landing, categories, 3);

  const links = [
    show.features ? { id: "growers", label: "Producers" } : null,
    show.menu ? { id: "board", label: "Today" } : null,
    show.about ? { id: "hearth", label: "Our Story" } : null,
    show.hours || show.contact ? { id: "visit", label: "Hours & Booking" } : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-[#161311] font-[Manrope] text-[15px] leading-6 text-[#efe9e3]">
      {/* A running note across the top, the way a kitchen chalks up what
          landed this morning. */}
      <div className={`hidden border-b bg-[#0f0d0b] py-2 md:block ${LINE}`}>
        <div className={`${WRAP} flex items-center justify-between gap-6 ${CAPS} text-[10px] text-white/45`}>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#e2701e]" />
            Daily Harvest Update
          </span>
          <span className="truncate">{landing.subheadline}</span>
        </div>
      </div>

      <header className={`sticky top-0 z-50 transition-colors ${scrolled || open ? `bg-[#161311]/97 backdrop-blur border-b ${LINE}` : "bg-transparent"}`}>
        <div className={`${WRAP} flex h-[68px] items-center justify-between gap-5`}>
          <a href="#top" className="flex min-w-0 items-center gap-3">
            {landing.logo ? <img src={landing.logo} alt="" className="h-10 w-10 rounded-sm object-cover" /> : null}
            <span className={`${HEAD} truncate text-[20px] font-600`}>{landing.headline}</span>
          </a>
          <nav className="hidden items-center gap-7 lg:flex">
            {links.map((l) => (
              <a key={l.id} href={`#${l.id}`} className={`${CAPS} text-white/55 transition hover:text-white`}>{l.label}</a>
            ))}
            <Cta to={menuPath} label={landing.ctaText} className={`${BTN} !px-6 !py-2.5`} />
          </nav>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className={`${CAPS} border border-white/25 px-4 py-2 lg:hidden`}>
            {open ? "Close" : "Menu"}
          </button>
        </div>
        <MobileLinks open={open} links={links} onClose={() => setOpen(false)}
          className={`${WRAP} flex flex-col border-t bg-[#161311] pb-5 lg:hidden ${LINE}`}
          linkClass={`${CAPS} py-3`} />
      </header>

      {/* ---- Hero: words left, hard numbers underneath ------------------ */}
      <section id="top" className="relative flex min-h-[82vh] items-end">
        <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} fallback="bg-[#241a12]" />
        <div className={`${WRAP} relative w-full pb-16 pt-36`}>
          <span className={`${CAPS} ${EMBER}`}>Seasonal Kitchen</span>
          <h1 className={`${HEAD} mt-5 max-w-3xl text-[38px] leading-[1.05] sm:text-[62px]`}>
            {landing.headline}
          </h1>
          {landing.subheadline ? (
            <p className="mt-6 max-w-xl text-[17px] leading-[28px] text-white/70">{landing.subheadline}</p>
          ) : null}
          <div className="mt-9 flex flex-wrap gap-3">
            <Cta to={menuPath} label={landing.ctaText} className={BTN} />
            {show.features ? <a href="#growers" className={GHOST}>Meet the Growers</a> : null}
          </div>
        </div>
      </section>

      {show.features ? (
        <div className={`border-y bg-[#0f0d0b] ${LINE}`}>
          <div className={`${WRAP} grid divide-y divide-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0`}>
            {features.map((f, i) => (
              <div key={f.title || i} className="py-7 sm:px-8 sm:first:pl-0 sm:last:pr-0">
                <div className={`${HEAD} ${EMBER} text-[26px]`}>{f.title}</div>
                {f.text ? <div className="mt-1.5 text-[13px] leading-5 text-white/50">{f.text}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ---- Producers -------------------------------------------------- */}
      {show.features ? (
        <section id="growers" className="py-20">
          <div className={WRAP}>
            <span className={`${CAPS} ${EMBER}`}>Sourcing & Provenance</span>
            <h2 className={`${HEAD} mb-10 mt-4 text-[30px] sm:text-[42px]`}>Local Producers &amp; Purveyors</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {features.map((f, i) => (
                <div key={`p${i}`} className={`flex gap-5 border bg-[#1d1917] p-6 ${LINE}`}>
                  {f.image ? (
                    <img src={f.image.thumbnail || f.image.url} alt="" loading="lazy" className="h-20 w-20 shrink-0 object-cover" />
                  ) : (
                    <span className={`${HEAD} ${EMBER} w-20 shrink-0 text-[34px]`}>{String(i + 1).padStart(2, "0")}</span>
                  )}
                  <div className="min-w-0">
                    <h3 className={`${HEAD} text-[20px]`}>{f.title}</h3>
                    {f.text ? <p className="mt-1.5 text-[13px] leading-5 text-white/50">{f.text}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Today's board: a few dishes, not the catalogue -------------- */}
      {show.menu && dishes.length ? (
        <section id="board" className={`border-y bg-[#0f0d0b] py-20 ${LINE}`}>
          <div className={WRAP}>
            <div className="mb-10 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <span className={`${CAPS} ${EMBER}`}>Chalked Up This Morning</span>
                <h2 className={`${HEAD} mt-4 text-[30px] sm:text-[42px]`}>
                  {landing.titles?.menu || "The Daily Board"}
                </h2>
              </div>
              <Cta to={menuPath} label="See the whole board" className={`${CAPS} ${EMBER} self-start border-b border-[#e2701e]/40 pb-1 hover:border-[#e2701e] sm:self-auto`} />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {dishes.map((d) => (
                <a key={d.id} href={menuPath} className={`group flex flex-col border bg-[#1d1917] transition hover:border-[#e2701e]/50 ${LINE}`}>
                  {d.image ? (
                    <img src={d.thumbnail || d.image} alt={d.imageAlt || d.name} loading="lazy" className="h-48 w-full object-cover" />
                  ) : null}
                  <div className="flex flex-1 flex-col p-6">
                    <span className={`${CAPS} text-white/40`}>{d.category}</span>
                    <h3 className={`${HEAD} mt-2 text-[22px] leading-tight`}>{d.name}</h3>
                    {d.description ? (
                      <p className="mt-2 flex-1 text-[13px] leading-5 text-white/50">{d.description}</p>
                    ) : <span className="flex-1" />}
                    <span className={`${HEAD} ${EMBER} mt-5 text-[22px]`}>{symbol}{d.price}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Story around the fire -------------------------------------- */}
      {show.about ? (
        <section id="hearth" className="py-20">
          <div className={`${WRAP} grid items-center gap-12 lg:grid-cols-2`}>
            <div>
              <span className={`${CAPS} ${EMBER}`}>Shared Chemistry</span>
              <h2 className={`${HEAD} mt-4 text-[30px] sm:text-[42px]`}>
                {landing.titles?.about || "Gather Around the Fire"}
              </h2>
              {paras(landing.about?.text).map((p, i) => (
                <p key={i} className="mt-5 text-[16px] leading-[28px] text-white/60">{p}</p>
              ))}
            </div>
            {landing.about?.image ? (
              <img src={landing.about.image.url} alt={landing.about.image.alt || ""} loading="lazy"
                className="h-[24rem] w-full object-cover lg:h-[30rem]" />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ---- Gallery: one wide plate, three below ----------------------- */}
      {show.gallery ? (
        <section className="pb-20">
          <div className={WRAP}>
            <div className="grid gap-3">
              {gallery[0] ? (
                <img src={gallery[0].url} alt={gallery[0].alt || ""} loading="lazy" className="h-72 w-full object-cover sm:h-[26rem]" />
              ) : null}
              <div className="grid grid-cols-3 gap-3">
                {gallery.slice(1, 4).map((g, i) => (
                  <img key={g.url + i} src={g.thumbnail || g.url} alt={g.alt || ""} loading="lazy"
                    className="aspect-[4/3] w-full object-cover" />
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Offers as dated events ------------------------------------- */}
      {show.offers ? (
        <section className={`border-y bg-[#0f0d0b] py-20 ${LINE}`}>
          <div className={WRAP}>
            <span className={`${CAPS} ${EMBER}`}>On the Calendar</span>
            <h2 className={`${HEAD} mb-9 mt-4 text-[30px] sm:text-[42px]`}>
              {landing.titles?.offers || "Harvest Dinners"}
            </h2>
            <ul className={`divide-y border-y divide-white/10 ${LINE}`}>
              {offers.map((o, i) => (
                <li key={o.code || o.title || i} className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h3 className={`${HEAD} text-[22px]`}>{o.title}</h3>
                    {o.description ? <p className="mt-1.5 text-[13px] leading-5 text-white/50">{o.description}</p> : null}
                  </div>
                  {o.code ? <span className={`${CAPS} ${EMBER} shrink-0 border border-[#e2701e]/40 px-4 py-2`}>{o.code}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/* ---- Hours & booking -------------------------------------------- */}
      {show.hours || show.contact ? (
        <section id="visit" className="py-20">
          <div className={WRAP}>
            <span className={`${CAPS} ${EMBER}`}>Join Us at the Table</span>
            <h2 className={`${HEAD} mb-10 mt-4 text-[30px] sm:text-[42px]`}>
              {landing.titles?.contact || "Hours, Location & Booking"}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {show.contact ? (
                <div className={`border bg-[#1d1917] p-8 ${LINE}`}>
                  <h3 className={`${HEAD} mb-5 text-[22px]`}>Find Us</h3>
                  <div className="space-y-1 text-[15px] leading-[26px] text-white/60">
                    {addressLines(contact)?.map((line) => <p key={line}>{line}</p>)}
                  </div>
                  {contact.phone ? (
                    <a href={`tel:${contact.phone}`} className={`${BTN} mt-6 w-full`}>Call {contact.phone}</a>
                  ) : null}
                  {contact.mapUrl ? (
                    <a href={contact.mapUrl} target="_blank" rel="noreferrer noopener" className={`${GHOST} mt-3 w-full`}>Directions</a>
                  ) : null}
                </div>
              ) : null}
              {show.hours ? (
                <div className={`border bg-[#1d1917] p-8 ${LINE}`}>
                  <h3 className={`${HEAD} mb-5 text-[22px]`}>Kitchen Hours</h3>
                  <ul className="divide-y divide-white/10">
                    {hours.map((h) => (
                      <li key={h.day} className="flex justify-between gap-6 py-2.5 text-[14px]">
                        <span className="text-white/45">{DAYS[h.day]}</span>
                        <span>{h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <footer className={`border-t bg-[#0f0d0b] py-12 ${LINE}`}>
        <div className={`${WRAP} flex flex-col items-center justify-between gap-6 sm:flex-row`}>
          <span className={`${HEAD} text-[22px]`}>{landing.headline}</span>
          <div className={`${CAPS} flex gap-7 text-white/45`}>
            {socialLinks(contact).map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer noopener" className="hover:text-white">{l.label}</a>
            ))}
          </div>
          <Cta to={menuPath} label={landing.ctaText} className={BTN} />
        </div>
      </footer>
    </div>
  );
}
