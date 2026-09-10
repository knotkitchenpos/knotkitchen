import React, { useState } from "react";
import { Backdrop, Cta, MobileLinks } from "./kit";
import {
  DAYS_SHORT, addressLines, featuredDishes, paras, socialLinks, useGoogleFont, useLandingData, useScrolled,
} from "./data";

/**
 * Urban Izakaya — the late kitchen.
 *
 * The loud one. Near-black with a hot red, headings in a heavy condensed face
 * set in caps, and a running status bar that says whether the kitchen is still
 * open — which is the only question a customer has at eleven at night.
 *
 * It is also the only one of the five that leads with ordering rather than
 * with atmosphere: a live-looking status strip, a dish card pinned beside the
 * headline with its price, and an order button in reach at every scroll depth.
 */

const FONT = "family=Bebas+Neue&family=Manrope:wght@300;400;500;600;700;800";
const WRAP = "mx-auto w-full max-w-6xl px-5 sm:px-8";
const DISPLAY = "font-['Bebas_Neue'] tracking-[0.01em]";
const CAPS = "font-['Manrope'] text-[11px] font-bold uppercase tracking-[0.16em]";
const RED = "text-[#ff3b30]";
const LINE = "border-white/10";
const BTN = `${CAPS} inline-flex items-center justify-center rounded-sm bg-[#ff3b30] px-8 py-3.5 text-white transition hover:bg-[#e02a20]`;
const GHOST = `${CAPS} inline-flex items-center justify-center rounded-sm border border-white/25 px-7 py-3.5 text-white transition hover:border-[#ff3b30] hover:text-[#ff3b30]`;

export default function UrbanIzakaya({ landing, store, menuPath }) {
  useGoogleFont(FONT);
  const { symbol, categories, offers, hours, contact, features, gallery, show } =
    useLandingData(landing, store);
  const scrolled = useScrolled(60);
  const [open, setOpen] = useState(false);
  const dishes = featuredDishes(landing, categories, 3);
  const hero = dishes[0];

  const links = [
    show.menu ? { id: "signatures", label: "Signatures" } : null,
    show.about ? { id: "counter", label: "The Counter" } : null,
    show.gallery ? { id: "live", label: "Live" } : null,
    show.hours || show.contact ? { id: "find", label: "Find Us" } : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-[#0c0b0c] font-['Manrope'] text-[15px] leading-6 text-[#f3f0ee]">
      {/* Status strip. At this hour the only question is whether the kitchen
          is still on. */}
      <div className={`border-b bg-[#141213] py-2 ${LINE}`}>
        <div className={`${WRAP} flex flex-wrap items-center justify-between gap-3 ${CAPS} text-[10px]`}>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff3b30]" />
            <span className={RED}>Late Night Service Active</span>
          </span>
          <span className="truncate text-white/45">{landing.subheadline}</span>
        </div>
      </div>

      <header className={`sticky top-0 z-50 transition-colors ${scrolled || open ? `bg-[#0c0b0c]/97 backdrop-blur border-b ${LINE}` : "bg-transparent"}`}>
        <div className={`${WRAP} flex h-[66px] items-center justify-between gap-5`}>
          <a href="#top" className="flex min-w-0 items-center gap-3">
            {landing.logo ? <img src={landing.logo} alt="" className="h-9 w-9 rounded-sm object-cover" /> : null}
            <span className={`${DISPLAY} truncate text-[26px] leading-none`}>{landing.headline}</span>
          </a>
          <nav className="hidden items-center gap-6 lg:flex">
            {links.map((l) => (
              <a key={l.id} href={`#${l.id}`} className={`${CAPS} text-white/55 transition hover:text-white`}>{l.label}</a>
            ))}
            <Cta to={menuPath} label={landing.ctaText} className={`${BTN} !px-6 !py-2.5`} />
          </nav>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className={`${CAPS} rounded-sm border border-white/25 px-4 py-2 lg:hidden`}>
            {open ? "Close" : "Menu"}
          </button>
        </div>
        <MobileLinks open={open} links={links} onClose={() => setOpen(false)}
          className={`${WRAP} flex flex-col border-t bg-[#0c0b0c] pb-5 lg:hidden ${LINE}`}
          linkClass={`${CAPS} py-3`} />
      </header>

      {/* ---- Hero: words left, one dish pinned right -------------------- */}
      <section id="top" className="relative flex min-h-[80vh] items-center">
        <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} fallback="bg-[#161213]" />
        <div className={`${WRAP} relative grid w-full items-center gap-12 py-24 lg:grid-cols-[1.25fr_1fr]`}>
          <div>
            <span className={`${CAPS} ${RED}`}>Urban Gastronomy</span>
            <h1 className={`${DISPLAY} mt-4 text-[46px] leading-[0.95] sm:text-[76px]`}>
              {landing.headline}
            </h1>
            {landing.subheadline ? (
              <p className="mt-6 max-w-xl text-[16px] leading-[27px] text-white/60">{landing.subheadline}</p>
            ) : null}
            <div className="mt-9 flex flex-wrap gap-3">
              <Cta to={menuPath} label={landing.ctaText} className={BTN} />
              {show.about ? <a href="#counter" className={GHOST}>The Counter</a> : null}
            </div>

            {show.features ? (
              <div className="mt-14 grid max-w-xl grid-cols-3 gap-px bg-white/10">
                {features.map((f, i) => (
                  <div key={f.title || i} className="bg-[#0c0b0c] px-5 py-4">
                    <div className={`${DISPLAY} ${RED} text-[30px] leading-none`}>{f.title}</div>
                    {f.text ? <div className={`${CAPS} mt-2 text-[9px] text-white/40`}>{f.text}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {hero ? (
            <div className={`relative rounded-sm border bg-[#141213] p-2 shadow-2xl ${LINE}`}>
              <span className={`${CAPS} absolute right-3 top-3 z-10 rounded-sm bg-[#ff3b30] px-2.5 py-1 text-[9px] text-white`}>
                Must Order
              </span>
              {hero.image ? (
                <img src={hero.image} alt={hero.imageAlt || hero.name} loading="lazy" className="h-64 w-full rounded-sm object-cover" />
              ) : null}
              <div className="p-5">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className={`${DISPLAY} text-[28px] leading-none`}>{hero.name}</h3>
                  <span className={`${DISPLAY} ${RED} shrink-0 text-[26px] leading-none`}>{symbol}{hero.price}</span>
                </div>
                {hero.description ? (
                  <p className="mt-3 line-clamp-2 text-[13px] leading-5 text-white/50">{hero.description}</p>
                ) : null}
                <Cta to={menuPath} label="Quick order" className={`${BTN} mt-5 w-full !py-3`} />
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* ---- Signatures: three, with a price each ----------------------- */}
      {show.menu && dishes.length ? (
        <section id="signatures" className={`border-t py-20 ${LINE}`}>
          <div className={WRAP}>
            <div className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <span className={`${CAPS} ${RED}`}>Craft Kitchen</span>
                <h2 className={`${DISPLAY} mt-3 text-[34px] leading-none sm:text-[48px]`}>
                  {landing.titles?.menu || "Signature Slurps & Charred Bites"}
                </h2>
              </div>
              <Cta to={menuPath} label="Full menu" className={`${CAPS} ${RED} self-start border-b border-[#ff3b30]/40 pb-1 hover:border-[#ff3b30] sm:self-auto`} />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {dishes.map((d) => (
                <a key={d.id} href={menuPath} className={`group overflow-hidden rounded-sm border bg-[#141213] transition hover:border-[#ff3b30]/50 ${LINE}`}>
                  {d.image ? (
                    <img src={d.thumbnail || d.image} alt={d.imageAlt || d.name} loading="lazy"
                      className="h-48 w-full object-cover transition duration-500 group-hover:scale-105" />
                  ) : null}
                  <div className="p-5">
                    <span className={`${CAPS} block text-[9px] text-white/40`}>{d.category}</span>
                    <div className="mt-2 flex items-baseline justify-between gap-3">
                      <h3 className={`${DISPLAY} text-[24px] leading-none`}>{d.name}</h3>
                      <span className={`${DISPLAY} ${RED} shrink-0 text-[22px] leading-none`}>{symbol}{d.price}</span>
                    </div>
                    {d.description ? (
                      <p className="mt-2.5 line-clamp-2 text-[13px] leading-5 text-white/45">{d.description}</p>
                    ) : null}
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Offers as a loud band -------------------------------------- */}
      {show.offers ? (
        <section className="py-6">
          <div className={WRAP}>
            {offers.slice(0, 1).map((o, i) => (
              <div key={o.code || i} className="flex flex-col items-start justify-between gap-4 rounded-sm bg-[#ff3b30] p-7 text-white sm:flex-row sm:items-center">
                <div>
                  <h3 className={`${DISPLAY} text-[28px] leading-none`}>{o.title}</h3>
                  {o.description ? <p className="mt-2 text-[13px] leading-5 text-white/85">{o.description}</p> : null}
                </div>
                {o.code ? (
                  <span className={`${CAPS} shrink-0 rounded-sm bg-black/25 px-5 py-3 text-[13px]`}>{o.code}</span>
                ) : null}
              </div>
            ))}
            {offers.length > 1 ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {offers.slice(1).map((o, i) => (
                  <div key={o.code || o.title || i} className={`rounded-sm border bg-[#141213] p-6 ${LINE}`}>
                    <h3 className={`${DISPLAY} text-[22px] leading-none`}>{o.title}</h3>
                    {o.description ? <p className="mt-2 text-[13px] leading-5 text-white/45">{o.description}</p> : null}
                    {o.code ? <p className={`${CAPS} ${RED} mt-3`}>{o.code}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ---- The counter ------------------------------------------------ */}
      {show.about ? (
        <section id="counter" className={`border-y bg-[#141213] py-20 ${LINE}`}>
          <div className={`${WRAP} grid items-center gap-12 lg:grid-cols-2`}>
            {landing.about?.image ? (
              <img src={landing.about.image.url} alt={landing.about.image.alt || ""} loading="lazy"
                className="h-80 w-full rounded-sm object-cover lg:h-[26rem]" />
            ) : null}
            <div>
              <span className={`${CAPS} ${RED}`}>Late Night Kitchen</span>
              <h2 className={`${DISPLAY} mt-3 text-[34px] leading-none sm:text-[48px]`}>
                {landing.titles?.about || "The Counter"}
              </h2>
              {paras(landing.about?.text).map((p, i) => (
                <p key={i} className="mt-5 text-[15px] leading-[26px] text-white/55">{p}</p>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Live from the counter -------------------------------------- */}
      {show.gallery ? (
        <section id="live" className="py-20">
          <div className={WRAP}>
            <span className={`${CAPS} ${RED}`}>#Slurpsociety</span>
            <h2 className={`${DISPLAY} mb-8 mt-3 text-[34px] leading-none sm:text-[48px]`}>Live from the Counter</h2>
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-6">
            {gallery.slice(0, 12).map((g, i) => (
              <img key={g.url + i} src={g.thumbnail || g.url} alt={g.alt || ""} loading="lazy"
                className="aspect-square w-full object-cover" />
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Find us ---------------------------------------------------- */}
      {show.hours || show.contact ? (
        <section id="find" className={`border-t bg-[#141213] py-20 ${LINE}`}>
          <div className={WRAP}>
            <span className={`${CAPS} ${RED}`}>Urban Headquarters</span>
            <h2 className={`${DISPLAY} mb-9 mt-3 text-[34px] leading-none sm:text-[48px]`}>
              {landing.titles?.contact || "Find the Red Lantern"}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {show.contact ? (
                <div className={`rounded-sm border bg-[#0c0b0c] p-8 ${LINE}`}>
                  <span className={`${CAPS} block text-white/40`}>Address</span>
                  <div className="mt-3 space-y-1 text-[16px] leading-[27px]">
                    {addressLines(contact)?.map((line) => <p key={line}>{line}</p>)}
                  </div>
                  {contact.phone ? <a href={`tel:${contact.phone}`} className={`${BTN} mt-6 w-full`}>Call {contact.phone}</a> : null}
                  {contact.mapUrl ? (
                    <a href={contact.mapUrl} target="_blank" rel="noreferrer noopener" className={`${GHOST} mt-3 w-full`}>Directions</a>
                  ) : null}
                </div>
              ) : null}
              {show.hours ? (
                <div className={`rounded-sm border bg-[#0c0b0c] p-8 ${LINE}`}>
                  <span className={`${CAPS} block text-white/40`}>Service Schedule</span>
                  <ul className="mt-3 divide-y divide-white/10">
                    {hours.map((h) => (
                      <li key={h.day} className="flex justify-between gap-6 py-2.5 text-[14px]">
                        <span className="text-white/40">{DAYS_SHORT[h.day]}</span>
                        <span className={h.isOpen ? RED : "text-white/40"}>
                          {h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <footer className={`border-t py-12 ${LINE}`}>
        <div className={`${WRAP} flex flex-col items-center justify-between gap-6 sm:flex-row`}>
          <span className={`${DISPLAY} text-[26px] leading-none`}>{landing.headline}</span>
          <div className={`${CAPS} flex gap-7 text-white/40`}>
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
