import React, { useState } from "react";
import { Backdrop, Cta, MobileLinks } from "./kit";
import { DAYS_SHORT, addressLines, paras, socialLinks, useLandingData } from "./data";

/**
 * Card — the friendly one.
 *
 * Light grey ground, everything on a rounded white panel, a masthead that
 * floats as a pill rather than spanning the page. It reads like a delivery app
 * rather than a restaurant brochure, which is the right register for a store
 * whose customers are mostly ordering rather than visiting.
 *
 * It is also the forgiving one. Every photograph sits inside a rounded card
 * with a solid ground behind it, so a store with phone snapshots of its dishes
 * still looks tidy -- which is most stores in their first month.
 */

const WRAP = "mx-auto w-full max-w-6xl px-4 sm:px-6";
const CARD = "rounded-3xl bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]";
const BTN =
  "inline-flex items-center justify-center rounded-2xl bg-brand text-brand-fg px-8 py-3.5 text-sm font-bold transition hover:opacity-90";

export default function CardStack({ landing, store, menuPath }) {
  const { symbol, categories, offers, hours, contact, features, gallery, show } =
    useLandingData(landing, store);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const links = [
    show.about ? { id: "about", label: "About" } : null,
    show.menu ? { id: "menu", label: "Menu" } : null,
    show.gallery ? { id: "gallery", label: "Photos" } : null,
    show.hours || show.contact ? { id: "visit", label: "Visit" } : null,
  ].filter(Boolean);

  const category = categories[Math.min(active, categories.length - 1)] || categories[0];

  return (
    <div className="min-h-screen bg-[#f2f4f7] text-[#0f172a] [font-family:var(--font-body,Inter),system-ui,sans-serif]">
      {/* A pill that floats over the page rather than a bar across it. */}
      <header className="fixed inset-x-0 top-4 z-50 px-4">
        <div className={`${WRAP} !px-0`}>
          <div className="flex h-14 items-center justify-between gap-4 rounded-2xl bg-white/90 px-4 shadow-[0_4px_20px_rgba(15,23,42,0.08)] backdrop-blur">
            <a href="#top" className="flex min-w-0 items-center gap-2.5">
              {landing.logo ? <img src={landing.logo} alt="" className="h-9 w-9 rounded-xl object-cover" /> : null}
              <span className="truncate text-sm font-extrabold">{landing.headline}</span>
            </a>
            <nav className="hidden items-center gap-1 md:flex">
              {links.map((l) => (
                <a key={l.id} href={`#${l.id}`}
                  className="rounded-xl px-3.5 py-2 text-[13px] font-semibold text-black/60 hover:bg-black/5 hover:text-black">
                  {l.label}
                </a>
              ))}
              <Cta to={menuPath} label={landing.ctaText} className={`${BTN} !px-5 !py-2.5 !text-[13px] ml-2`} />
            </nav>
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
              className="md:hidden rounded-xl bg-black/5 px-3.5 py-2 text-[13px] font-bold">
              {open ? "Close" : "Menu"}
            </button>
          </div>
          <MobileLinks
            open={open}
            links={links}
            onClose={() => setOpen(false)}
            className="mt-2 flex flex-col rounded-2xl bg-white p-2 shadow-lg md:hidden"
            linkClass="rounded-xl px-4 py-3 text-sm font-semibold"
          />
        </div>
      </header>

      {/* ---- Hero: a panel over the photograph -------------------------- */}
      <section id="top" className="relative flex min-h-[86vh] items-center justify-center px-4 py-28">
        <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} fallback="bg-slate-700" />
        <div className={`relative w-full max-w-xl ${CARD} p-8 text-center sm:p-11`}>
          {landing.logo ? (
            <img src={landing.logo} alt="" className="mx-auto -mt-20 mb-6 h-24 w-24 rounded-3xl border-4 border-white object-cover shadow-lg" />
          ) : null}
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-[2.4rem]">{landing.headline}</h1>
          {landing.subheadline ? <p className="mt-4 text-base text-black/55">{landing.subheadline}</p> : null}
          <div className="mt-8">
            <Cta to={menuPath} label={landing.ctaText} className={`${BTN} w-full !py-4 !text-base`} />
          </div>
          {show.hours ? (
            <p className="mt-4 text-xs font-semibold text-black/40">
              Open {hours.find((h) => h.isOpen)?.openTime || "—"} – {hours.find((h) => h.isOpen)?.closeTime || "—"}
            </p>
          ) : null}
        </div>
      </section>

      {/* ---- Selling points as small icon cards ------------------------- */}
      {show.features ? (
        <section className="pb-6">
          <div className={`${WRAP} grid gap-4 sm:grid-cols-2 lg:grid-cols-3`}>
            {features.map((f, i) => (
              <div key={f.title || i} className={`${CARD} p-6`}>
                {f.image ? (
                  <img src={f.image.thumbnail || f.image.url} alt="" loading="lazy" className="mb-4 h-14 w-14 rounded-2xl object-cover" />
                ) : (
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-xl font-extrabold text-[var(--primary,#e2571e)]">
                    {i + 1}
                  </div>
                )}
                <h3 className="text-[15px] font-extrabold">{f.title}</h3>
                {f.text ? <p className="mt-2 text-[13.5px] leading-relaxed text-black/55">{f.text}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- About in a card ------------------------------------------- */}
      {show.about ? (
        <section id="about" className="py-6">
          <div className={WRAP}>
            <div className={`${CARD} grid items-center gap-8 overflow-hidden lg:grid-cols-2`}>
              {landing.about?.image ? (
                <img src={landing.about.image.url} alt={landing.about.image.alt || ""} loading="lazy"
                  className="h-72 w-full object-cover lg:h-full lg:min-h-[22rem]" />
              ) : null}
              <div className="p-8 sm:p-10">
                <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                  {landing.titles?.about || "About Us"}
                </h2>
                {paras(landing.about?.text).map((p, i) => (
                  <p key={i} className="mt-4 text-[14.5px] leading-[1.8] text-black/55">{p}</p>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Menu: chips and product cards, app-style ------------------- */}
      {show.menu ? (
        <section id="menu" className="py-10">
          <div className={WRAP}>
            <h2 className="mb-5 text-2xl font-extrabold tracking-tight sm:text-3xl">
              {landing.titles?.menu || "Our Menu"}
            </h2>

            <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
              {categories.slice(0, 10).map((c, i) => (
                <button key={c.id} type="button" onClick={() => setActive(i)}
                  className={`shrink-0 whitespace-nowrap rounded-2xl px-4 py-2.5 text-[13px] font-bold transition ${
                    i === active ? "bg-brand text-brand-fg" : "bg-white text-black/60 hover:text-black"
                  }`}>
                  {c.icon ? <span className="mr-1.5">{c.icon}</span> : null}
                  {c.name}
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(category?.products || []).slice(0, 6).map((p) => (
                <a key={p.id} href={menuPath} className={`${CARD} overflow-hidden transition hover:shadow-md`}>
                  {p.image ? (
                    <img src={p.thumbnail || p.image} alt={p.imageAlt || p.name} loading="lazy" className="h-40 w-full object-cover" />
                  ) : (
                    <div className="flex h-40 w-full items-center justify-center bg-black/5 text-3xl" aria-hidden="true">🍽️</div>
                  )}
                  <div className="p-4">
                    <h3 className="text-[14.5px] font-bold leading-snug">{p.name}</h3>
                    {p.description ? (
                      <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-black/50">{p.description}</p>
                    ) : null}
                    <span className="mt-3 inline-block rounded-xl bg-brand/10 px-3 py-1.5 text-[13px] font-extrabold text-[var(--primary,#e2571e)]">
                      {symbol}{p.price}
                    </span>
                  </div>
                </a>
              ))}
            </div>

            <div className="mt-8">
              <Cta to={menuPath} label={landing.ctaText} className={`${BTN} w-full !py-4 sm:!w-auto sm:!px-12`} />
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Offers ----------------------------------------------------- */}
      {show.offers ? (
        <section className="py-6">
          <div className={`${WRAP} grid gap-4 sm:grid-cols-2 lg:grid-cols-3`}>
            {offers.map((o, i) => (
              <div key={o.code || o.title || i} className={`${CARD} p-6`}>
                <h3 className="text-[15px] font-extrabold">{o.title}</h3>
                {o.description ? <p className="mt-2 text-[13.5px] leading-relaxed text-black/55">{o.description}</p> : null}
                {o.code ? (
                  <p className="mt-4 inline-block rounded-xl border border-dashed border-black/20 px-3 py-1.5 font-mono text-xs font-bold">
                    {o.code}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Gallery ---------------------------------------------------- */}
      {show.gallery ? (
        <section id="gallery" className="py-10">
          <div className={WRAP}>
            <h2 className="mb-5 text-2xl font-extrabold tracking-tight">Photos</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {gallery.slice(0, 8).map((g, i) => (
                <img key={g.url + i} src={g.thumbnail || g.url} alt={g.alt || ""} loading="lazy"
                  className="aspect-square w-full rounded-2xl object-cover" />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Visit: two cards side by side ------------------------------ */}
      {show.hours || show.contact ? (
        <section id="visit" className="py-10">
          <div className={`${WRAP} grid gap-4 sm:grid-cols-2`}>
            {show.contact ? (
              <div className={`${CARD} p-7`}>
                <h3 className="text-lg font-extrabold">{landing.titles?.contact || "Visit us"}</h3>
                <div className="mt-4 space-y-0.5 text-[14px] leading-relaxed text-black/60">
                  {addressLines(contact)?.map((line) => <p key={line}>{line}</p>)}
                </div>
                {contact.phone ? (
                  <a href={`tel:${contact.phone}`} className={`${BTN} mt-5 w-full !bg-black/5 !text-[#0f172a]`}>
                    Call {contact.phone}
                  </a>
                ) : null}
                {contact.mapUrl ? (
                  <a href={contact.mapUrl} target="_blank" rel="noreferrer noopener"
                    className={`${BTN} mt-2.5 w-full !bg-black/5 !text-[#0f172a]`}>
                    Directions
                  </a>
                ) : null}
              </div>
            ) : null}
            {show.hours ? (
              <div className={`${CARD} p-7`}>
                <h3 className="text-lg font-extrabold">Opening hours</h3>
                <ul className="mt-4 space-y-2">
                  {hours.map((h) => (
                    <li key={h.day} className="flex justify-between gap-6 text-[14px]">
                      <span className="text-black/50">{DAYS_SHORT[h.day]}</span>
                      <span className="font-semibold">{h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <footer className="px-4 pb-10 pt-6 sm:px-6">
        <div className={`${WRAP} !px-0`}>
          <div className={`${CARD} flex flex-col items-center gap-5 p-8 text-center`}>
            {landing.logo ? <img src={landing.logo} alt="" className="h-12 w-12 rounded-2xl object-cover" /> : null}
            <p className="text-base font-extrabold">{landing.headline}</p>
            <Cta to={menuPath} label={landing.ctaText} className={`${BTN} !px-10`} />
            <div className="flex gap-5 text-[12.5px] font-semibold text-black/45">
              {socialLinks(contact).map((l) => (
                <a key={l.label} href={l.href} target="_blank" rel="noreferrer noopener" className="hover:text-black">{l.label}</a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
