import React, { useState } from "react";
import { Backdrop, Cta, MobileLinks } from "./kit";
import {
  DAYS, addressLines, featuredDishes, paras, socialLinks, useGoogleFont, useLandingData, useScrolled,
} from "./data";

/**
 * Fine Dining — the tasting room.
 *
 * Obsidian and burnished gold, Bodoni over Manrope, and not one rounded
 * corner anywhere. Depth comes from stepped surface tones and hairline rules
 * rather than shadows, which is what makes a page read as printed rather than
 * as an app.
 *
 * The signatures are set as an editorial course list -- roman numerals, a
 * provenance note in the right margin -- because a restaurant at this end of
 * the market is selling craft rather than convenience.
 */

const FONT = "family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..700;1,6..96,400..500&family=Manrope:wght@300;400;500;600;700";
const WRAP = "mx-auto w-full max-w-7xl px-6 sm:px-10";
const CAPS = "font-['Manrope'] text-[11px] font-semibold uppercase tracking-[0.15em]";
const SERIF = "font-['Bodoni_Moda']";
const GOLD = "text-[#c5a059]";
const HAIR = "border-[#c5a059]/20";
const BTN = `${CAPS} inline-flex items-center justify-center bg-[#c5a059] px-8 py-3.5 text-[#121110] transition hover:bg-[#d8b673]`;
const GHOST = `${CAPS} inline-flex items-center justify-center border border-[#c5a059]/40 px-7 py-3.5 text-[#f5f2eb] transition hover:border-[#c5a059] hover:bg-[#c5a059]/[0.06]`;

export default function FineDining({ landing, store, menuPath, onBookTable }) {
  useGoogleFont(FONT);
  const { symbol, categories, offers, hours, contact, features, gallery, show } =
    useLandingData(landing, store);
  const scrolled = useScrolled(60);
  const [open, setOpen] = useState(false);
  const dishes = featuredDishes(landing, categories, 3);

  const links = [
    show.menu ? { id: "signatures", label: "Signatures" } : null,
    show.about ? { id: "story", label: "Story" } : null,
    show.gallery ? { id: "salon", label: "The Salon" } : null,
    show.hours || show.contact ? { id: "reserve", label: "Reservations" } : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-[#121110] font-['Manrope'] text-[15px] leading-6 text-[#f5f2eb]">
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-colors ${
          scrolled || open ? "bg-[#0f0e0d]/95 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.6)]" : "bg-transparent"
        } border-b ${scrolled || open ? HAIR : "border-transparent"}`}
      >
        <div className={`${WRAP} flex h-20 items-center justify-between gap-6`}>
          <a href="#top" className="flex min-w-0 items-center gap-3">
            {landing.logo ? <img src={landing.logo} alt="" className="h-10 w-10 object-cover" /> : null}
            <span className="flex flex-col">
              <span className={`${SERIF} ${GOLD} truncate text-[22px] uppercase tracking-[0.12em]`}>
                {landing.headline}
              </span>
              {landing.subheadline ? (
                <span className={`${CAPS} truncate text-[#9a8f80]`}>{landing.subheadline}</span>
              ) : null}
            </span>
          </a>

          <nav className="hidden items-center gap-1 lg:flex">
            {links.map((l) => (
              <a key={l.id} href={`#${l.id}`} className={`${CAPS} px-3 py-2 text-[#9e978e] transition hover:text-[#f5f2eb]`}>
                {l.label}
              </a>
            ))}
            <Cta to={menuPath} label={landing.ctaText} className={`${BTN} ml-4 !px-6 !py-2.5`} />
          </nav>

          {onBookTable ? (
            <button type="button" onClick={onBookTable} className={`${GHOST} ml-auto shrink-0 !px-4 !py-2.5 lg:ml-0`}>
              Book a Table
            </button>
          ) : null}
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className={`${CAPS} border border-[#c5a059]/40 px-4 py-2 text-[#f5f2eb] lg:hidden`}>
            {open ? "Close" : "Menu"}
          </button>
        </div>
        <MobileLinks
          open={open}
          links={links}
          onClose={() => setOpen(false)}
          className={`${WRAP} flex flex-col border-t bg-[#0f0e0d] pb-5 lg:hidden ${HAIR}`}
          linkClass={`${CAPS} py-3 text-[#f5f2eb]`}
        />
      </header>

      {/* ---- Hero ------------------------------------------------------ */}
      <section id="top" className="relative flex min-h-screen items-center justify-center text-center">
        <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} fallback="bg-[#121110]" />
        <div className={`${WRAP} relative py-40`}>
          <div className={`${CAPS} mb-10 flex flex-wrap items-center justify-center gap-4 text-[#9e978e]`}>
            <span className={`border ${HAIR} bg-[#181615]/70 px-3 py-1.5`}>Chef&apos;s Tasting Room</span>
            <span className={`border ${HAIR} bg-[#181615]/70 px-3 py-1.5 ${GOLD}`}>Reservations Advised</span>
          </div>
          <h1 className={`${SERIF} mx-auto max-w-4xl text-[42px] leading-[1.08] tracking-[-0.01em] sm:text-[72px] sm:leading-[1.05]`}>
            {landing.headline}
          </h1>
          {landing.subheadline ? (
            <p className="mx-auto mt-8 max-w-2xl text-[18px] font-light leading-[30px] text-[#cdc5bd]">
              {landing.subheadline}
            </p>
          ) : null}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
            <Cta to={menuPath} label={landing.ctaText} className={BTN} />
            {show.about ? <a href="#story" className={GHOST}>Read the Story</a> : null}
          </div>

          {show.features ? (
            <div className={`mx-auto mt-20 grid max-w-4xl grid-cols-1 border ${HAIR} bg-[#0f0e0d]/70 backdrop-blur-md sm:grid-cols-3`}>
              {features.map((f, i) => (
                <div key={f.title || i} className={`p-6 text-left ${i ? `border-t sm:border-l sm:border-t-0 ${HAIR}` : ""}`}>
                  <div className={`${SERIF} ${GOLD} text-[24px]`}>{f.title}</div>
                  {f.text ? <div className={`${CAPS} mt-2 text-[#9e978e]`}>{f.text}</div> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* ---- Signatures: a course list, not a catalogue ----------------- */}
      {show.menu && dishes.length ? (
        <section id="signatures" className={`border-t ${HAIR} bg-[#0f0e0d] py-24`}>
          <div className={WRAP}>
            <div className="mb-14 flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div>
                <span className={`${CAPS} ${GOLD} block`}>The Signature Few</span>
                <h2 className={`${SERIF} mt-4 text-[32px] leading-tight sm:text-[48px]`}>
                  {landing.titles?.menu || "The Tasting Experience"}
                </h2>
              </div>
              <Cta to={menuPath} label="View the full menu" className={`${CAPS} ${GOLD} self-start border-b border-[#c5a059]/40 pb-1 transition hover:border-[#c5a059] md:self-auto`} />
            </div>

            <div className="grid gap-12 lg:grid-cols-[1.15fr_1fr]">
              <ol className={`divide-y border-y ${HAIR} divide-[#c5a059]/20`}>
                {dishes.map((d, i) => (
                  <li key={d.id} className="flex items-start gap-6 py-7">
                    <span className={`${SERIF} ${GOLD} w-12 shrink-0 text-[20px]`}>
                      {["I", "II", "III"][i] || i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-6">
                        <h3 className={`${SERIF} text-[24px] leading-8`}>{d.name}</h3>
                        <span className={`${CAPS} ${GOLD} shrink-0`}>{symbol}{d.price}</span>
                      </div>
                      {d.description ? (
                        <p className="mt-2 text-[13px] leading-5 text-[#9e978e]">{d.description}</p>
                      ) : null}
                      <span className={`${CAPS} mt-3 block text-[#8c7a58]`}>{d.category}</span>
                    </div>
                  </li>
                ))}
              </ol>

              {dishes[0]?.image ? (
                <figure className={`border ${HAIR} bg-[#181615] p-2`}>
                  <img src={dishes[0].image} alt={dishes[0].imageAlt || dishes[0].name} loading="lazy"
                    className="aspect-[3/4] w-full object-cover" />
                  <figcaption className="bg-[#201d1b] p-5">
                    <span className={`${CAPS} ${GOLD} block`}>Presently on the pass</span>
                    <span className={`${SERIF} mt-1 block text-[24px]`}>{dishes[0].name}</span>
                  </figcaption>
                </figure>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Story ------------------------------------------------------ */}
      {show.about ? (
        <section id="story" className={`border-t ${HAIR} py-24`}>
          <div className={`${WRAP} grid items-center gap-14 lg:grid-cols-[1fr_1.2fr]`}>
            {landing.about?.image ? (
              <img src={landing.about.image.url} alt={landing.about.image.alt || ""} loading="lazy"
                className={`aspect-[3/4] w-full border object-cover ${HAIR}`} />
            ) : null}
            <div>
              <span className={`${CAPS} ${GOLD} block`}>Sensory Discipline</span>
              <h2 className={`${SERIF} mt-4 text-[32px] leading-tight sm:text-[48px]`}>
                {landing.titles?.about || "About Us"}
              </h2>
              {paras(landing.about?.text).map((p, i) => (
                <p key={i} className={`mt-6 text-[18px] font-light leading-[30px] ${i ? "text-[#9e978e]" : "text-[#cdc5bd]"}`}>
                  {p}
                </p>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Offers ----------------------------------------------------- */}
      {show.offers ? (
        <section className={`border-t ${HAIR} bg-[#0f0e0d] py-20`}>
          <div className={`${WRAP} grid gap-px bg-[#c5a059]/20 sm:grid-cols-2 lg:grid-cols-3`}>
            {offers.map((o, i) => (
              <div key={o.code || o.title || i} className="bg-[#121110] p-8">
                <h3 className={`${SERIF} ${GOLD} text-[24px]`}>{o.title}</h3>
                {o.description ? <p className="mt-3 text-[13px] leading-5 text-[#9e978e]">{o.description}</p> : null}
                {o.code ? <p className={`${CAPS} mt-5 border border-dashed border-[#c5a059]/40 px-3 py-1.5 inline-block`}>{o.code}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- The Salon -------------------------------------------------- */}
      {show.gallery ? (
        <section id="salon" className={`border-t ${HAIR} py-24`}>
          <div className={WRAP}>
            <span className={`${CAPS} ${GOLD} block`}>Spatial Choreography</span>
            <h2 className={`${SERIF} mb-12 mt-4 text-[32px] leading-tight sm:text-[48px]`}>The Dining Salon</h2>
            <div className="grid gap-px bg-[#c5a059]/20 sm:grid-cols-2 lg:grid-cols-3">
              {gallery.slice(0, 6).map((g, i) => (
                <img key={g.url + i} src={g.thumbnail || g.url} alt={g.alt || ""} loading="lazy"
                  className={`w-full object-cover ${i === 0 ? "aspect-[16/10] sm:col-span-2" : "aspect-[4/3]"}`} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Reserve ---------------------------------------------------- */}
      {show.hours || show.contact ? (
        <section id="reserve" className={`border-t ${HAIR} bg-[#0f0e0d] py-24`}>
          <div className={`${WRAP} grid gap-px bg-[#c5a059]/20 md:grid-cols-2`}>
            {show.contact ? (
              <div className="bg-[#121110] p-10">
                <span className={`${CAPS} ${GOLD} block`}>{landing.titles?.contact || "Provenance & Desk"}</span>
                <div className={`${SERIF} mt-5 space-y-1 text-[24px] leading-8`}>
                  {addressLines(contact)?.map((line) => <p key={line}>{line}</p>)}
                </div>
                {contact.phone ? (
                  <p className="mt-6"><a href={`tel:${contact.phone}`} className="text-[18px] font-light text-[#cdc5bd] hover:text-white">{contact.phone}</a></p>
                ) : null}
                {contact.email ? (
                  <p><a href={`mailto:${contact.email}`} className={`text-[18px] font-light ${GOLD}`}>{contact.email}</a></p>
                ) : null}
                <div className="mt-8"><Cta to={menuPath} label={landing.ctaText} className={BTN} /></div>
              </div>
            ) : null}
            {show.hours ? (
              <div className="bg-[#121110] p-10">
                <span className={`${CAPS} ${GOLD} block`}>Service Hours</span>
                <ul className={`mt-5 divide-y ${HAIR} divide-[#c5a059]/20`}>
                  {hours.map((h) => (
                    <li key={h.day} className="flex justify-between gap-8 py-3 text-[15px]">
                      <span className="text-[#9e978e]">{DAYS[h.day]}</span>
                      <span>{h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <footer className={`border-t ${HAIR} py-14`}>
        <div className={`${WRAP} flex flex-col items-center justify-between gap-6 sm:flex-row`}>
          <span className={`${SERIF} ${GOLD} text-[22px] uppercase tracking-[0.12em]`}>{landing.headline}</span>
          <div className={`${CAPS} flex gap-8 text-[#9e978e]`}>
            {socialLinks(contact).map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer noopener" className="hover:text-[#f5f2eb]">{l.label}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
