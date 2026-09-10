import React, { useState } from "react";
import { Backdrop, Cta } from "./kit";
import { DAYS, addressLines, paras, socialLinks, useLandingData } from "./data";

/**
 * Full Screen — the loud one.
 *
 * Near-black, oversized type, photographs at full bleed with no gutters. The
 * masthead carries almost nothing: a wordmark, one button, and a panel that
 * takes the whole screen when opened, which is the convention on sites that
 * want the first frame to be a picture and nothing else.
 *
 * Sections are numbered slabs rather than cards, and the menu is a wall of
 * photographs with the dish written over each one. It rewards a store with
 * real food photography and punishes one without, which is exactly the trade
 * the operator is making when they pick it.
 */

const WRAP = "mx-auto w-full max-w-7xl px-5 sm:px-10";
const BTN =
  "inline-flex items-center justify-center rounded-full bg-brand text-brand-fg px-10 py-4 text-[12px] font-bold uppercase tracking-[0.25em] transition hover:opacity-90";

export default function FullScreen({ landing, store, menuPath }) {
  const { symbol, categories, offers, hours, contact, features, gallery, show } =
    useLandingData(landing, store);
  const [open, setOpen] = useState(false);

  const links = [
    show.about ? { id: "story", label: "Story" } : null,
    show.menu ? { id: "menu", label: "Menu" } : null,
    show.gallery ? { id: "gallery", label: "Gallery" } : null,
    show.hours || show.contact ? { id: "visit", label: "Visit" } : null,
  ].filter(Boolean);

  const dishes = categories.flatMap((c) => (c.products || []).map((p) => ({ ...p, category: c.name })));
  const featured = dishes.filter((d) => d.image).slice(0, 6);
  const fallbackDishes = featured.length ? featured : dishes.slice(0, 6);

  return (
    <div className="min-h-screen bg-[#08080a] text-white [font-family:var(--font-body,Inter),system-ui,sans-serif]">
      <header className="fixed inset-x-0 top-0 z-50">
        <div className={`${WRAP} flex h-20 items-center justify-between gap-6`}>
          <a href="#top" className="flex min-w-0 items-center gap-3">
            {landing.logo ? <img src={landing.logo} alt="" className="h-10 w-10 rounded-full object-cover" /> : null}
            <span className="truncate text-[12px] font-bold uppercase tracking-[0.3em]">{landing.headline}</span>
          </a>
          <div className="flex items-center gap-4">
            <Cta to={menuPath} label={landing.ctaText} className={`${BTN} !px-7 !py-3 !text-[10px]`} />
            {/* One control, every screen size. This design does not carry a
                link bar -- the panel is the navigation. */}
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Navigation"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 backdrop-blur">
              <span className="sr-only">Navigation</span>
              <span aria-hidden="true" className="text-lg leading-none">{open ? "×" : "≡"}</span>
            </button>
          </div>
        </div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-[#08080a]/97 backdrop-blur">
          {links.map((l) => (
            <a key={l.id} href={`#${l.id}`} onClick={() => setOpen(false)}
              className="text-4xl font-bold tracking-tight text-white/80 hover:text-white sm:text-6xl">
              {l.label}
            </a>
          ))}
        </div>
      ) : null}

      {/* ---- Hero: the whole screen ------------------------------------ */}
      <section id="top" className="relative flex min-h-screen items-center justify-center text-center">
        <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} fallback="bg-[#08080a]" />
        <div className={`${WRAP} relative py-32`}>
          <h1 className="mx-auto max-w-5xl text-5xl font-bold leading-[0.95] tracking-[-0.03em] sm:text-7xl lg:text-[7rem]">
            {landing.headline}
          </h1>
          {landing.subheadline ? (
            <p className="mx-auto mt-8 max-w-2xl text-lg text-white/70">{landing.subheadline}</p>
          ) : null}
          <div className="mt-12">
            <Cta to={menuPath} label={landing.ctaText} className={BTN} />
          </div>
        </div>
        <span className="absolute bottom-8 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-[0.4em] text-white/40" aria-hidden="true">
          Scroll
        </span>
      </section>

      {/* ---- Story: a numbered slab ------------------------------------ */}
      {show.about ? (
        <section id="story" className="relative">
          <div className="grid lg:grid-cols-2">
            {landing.about?.image ? (
              <img src={landing.about.image.url} alt={landing.about.image.alt || ""} loading="lazy"
                className="h-[60vh] w-full object-cover lg:h-[85vh]" />
            ) : null}
            <div className="flex items-center px-6 py-20 sm:px-14">
              <div className="max-w-xl">
                <p className="text-[11px] font-bold uppercase tracking-[0.4em] text-[var(--accent,#f5a524)]">01 — Story</p>
                <h2 className="mt-6 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
                  {landing.titles?.about || "About Us"}
                </h2>
                {paras(landing.about?.text).map((p, i) => (
                  <p key={i} className="mt-6 text-base leading-[1.9] text-white/60">{p}</p>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Selling points as full-width numbered rows ----------------- */}
      {show.features ? (
        <section className="border-t border-white/10">
          {features.map((f, i) => (
            <div key={f.title || i} className={`${WRAP} grid items-start gap-8 border-b border-white/10 py-14 md:grid-cols-[6rem_1fr_1fr]`}>
              <p className="text-[11px] font-bold uppercase tracking-[0.35em] text-white/35">
                {String(i + 2).padStart(2, "0")}
              </p>
              <h3 className="text-3xl font-bold tracking-tight sm:text-4xl">{f.title}</h3>
              {f.text ? <p className="text-base leading-[1.9] text-white/55">{f.text}</p> : null}
            </div>
          ))}
        </section>
      ) : null}

      {/* ---- Menu: a wall of photographs -------------------------------- */}
      {show.menu ? (
        <section id="menu" className="py-24">
          <div className={`${WRAP} mb-12`}>
            <p className="text-[11px] font-bold uppercase tracking-[0.4em] text-[var(--accent,#f5a524)]">Menu</p>
            <h2 className="mt-5 text-4xl font-bold tracking-tight sm:text-6xl">
              {landing.titles?.menu || "Our Menu"}
            </h2>
          </div>

          <div className="grid gap-px bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
            {fallbackDishes.map((p) => (
              <a key={p.id} href={menuPath} className="group relative block aspect-[4/5] overflow-hidden bg-[#08080a]">
                {p.image ? (
                  <img src={p.image} alt={p.imageAlt || p.name} loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover opacity-70 transition duration-500 group-hover:scale-105 group-hover:opacity-90" />
                ) : null}
                <span className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black to-transparent" aria-hidden="true" />
                <div className="absolute inset-x-0 bottom-0 p-7">
                  <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">{p.category}</p>
                  <h3 className="mt-2 text-2xl font-bold leading-tight tracking-tight">{p.name}</h3>
                  <p className="mt-2 text-lg font-bold text-[var(--accent,#f5a524)]">{symbol}{p.price}</p>
                </div>
              </a>
            ))}
          </div>

          <div className={`${WRAP} mt-14 text-center`}>
            <Cta to={menuPath} label={landing.ctaText} className={BTN} />
          </div>
        </section>
      ) : null}

      {/* ---- Offers as a marquee-ish band ------------------------------- */}
      {show.offers ? (
        <section className="border-y border-white/10 py-16">
          <div className={`${WRAP} grid gap-10 sm:grid-cols-2 lg:grid-cols-3`}>
            {offers.map((o, i) => (
              <div key={o.code || o.title || i}>
                <h3 className="text-2xl font-bold tracking-tight">{o.title}</h3>
                {o.description ? <p className="mt-3 text-sm leading-relaxed text-white/55">{o.description}</p> : null}
                {o.code ? (
                  <p className="mt-5 font-mono text-xs font-bold tracking-[0.3em] text-[var(--accent,#f5a524)]">{o.code}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Gallery: edge to edge, no gutters -------------------------- */}
      {show.gallery ? (
        <section id="gallery" className="py-24">
          <div className={`${WRAP} mb-10`}>
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">Gallery</h2>
          </div>
          <div className="grid grid-cols-2 gap-px bg-white/10 lg:grid-cols-4">
            {gallery.slice(0, 8).map((g, i) => (
              <img key={g.url + i} src={g.thumbnail || g.url} alt={g.alt || ""} loading="lazy"
                className="aspect-square w-full object-cover" />
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Visit ------------------------------------------------------ */}
      {show.hours || show.contact ? (
        <section id="visit" className="border-t border-white/10 py-20">
          <div className={`${WRAP} grid gap-14 sm:grid-cols-2`}>
            {show.contact ? (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.35em] text-white/35">Find us</p>
                <div className="mt-6 space-y-1 text-2xl font-bold leading-snug tracking-tight">
                  {addressLines(contact)?.map((line) => <p key={line}>{line}</p>)}
                </div>
                {contact.phone ? (
                  <p className="mt-6"><a href={`tel:${contact.phone}`} className="text-lg text-white/70 hover:text-white">{contact.phone}</a></p>
                ) : null}
                {contact.email ? (
                  <p><a href={`mailto:${contact.email}`} className="text-lg text-white/70 hover:text-white">{contact.email}</a></p>
                ) : null}
              </div>
            ) : null}
            {show.hours ? (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.35em] text-white/35">Hours</p>
                <ul className="mt-6 space-y-2">
                  {hours.map((h) => (
                    <li key={h.day} className="flex justify-between gap-8 border-b border-white/10 pb-2 text-sm">
                      <span className="text-white/45">{DAYS[h.day]}</span>
                      <span className="font-semibold">{h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <footer className="border-t border-white/10 py-12">
        <div className={`${WRAP} flex flex-col items-center justify-between gap-6 sm:flex-row`}>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/45">{landing.headline}</span>
          <div className="flex gap-6 text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">
            {socialLinks(contact).map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer noopener" className="hover:text-white">{l.label}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
