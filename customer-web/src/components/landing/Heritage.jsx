import React, { useState } from "react";
import { Backdrop, Cta, MobileLinks } from "./kit";
import { DAYS, addressLines, paras, socialLinks, useLandingData, useScrolled } from "./data";

/**
 * Heritage — the long-established restaurant.
 *
 * Modelled on the sort of site a place that has been on the same corner since
 * the nineties actually has: a utility bar with the phone number above
 * everything, a centred crest, and a menu set as a printed card rather than as
 * a grid of photographs. Dark, warm, ceremonial, serif.
 *
 * The menu is the thing that most separates this design from the others. A
 * restaurant of this kind is not selling you a photograph of a dish, it is
 * showing you a menu — so the dishes are set in leader-dot rows with the price
 * at the right margin and no images at all.
 */

const WRAP = "mx-auto w-full max-w-6xl px-5 sm:px-8";
const GOLD = "text-[var(--accent,#c9a227)]";

export default function Heritage({ landing, store, menuPath }) {
  const { symbol, categories, offers, hours, contact, features, gallery, show } =
    useLandingData(landing, store);
  const scrolled = useScrolled(80);
  const [open, setOpen] = useState(false);

  const links = [
    show.about ? { id: "story", label: "Our Story" } : null,
    show.menu ? { id: "menu", label: "Menu" } : null,
    show.gallery ? { id: "gallery", label: "Gallery" } : null,
    show.hours || show.contact ? { id: "visit", label: "Contact" } : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-[#100d0a] text-[#efe6d8] [font-family:var(--font-body,Inter),system-ui,sans-serif]">
      {/* A utility strip above everything, the way a restaurant that takes
          bookings by telephone puts its number above the logo. */}
      <div className="hidden border-b border-white/10 bg-black/60 py-2 text-[11px] uppercase tracking-[0.2em] text-white/50 md:block">
        <div className={`${WRAP} flex items-center justify-between gap-6`}>
          <span>{addressLines(contact)?.[0] || landing.subheadline}</span>
          <span className="flex items-center gap-6">
            {contact.phone ? <a href={`tel:${contact.phone}`} className="hover:text-white">{contact.phone}</a> : null}
            {contact.email ? <a href={`mailto:${contact.email}`} className="hover:text-white">{contact.email}</a> : null}
          </span>
        </div>
      </div>

      <header
        className={`sticky top-0 z-50 transition-colors ${
          scrolled || open ? "bg-[#100d0a]/97 backdrop-blur border-b border-white/10" : "bg-transparent"
        }`}
      >
        <div className={`${WRAP} py-3`}>
          {/* Crest centred, links either side. */}
          <div className="hidden items-center justify-center gap-8 md:flex">
            <nav className="flex flex-1 justify-end gap-8">
              {links.slice(0, 2).map((l) => (
                <a key={l.id} href={`#${l.id}`} className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70 hover:text-white">
                  {l.label}
                </a>
              ))}
            </nav>
            <a href="#top" className="shrink-0">
              {landing.logo ? (
                <img src={landing.logo} alt="" className="h-14 w-14 rounded-full border border-[var(--accent,#c9a227)]/50 object-cover" />
              ) : (
                <span className={`font-serif text-lg uppercase tracking-[0.3em] ${GOLD}`}>
                  {landing.headline.slice(0, 18)}
                </span>
              )}
            </a>
            <nav className="flex flex-1 gap-8">
              {links.slice(2).map((l) => (
                <a key={l.id} href={`#${l.id}`} className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70 hover:text-white">
                  {l.label}
                </a>
              ))}
              <Cta to={menuPath} label="Order" className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[var(--accent,#c9a227)] hover:text-white" />
            </nav>
          </div>

          <div className="flex items-center justify-between md:hidden">
            <a href="#top" className="flex items-center gap-3">
              {landing.logo ? <img src={landing.logo} alt="" className="h-10 w-10 rounded-full object-cover" /> : null}
              <span className="font-serif text-sm uppercase tracking-[0.2em]">{landing.headline}</span>
            </a>
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
              className="border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em]">
              {open ? "Close" : "Menu"}
            </button>
          </div>
        </div>
        <MobileLinks
          open={open}
          links={links}
          onClose={() => setOpen(false)}
          className={`${WRAP} flex flex-col border-t border-white/10 pb-4 md:hidden`}
          linkClass="py-3 text-xs font-semibold uppercase tracking-[0.22em] text-white/80"
        />
      </header>

      {/* ---- Hero ---------------------------------------------------- */}
      <section id="top" className="relative -mt-[76px] flex min-h-[95vh] items-center justify-center text-center">
        <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} fallback="bg-[#100d0a]" />
        <div className={`${WRAP} relative pt-32 pb-24`}>
          <p className={`text-[11px] font-semibold uppercase tracking-[0.4em] ${GOLD}`}>Est. tradition</p>
          <h1 className="mx-auto mt-6 max-w-4xl font-serif text-4xl uppercase leading-tight tracking-[0.12em] text-white sm:text-6xl">
            {landing.headline}
          </h1>
          <span className="mx-auto my-8 block h-px w-28 bg-[var(--accent,#c9a227)]" />
          {landing.subheadline ? (
            <p className="mx-auto max-w-xl text-base text-white/70">{landing.subheadline}</p>
          ) : null}
          <div className="mt-10">
            <Cta to={menuPath} label={landing.ctaText}
              className="inline-block border border-[var(--accent,#c9a227)] px-12 py-4 text-xs font-bold uppercase tracking-[0.3em] text-[var(--accent,#c9a227)] transition hover:bg-[var(--accent,#c9a227)] hover:text-[#100d0a]" />
          </div>
        </div>
      </section>

      {/* ---- Story: text left, framed photograph right ---------------- */}
      {show.about ? (
        <section id="story" className="border-t border-white/10 py-24">
          <div className={`${WRAP} grid items-center gap-14 lg:grid-cols-[1.1fr_1fr]`}>
            <div>
              <p className={`text-[11px] font-semibold uppercase tracking-[0.35em] ${GOLD}`}>Our story</p>
              <h2 className="mt-4 font-serif text-3xl uppercase tracking-[0.1em] sm:text-4xl">
                {landing.titles?.about || "About Us"}
              </h2>
              <span className="my-7 block h-px w-20 bg-[var(--accent,#c9a227)]" />
              {paras(landing.about?.text).map((p, i) => (
                <p key={i} className="mb-5 text-[15px] leading-[1.9] text-white/65">{p}</p>
              ))}
            </div>
            {landing.about?.image ? (
              <div className="relative">
                {/* An offset rule behind the photograph, the way a framed print
                    is mounted. Decorative only. */}
                <span className="absolute -left-4 -top-4 hidden h-full w-full border border-[var(--accent,#c9a227)]/40 lg:block" aria-hidden="true" />
                <img src={landing.about.image.url} alt={landing.about.image.alt || ""} loading="lazy"
                  className="relative h-[26rem] w-full object-cover" />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ---- Awards strip: no cards, just rules ----------------------- */}
      {show.features ? (
        <section className="border-y border-white/10 bg-black/40 py-16">
          <div className={`${WRAP} grid gap-10 divide-y divide-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0`}>
            {features.map((f, i) => (
              <div key={f.title || i} className="pt-8 text-center sm:px-6 sm:pt-0">
                <h3 className={`font-serif text-lg uppercase tracking-[0.18em] ${GOLD}`}>{f.title}</h3>
                {f.text ? <p className="mt-3 text-sm leading-relaxed text-white/55">{f.text}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Menu as a printed card ---------------------------------- */}
      {show.menu ? (
        <section id="menu" className="py-24">
          <div className={WRAP}>
            <div className="text-center">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.35em] ${GOLD}`}>From our kitchen</p>
              <h2 className="mt-4 font-serif text-3xl uppercase tracking-[0.1em] sm:text-4xl">
                {landing.titles?.menu || "Our Menu"}
              </h2>
              <span className="mx-auto my-8 block h-px w-20 bg-[var(--accent,#c9a227)]" />
            </div>

            <div className="grid gap-x-16 gap-y-12 md:grid-cols-2">
              {categories.slice(0, 4).map((c) => (
                <div key={c.id}>
                  <h3 className="mb-6 border-b border-white/15 pb-3 font-serif text-lg uppercase tracking-[0.2em]">
                    {c.name}
                  </h3>
                  <ul className="space-y-5">
                    {(c.products || []).slice(0, 5).map((p) => (
                      <li key={p.id}>
                        {/* Leader dots: the gap between the dish and its price
                            is filled by a dotted rule, as on a printed menu. */}
                        <div className="flex items-baseline gap-3">
                          <span className="text-[15px] font-medium">{p.name}</span>
                          <span className="mb-1 flex-1 border-b border-dotted border-white/25" aria-hidden="true" />
                          <span className={`text-[15px] font-semibold ${GOLD}`}>{symbol}{p.price}</span>
                        </div>
                        {p.description ? (
                          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-white/45">{p.description}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="mt-16 text-center">
              <Cta to={menuPath} label={landing.ctaText}
                className="inline-block border border-[var(--accent,#c9a227)] px-12 py-4 text-xs font-bold uppercase tracking-[0.3em] text-[var(--accent,#c9a227)] transition hover:bg-[var(--accent,#c9a227)] hover:text-[#100d0a]" />
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Offers -------------------------------------------------- */}
      {show.offers ? (
        <section className="border-y border-white/10 bg-black/40 py-20">
          <div className={`${WRAP} grid gap-8 sm:grid-cols-2 lg:grid-cols-3`}>
            {offers.map((o, i) => (
              <div key={o.code || o.title || i} className="border border-[var(--accent,#c9a227)]/30 p-8 text-center">
                <h3 className={`font-serif text-lg uppercase tracking-[0.15em] ${GOLD}`}>{o.title}</h3>
                {o.description ? <p className="mt-3 text-sm text-white/55">{o.description}</p> : null}
                {o.code ? (
                  <p className="mt-5 inline-block border border-dashed border-white/30 px-4 py-1.5 font-mono text-xs tracking-widest">
                    {o.code}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Gallery: one tall plate, the rest stacked ---------------- */}
      {show.gallery ? (
        <section id="gallery" className="py-24">
          <div className={WRAP}>
            <div className="mb-12 text-center">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.35em] ${GOLD}`}>The room</p>
              <h2 className="mt-4 font-serif text-3xl uppercase tracking-[0.1em]">Gallery</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {gallery.slice(0, 8).map((g, i) => (
                <img key={g.url + i} src={g.thumbnail || g.url} alt={g.alt || ""} loading="lazy"
                  className={`w-full object-cover ${i === 0 ? "col-span-2 row-span-2 h-full min-h-[16rem]" : "h-40 sm:h-48"}`} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Visit --------------------------------------------------- */}
      {show.hours || show.contact ? (
        <section id="visit" className="border-t border-white/10 bg-black/40 py-20">
          <div className={`${WRAP} grid gap-14 text-center sm:grid-cols-2 sm:text-left`}>
            {show.contact ? (
              <div>
                <h3 className={`mb-6 font-serif text-lg uppercase tracking-[0.2em] ${GOLD}`}>
                  {landing.titles?.contact || "Contact"}
                </h3>
                {addressLines(contact)?.map((line) => (
                  <p key={line} className="text-[15px] leading-relaxed text-white/65">{line}</p>
                ))}
                {contact.phone ? (
                  <p className="mt-4"><a href={`tel:${contact.phone}`} className="text-[15px] hover:text-white">{contact.phone}</a></p>
                ) : null}
                {contact.email ? (
                  <p><a href={`mailto:${contact.email}`} className="text-[15px] text-white/65 hover:text-white">{contact.email}</a></p>
                ) : null}
              </div>
            ) : null}
            {show.hours ? (
              <div>
                <h3 className={`mb-6 font-serif text-lg uppercase tracking-[0.2em] ${GOLD}`}>Hours</h3>
                <ul className="mx-auto max-w-sm space-y-2.5 sm:mx-0">
                  {hours.map((h) => (
                    <li key={h.day} className="flex items-baseline gap-3 text-sm">
                      <span className="text-white/55">{DAYS[h.day]}</span>
                      <span className="mb-1 flex-1 border-b border-dotted border-white/20" aria-hidden="true" />
                      <span>{h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <footer className="border-t border-white/10 py-14 text-center">
        <div className={WRAP}>
          {landing.logo ? (
            <img src={landing.logo} alt="" className="mx-auto mb-6 h-16 w-16 rounded-full border border-[var(--accent,#c9a227)]/40 object-cover" />
          ) : null}
          <p className="font-serif text-sm uppercase tracking-[0.3em]">{landing.headline}</p>
          <div className="mt-7 flex justify-center gap-8 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/50">
            {socialLinks(contact).map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer noopener" className="hover:text-white">{l.label}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
