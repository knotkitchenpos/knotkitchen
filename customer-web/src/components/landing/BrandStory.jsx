import React, { useState } from "react";
import { Backdrop, Cta, MobileLinks } from "./kit";
import { DAYS_SHORT, addressLines, paras, socialLinks, useLandingData, useScrolled } from "./data";

/**
 * Brand Story — the group with more than one thing going on.
 *
 * Modelled on the restaurant-group site: white, roomy, corporate-warm. A
 * statement paragraph rather than a hero slogan, and then the selling points
 * as full-width alternating rows of picture and prose, which is how a group
 * introduces its brands.
 *
 * The menu here is a horizontal rail rather than a grid. It reads as "a few
 * things we are known for" instead of "here is the catalogue", which is the
 * right claim for a page whose job is to hand the customer on to the ordering
 * screen.
 */

const WRAP = "mx-auto w-full max-w-6xl px-5 sm:px-8";
const BTN =
  "inline-flex items-center justify-center bg-brand text-brand-fg px-8 py-3.5 text-[13px] font-bold uppercase tracking-[0.15em] transition hover:opacity-90";

export default function BrandStory({ landing, store, menuPath }) {
  const { symbol, categories, offers, hours, contact, features, gallery, show } =
    useLandingData(landing, store);
  const scrolled = useScrolled(60);
  const [open, setOpen] = useState(false);

  const links = [
    show.about ? { id: "about", label: "About" } : null,
    show.features ? { id: "what", label: "What we do" } : null,
    show.menu ? { id: "menu", label: "Menu" } : null,
    show.gallery ? { id: "gallery", label: "Gallery" } : null,
    show.hours || show.contact ? { id: "contact", label: "Contact" } : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-white text-[#14181f] [font-family:var(--font-body,Inter),system-ui,sans-serif]">
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all ${
          scrolled || open ? "bg-white text-[#14181f] shadow-sm" : "bg-transparent text-white"
        }`}
      >
        <div className={`${WRAP} flex h-[72px] items-center justify-between gap-6`}>
          <a href="#top" className="flex min-w-0 items-center gap-3">
            {landing.logo ? <img src={landing.logo} alt="" className="h-10 w-10 rounded object-cover" /> : null}
            <span className="truncate text-[15px] font-extrabold tracking-tight">{landing.headline}</span>
          </a>

          <nav className="hidden items-center gap-9 lg:flex">
            {links.map((l) => (
              <a key={l.id} href={`#${l.id}`}
                className="text-[12px] font-bold uppercase tracking-[0.14em] hover:text-[var(--primary,#e2571e)]">
                {l.label}
              </a>
            ))}
            <Cta to={menuPath} label={landing.ctaText} className={`${BTN} !px-6 !py-2.5 !text-[11px]`} />
          </nav>

          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className="lg:hidden text-[11px] font-bold uppercase tracking-[0.15em]">
            {open ? "Close" : "Menu"}
          </button>
        </div>
        <MobileLinks
          open={open}
          links={links}
          onClose={() => setOpen(false)}
          className={`${WRAP} flex flex-col border-t border-black/10 bg-white pb-4 text-[#14181f] lg:hidden`}
          linkClass="py-3 text-[13px] font-bold uppercase tracking-[0.14em]"
        />
      </header>

      {/* ---- Hero: wide photograph, words held left -------------------- */}
      <section id="top" className="relative flex min-h-[88vh] items-end text-white">
        <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} fallback="bg-[#14181f]" />
        <div className={`${WRAP} relative pb-24 pt-40`}>
          <p className="text-[11px] font-bold uppercase tracking-[0.32em] text-white/70">Welcome</p>
          <h1 className="mt-6 max-w-3xl text-4xl font-extrabold leading-[1.04] tracking-tight sm:text-6xl">
            {landing.headline}
          </h1>
          {landing.subheadline ? (
            <p className="mt-6 max-w-xl text-lg text-white/80">{landing.subheadline}</p>
          ) : null}
          <div className="mt-10">
            <Cta to={menuPath} label={landing.ctaText} className={BTN} />
          </div>
        </div>
      </section>

      {/* ---- The statement: one large centred paragraph ---------------- */}
      {show.about ? (
        <section id="about" className="py-24 sm:py-32">
          <div className={`${WRAP} max-w-3xl text-center`}>
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              {landing.titles?.about || "About Us"}
            </h2>
            <span className="mx-auto my-8 block h-1 w-14 bg-[var(--primary,#e2571e)]" aria-hidden="true" />
            {paras(landing.about?.text).map((p, i) => (
              <p key={i} className={`mx-auto mb-6 max-w-2xl leading-[1.85] text-black/60 ${i === 0 ? "text-lg" : "text-base"}`}>
                {p}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Selling points as alternating full-width rows ------------- */}
      {show.features ? (
        <section id="what" className="pb-8">
          {features.map((f, i) => (
            <div key={f.title || i} className={`${i % 2 ? "bg-[#f6f4f1]" : "bg-white"}`}>
              <div className={`${WRAP} grid items-center gap-12 py-16 lg:grid-cols-2 lg:py-20`}>
                {f.image ? (
                  <img src={f.image.url} alt={f.image.alt || ""} loading="lazy"
                    className={`h-72 w-full rounded object-cover lg:h-[24rem] ${i % 2 ? "lg:order-2" : ""}`} />
                ) : null}
                <div className={f.image ? "" : "mx-auto max-w-2xl text-center"}>
                  <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[var(--primary,#e2571e)]">
                    {String(i + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">{f.title}</h3>
                  {f.text ? <p className="mt-4 text-[15px] leading-[1.85] text-black/60">{f.text}</p> : null}
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {/* ---- Menu as a horizontal rail --------------------------------- */}
      {show.menu ? (
        <section id="menu" className="bg-[#f6f4f1] py-24">
          <div className={`${WRAP} mb-10 flex flex-wrap items-end justify-between gap-6`}>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[var(--primary,#e2571e)]">
                From the kitchen
              </p>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
                {landing.titles?.menu || "Our Menu"}
              </h2>
            </div>
            <Cta to={menuPath} label="See the full menu" className={`${BTN} !bg-transparent !text-[#14181f] !px-0 !py-0 border-b-2 border-[var(--primary,#e2571e)] rounded-none`} />
          </div>

          {/* Scrolls sideways rather than wrapping: a rail says "a few of the
              things we are known for", a grid says "the whole catalogue". */}
          <div className="flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-4 sm:px-8">
            {categories.flatMap((c) => (c.products || []).slice(0, 2)).slice(0, 10).map((p) => (
              <a key={p.id} href={menuPath} className="w-64 shrink-0 snap-start bg-white shadow-sm transition hover:shadow-md">
                {p.image ? (
                  <img src={p.thumbnail || p.image} alt={p.imageAlt || p.name} loading="lazy" className="h-44 w-full object-cover" />
                ) : (
                  <div className="flex h-44 w-full items-center justify-center bg-black/5 text-3xl" aria-hidden="true">🍽️</div>
                )}
                <div className="p-5">
                  <h3 className="text-[15px] font-bold leading-snug">{p.name}</h3>
                  <p className="mt-2 text-[15px] font-extrabold text-[var(--primary,#e2571e)]">{symbol}{p.price}</p>
                </div>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Offers ---------------------------------------------------- */}
      {show.offers ? (
        <section className="py-20">
          <div className={`${WRAP} grid gap-6 sm:grid-cols-2 lg:grid-cols-3`}>
            {offers.map((o, i) => (
              <div key={o.code || o.title || i} className="border-l-4 border-[var(--primary,#e2571e)] bg-[#f6f4f1] p-7">
                <h3 className="text-lg font-extrabold tracking-tight">{o.title}</h3>
                {o.description ? <p className="mt-2 text-sm leading-relaxed text-black/60">{o.description}</p> : null}
                {o.code ? <p className="mt-4 font-mono text-xs font-bold tracking-widest">{o.code}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Gallery: a wide band, edge to edge ------------------------ */}
      {show.gallery ? (
        <section id="gallery" className="pb-24">
          <div className={`${WRAP} mb-8`}>
            <h2 className="text-3xl font-extrabold tracking-tight">Gallery</h2>
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
            {gallery.slice(0, 8).map((g, i) => (
              <img key={g.url + i} src={g.thumbnail || g.url} alt={g.alt || ""} loading="lazy"
                className="aspect-[4/3] w-full object-cover" />
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Footer: three columns ------------------------------------- */}
      <footer id="contact" className="bg-[#14181f] py-16 text-white">
        <div className={`${WRAP} grid gap-12 sm:grid-cols-2 lg:grid-cols-3`}>
          <div>
            {landing.logo ? <img src={landing.logo} alt="" className="mb-5 h-12 w-12 rounded object-cover" /> : null}
            <p className="text-base font-extrabold tracking-tight">{landing.headline}</p>
            {landing.subheadline ? <p className="mt-2 text-sm text-white/55">{landing.subheadline}</p> : null}
            <div className="mt-6 flex gap-5 text-[11px] font-bold uppercase tracking-[0.15em] text-white/60">
              {socialLinks(contact).map((l) => (
                <a key={l.label} href={l.href} target="_blank" rel="noreferrer noopener" className="hover:text-white">{l.label}</a>
              ))}
            </div>
          </div>

          {show.contact ? (
            <div>
              <h3 className="mb-5 text-[11px] font-bold uppercase tracking-[0.25em] text-[var(--primary,#e2571e)]">
                {landing.titles?.contact || "Contact"}
              </h3>
              {addressLines(contact)?.map((line) => (
                <p key={line} className="text-sm leading-relaxed text-white/65">{line}</p>
              ))}
              {contact.phone ? <p className="mt-3 text-sm"><a href={`tel:${contact.phone}`} className="hover:text-white">{contact.phone}</a></p> : null}
              {contact.email ? <p className="text-sm text-white/65"><a href={`mailto:${contact.email}`} className="hover:text-white">{contact.email}</a></p> : null}
            </div>
          ) : null}

          {show.hours ? (
            <div>
              <h3 className="mb-5 text-[11px] font-bold uppercase tracking-[0.25em] text-[var(--primary,#e2571e)]">Hours</h3>
              <ul className="space-y-1.5 text-sm">
                {hours.map((h) => (
                  <li key={h.day} className="flex justify-between gap-6">
                    <span className="text-white/55">{DAYS_SHORT[h.day]}</span>
                    <span>{h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className={`${WRAP} mt-12 border-t border-white/10 pt-8`}>
          <Cta to={menuPath} label={landing.ctaText} className={BTN} />
        </div>
      </footer>
    </div>
  );
}
