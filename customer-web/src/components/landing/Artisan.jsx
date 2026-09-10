import React, { useState } from "react";
import { Backdrop, Cta, MobileLinks } from "./kit";
import { DAYS, addressLines, paras, socialLinks, useLandingData, useScrolled } from "./data";

/**
 * Artisan — the café that sells the room as much as the food.
 *
 * Cream, serif, unhurried. The hero is framed inside the page rather than bled
 * to the edges, which is why the masthead here is solid from the first
 * pixel: there is no photograph under it to be white on.
 *
 * Its menu is the most distinctive part -- a category list down the left and
 * the dishes as typeset rows on the right, the way a café with thirty
 * categories and no photographs of any of them actually presents a menu.
 */

const WRAP = "mx-auto w-full max-w-6xl px-5 sm:px-8";
const INK = "text-[#2e2419]";
const SOFT = "text-[#7a6a55]";
const BTN =
  "inline-flex items-center justify-center rounded-full bg-brand text-brand-fg px-9 py-3.5 text-[12px] font-bold uppercase tracking-[0.2em] transition hover:opacity-90";

export default function Artisan({ landing, store, menuPath }) {
  const { symbol, categories, offers, hours, contact, features, gallery, show } =
    useLandingData(landing, store);
  const scrolled = useScrolled(40);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const links = [
    show.about ? { id: "story", label: "Our Story" } : null,
    show.menu ? { id: "menu", label: "Menu" } : null,
    show.gallery ? { id: "gallery", label: "Gallery" } : null,
    show.hours || show.contact ? { id: "visit", label: "Visit" } : null,
  ].filter(Boolean);

  const category = categories[Math.min(active, categories.length - 1)] || categories[0];

  return (
    <div className={`min-h-screen bg-[#fbf6ee] ${INK} [font-family:var(--font-body,Inter),system-ui,sans-serif]`}>
      <header className={`sticky top-0 z-50 bg-[#fbf6ee]/95 backdrop-blur transition-shadow ${scrolled ? "shadow-[0_1px_0_#e0d2bd]" : ""}`}>
        <div className={`${WRAP} flex h-[74px] items-center justify-between gap-6`}>
          <a href="#top" className="flex min-w-0 items-center gap-3">
            {landing.logo ? <img src={landing.logo} alt="" className="h-11 w-11 rounded-full object-cover" /> : null}
            <span className="truncate font-serif text-[17px] tracking-wide">{landing.headline}</span>
          </a>

          {/* Links separated by a small diamond, not by whitespace alone. */}
          <nav className="hidden items-center gap-5 md:flex">
            {links.map((l, i) => (
              <React.Fragment key={l.id}>
                {i > 0 ? <span className={`text-[8px] ${SOFT}`} aria-hidden="true">◆</span> : null}
                <a href={`#${l.id}`} className={`text-[12px] font-semibold tracking-[0.08em] ${SOFT} hover:${INK}`}>
                  {l.label}
                </a>
              </React.Fragment>
            ))}
            <Cta to={menuPath} label={landing.ctaText} className={`${BTN} !px-6 !py-2.5 !text-[10px] ml-3`} />
          </nav>

          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className={`md:hidden rounded-full border border-[#e0d2bd] px-4 py-1.5 text-[11px] font-semibold ${SOFT}`}>
            {open ? "Close" : "Menu"}
          </button>
        </div>
        <MobileLinks
          open={open}
          links={links}
          onClose={() => setOpen(false)}
          className={`${WRAP} flex flex-col border-t border-[#e0d2bd] pb-4 md:hidden`}
          linkClass="py-3 font-serif text-[15px]"
        />
      </header>

      {/* ---- Hero, framed inside the page ----------------------------- */}
      <section id="top" className="px-4 pb-6 pt-6 sm:px-8">
        <div className="relative mx-auto flex min-h-[72vh] max-w-7xl items-center justify-center overflow-hidden rounded-[2rem] text-center text-white">
          <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} fallback="bg-[#8a6a45]" />
          <div className="relative px-6 py-28">
            <h1 className="mx-auto max-w-3xl font-serif text-4xl leading-[1.15] sm:text-6xl">{landing.headline}</h1>
            {landing.subheadline ? (
              <p className="mx-auto mt-6 max-w-lg text-base text-white/85">{landing.subheadline}</p>
            ) : null}
            <div className="mt-10">
              <Cta to={menuPath} label={landing.ctaText} className={BTN} />
            </div>
          </div>
        </div>
      </section>

      {/* ---- Statement ------------------------------------------------- */}
      {show.about ? (
        <section id="story" className="py-24">
          <div className={`${WRAP} grid items-center gap-14 lg:grid-cols-[1fr_1.05fr]`}>
            {landing.about?.image ? (
              <img src={landing.about.image.url} alt={landing.about.image.alt || ""} loading="lazy"
                className="h-[28rem] w-full rounded-[2rem] object-cover" />
            ) : null}
            <div>
              <p className={`text-[11px] font-semibold uppercase tracking-[0.3em] ${SOFT}`}>Our story</p>
              <h2 className="mt-5 font-serif text-3xl leading-tight sm:text-[2.6rem]">
                {landing.titles?.about || "About Us"}
              </h2>
              {paras(landing.about?.text).map((p, i) => (
                <p key={i} className={`mt-6 text-[15px] leading-[1.95] ${SOFT}`}>{p}</p>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Three columns, thin rules, no cards ----------------------- */}
      {show.features ? (
        <section className="bg-[#f3e9da] py-20">
          <div className={WRAP}>
            <h2 className="mb-14 text-center font-serif text-3xl">What makes us different</h2>
            <div className="grid gap-12 divide-y divide-[#e0d2bd] sm:grid-cols-3 sm:gap-8 sm:divide-x sm:divide-y-0">
              {features.map((f, i) => (
                <div key={f.title || i} className="pt-10 text-center sm:px-7 sm:pt-0">
                  {f.image ? (
                    <img src={f.image.thumbnail || f.image.url} alt="" loading="lazy"
                      className="mx-auto mb-6 h-20 w-20 rounded-full object-cover" />
                  ) : (
                    <p className={`mb-4 font-serif text-3xl ${SOFT}`}>{String(i + 1).padStart(2, "0")}</p>
                  )}
                  <h3 className="font-serif text-xl">{f.title}</h3>
                  {f.text ? <p className={`mt-3 text-sm leading-[1.85] ${SOFT}`}>{f.text}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Menu: category list left, typeset rows right -------------- */}
      {show.menu ? (
        <section id="menu" className="py-24">
          <div className={WRAP}>
            <div className="mb-12 text-center">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.3em] ${SOFT}`}>A taste worth the pause</p>
              <h2 className="mt-4 font-serif text-3xl sm:text-[2.6rem]">{landing.titles?.menu || "Our Menu"}</h2>
            </div>

            <div className="grid gap-10 lg:grid-cols-[15rem_1fr]">
              <nav className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:border-r lg:border-[#e0d2bd] lg:pr-6">
                {categories.slice(0, 12).map((c, i) => (
                  <button key={c.id} type="button" onClick={() => setActive(i)}
                    className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-left text-[13px] transition lg:rounded-none lg:px-0 lg:py-2.5 ${
                      i === active ? `font-semibold ${INK} lg:border-r-2 lg:border-brand lg:-mr-[1.55rem] lg:pr-6` : SOFT
                    }`}>
                    {c.name}
                  </button>
                ))}
              </nav>

              <ul className="divide-y divide-[#e0d2bd]">
                {(category?.products || []).slice(0, 7).map((p) => (
                  <li key={p.id} className="flex items-start gap-5 py-5">
                    {p.image ? (
                      <img src={p.thumbnail || p.image} alt={p.imageAlt || p.name} loading="lazy"
                        className="h-20 w-20 shrink-0 rounded-2xl object-cover" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-4">
                        <h3 className="font-serif text-[17px]">{p.name}</h3>
                        <span className="shrink-0 text-[15px] font-semibold">{symbol} {p.price}</span>
                      </div>
                      {p.description ? (
                        <p className={`mt-1.5 text-[13px] leading-relaxed ${SOFT}`}>{p.description}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-14 text-center">
              <Cta to={menuPath} label={landing.ctaText} className={BTN} />
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Offers ---------------------------------------------------- */}
      {show.offers ? (
        <section className="bg-[#f3e9da] py-20">
          <div className={`${WRAP} grid gap-6 sm:grid-cols-2 lg:grid-cols-3`}>
            {offers.map((o, i) => (
              <div key={o.code || o.title || i} className="rounded-[1.5rem] border border-[#e0d2bd] bg-white/70 p-8 text-center">
                <h3 className="font-serif text-xl">{o.title}</h3>
                {o.description ? <p className={`mt-3 text-sm leading-relaxed ${SOFT}`}>{o.description}</p> : null}
                {o.code ? (
                  <p className="mt-5 inline-block rounded-full border border-dashed border-[#c8b498] px-4 py-1.5 font-mono text-xs">
                    {o.code}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Gallery: fewer, larger plates ----------------------------- */}
      {show.gallery ? (
        <section id="gallery" className="py-24">
          <div className={WRAP}>
            <h2 className="mb-12 text-center font-serif text-3xl">Gallery</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              {gallery.slice(0, 6).map((g, i) => (
                <img key={g.url + i} src={g.thumbnail || g.url} alt={g.alt || ""} loading="lazy"
                  className="h-72 w-full rounded-[1.5rem] object-cover" />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Visit ------------------------------------------------------ */}
      {show.hours || show.contact ? (
        <section id="visit" className="bg-[#f3e9da] py-20">
          <div className={`${WRAP} grid gap-14 text-center sm:grid-cols-2 sm:text-left`}>
            {show.contact ? (
              <div>
                <h3 className="mb-5 font-serif text-2xl">{landing.titles?.contact || "Visit us"}</h3>
                {addressLines(contact)?.map((line) => (
                  <p key={line} className={`text-[15px] leading-relaxed ${SOFT}`}>{line}</p>
                ))}
                {contact.phone ? <p className="mt-4 text-[15px]"><a href={`tel:${contact.phone}`}>{contact.phone}</a></p> : null}
                {contact.email ? <p className={`text-[15px] ${SOFT}`}><a href={`mailto:${contact.email}`}>{contact.email}</a></p> : null}
                {contact.mapUrl ? (
                  <p className="mt-4">
                    <a href={contact.mapUrl} target="_blank" rel="noreferrer noopener"
                      className="text-[12px] font-semibold uppercase tracking-[0.18em] underline underline-offset-4">
                      Open in maps
                    </a>
                  </p>
                ) : null}
              </div>
            ) : null}
            {show.hours ? (
              <div>
                <h3 className="mb-5 font-serif text-2xl">Hours</h3>
                <ul className="mx-auto max-w-sm divide-y divide-[#e0d2bd] sm:mx-0">
                  {hours.map((h) => (
                    <li key={h.day} className="flex justify-between gap-6 py-2.5 text-sm">
                      <span className={SOFT}>{DAYS[h.day]}</span>
                      <span>{h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <footer className="py-16 text-center">
        <div className={WRAP}>
          {landing.logo ? <img src={landing.logo} alt="" className="mx-auto mb-5 h-14 w-14 rounded-full object-cover" /> : null}
          <p className="font-serif text-xl">{landing.headline}</p>
          <div className={`mt-6 flex justify-center gap-6 text-[12px] font-semibold ${SOFT}`}>
            {socialLinks(contact).map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer noopener" className={`hover:${INK}`}>{l.label}</a>
            ))}
          </div>
          <div className="mt-8">
            <Cta to={menuPath} label={landing.ctaText} className={BTN} />
          </div>
        </div>
      </footer>
    </div>
  );
}
