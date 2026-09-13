import React, { useState } from "react";
import { Backdrop, Cta, MobileLinks } from "./kit";
import {
  DAYS, addressLines, featuredDishes, paras, socialLinks, useGoogleFont, useLandingData, useScrolled,
} from "./data";

/**
 * Omakase — the counter.
 *
 * The quietest of the five. A narrow content column, wide margins, a vertical
 * rail running down the right, and a single dish held up as a card beside the
 * headline. Nothing is centred except the hero's own restraint.
 *
 * The rail is set in the store's own words rather than in borrowed Japanese:
 * a page that prints characters the restaurant did not write is costume, and
 * the restraint is the point.
 *
 * A counter seats ten and serves one thing, so the featured dishes are given
 * the weight the whole menu gets elsewhere -- a numbered ledger with the
 * provenance in the margin.
 */

const FONT = "family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..600;1,6..96,400..500&family=Manrope:wght@300;400;500;600";
const WRAP = "mx-auto w-full max-w-7xl px-6 sm:px-10";
const SERIF = "font-['Bodoni_Moda']";
const CAPS = "font-['Manrope'] text-[11px] font-semibold uppercase tracking-[0.15em]";
const GOLD = "text-[#d4ae7c]";
const LINE = "border-[#3f3c38]";
const BTN = `${CAPS} inline-flex items-center justify-center bg-[#d4ae7c] px-8 py-3.5 text-[#1a140b] transition hover:bg-[#b38954]`;
const GHOST = `${CAPS} inline-flex items-center justify-center border border-[#3f3c38] bg-[#242325] px-7 py-3.5 text-[#eae3d8] transition hover:text-[#d4ae7c]`;

export default function Omakase({ landing, store, menuPath, onBookTable }) {
  useGoogleFont(FONT);
  const { symbol, categories, offers, hours, contact, features, gallery, show } =
    useLandingData(landing, store);
  const scrolled = useScrolled(60);
  const [open, setOpen] = useState(false);
  const dishes = featuredDishes(landing, categories, 3);
  const hero = dishes[0];

  const links = [
    show.about ? { id: "philosophy", label: "Philosophy" } : null,
    show.menu ? { id: "ledger", label: "The Ledger" } : null,
    show.gallery ? { id: "room", label: "The Room" } : null,
    show.hours || show.contact ? { id: "seatings", label: "Seatings" } : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-[#131314] font-['Manrope'] text-[15px] leading-6 text-[#eae3d8]">
      {/* A single line of standing information above everything, the way a
          counter posts what arrived this morning. */}
      <div className={`border-b bg-[#0d0d0e] py-2 ${LINE}/60`}>
        <div className={`${WRAP} flex flex-wrap items-center justify-between gap-4 ${CAPS} text-[10px] text-[#989086]`}>
          <span className="truncate">{landing.subheadline || landing.headline}</span>
          <span className={GOLD}>Seating by appointment</span>
        </div>
      </div>

      <header className={`sticky top-0 z-50 transition-colors ${scrolled || open ? `bg-[#0d0d0e]/95 backdrop-blur-xl border-b ${LINE}/60` : "bg-transparent"}`}>
        <div className={`${WRAP} flex h-20 items-center justify-between gap-6`}>
          <a href="#top" className="flex min-w-0 items-center gap-3">
            {landing.logo ? <img src={landing.logo} alt="" className="h-10 w-10 rounded-full object-cover" /> : null}
            <span className={`${SERIF} ${GOLD} truncate text-[22px] uppercase tracking-[0.14em]`}>{landing.headline}</span>
          </a>
          <nav className="hidden items-center gap-1 lg:flex">
            {links.map((l) => (
              <a key={l.id} href={`#${l.id}`} className={`${CAPS} px-3 py-2 text-[#cfc7bc] transition hover:text-[#d4ae7c]`}>{l.label}</a>
            ))}
            <Cta to={menuPath} label={landing.ctaText} className={`${BTN} ml-4 !px-6 !py-2.5`} />
          </nav>
          {onBookTable ? (
            <button type="button" onClick={onBookTable} className={`${GHOST} ml-auto shrink-0 !px-4 !py-2.5 lg:ml-0`}>
              Book a Table
            </button>
          ) : null}
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className={`${CAPS} border px-4 py-2 lg:hidden ${LINE}`}>
            {open ? "Close" : "Menu"}
          </button>
        </div>
        <MobileLinks open={open} links={links} onClose={() => setOpen(false)}
          className={`${WRAP} flex flex-col border-t bg-[#0d0d0e] pb-5 lg:hidden ${LINE}/60`}
          linkClass={`${CAPS} py-3`} />
      </header>

      {/* ---- Hero: editorial left, rail and one dish right -------------- */}
      <section id="top" className="relative flex min-h-[88vh] items-center overflow-hidden bg-[#181819]">
        <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} fallback="bg-[#181819]" />
        <div className={`${WRAP} relative z-10 flex w-full flex-col items-start justify-between gap-14 py-24 md:flex-row`}>
          <div className="max-w-3xl">
            <div className="mb-7 flex flex-wrap items-center gap-3">
              <span className={`${CAPS} ${GOLD} inline-flex items-center gap-2 border bg-[#242325] px-3 py-1.5 ${LINE}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-[#8b2626]" />
                Counter Sanctuary
              </span>
              <span className={`${CAPS} text-[#989086]`}>By reservation</span>
            </div>

            <h1 className={`${SERIF} text-[42px] leading-[1.14] tracking-[-0.01em] sm:text-[68px] sm:leading-[1.08]`}>
              {landing.headline}
            </h1>
            {landing.subheadline ? (
              <p className="mt-7 max-w-xl text-[18px] font-light leading-[30px] text-[#cfc7bc]">{landing.subheadline}</p>
            ) : null}

            <div className="mt-10 flex flex-wrap gap-3">
              <Cta to={menuPath} label={landing.ctaText} className={BTN} />
              {show.about ? <a href="#philosophy" className={GHOST}>Read the Creed</a> : null}
            </div>

            {show.features ? (
              <div className={`mt-16 grid max-w-lg grid-cols-3 gap-8 border bg-[#0d0d0e]/60 p-6 backdrop-blur-md ${LINE}/60`}>
                {features.map((f, i) => (
                  <div key={f.title || i}>
                    <div className={`${SERIF} ${GOLD} text-[24px] leading-8`}>{f.title}</div>
                    {f.text ? <div className={`${CAPS} mt-1 text-[10px] text-[#989086]`}>{f.text}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="hidden shrink-0 flex-row items-stretch justify-end gap-10 self-stretch md:flex">
            <div className="flex flex-col items-center justify-between py-2">
              <span className={`${SERIF} ${GOLD} [writing-mode:vertical-rl] text-[26px] tracking-[0.3em] opacity-80`}>
                {landing.headline}
              </span>
              <span className="my-6 h-24 w-px bg-[#d4ae7c]/30" />
              <span className={`${CAPS} [writing-mode:vertical-rl] text-[#989086]`}>
                {landing.ctaText || "View Menu"}
              </span>
            </div>

            {hero ? (
              <figure className={`w-64 border bg-[#1c1c1e] p-1.5 shadow-2xl ${LINE}`}>
                {hero.image ? (
                  <img src={hero.image} alt={hero.imageAlt || hero.name} loading="lazy" className="h-80 w-full object-cover" />
                ) : null}
                <figcaption className="bg-[#242325] p-4 text-left">
                  <span className={`${CAPS} ${GOLD} block text-[9px]`}>{hero.category}</span>
                  <span className="mt-1 block text-[16px] font-semibold">{hero.name}</span>
                  {hero.description ? (
                    <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-[#989086]">{hero.description}</p>
                  ) : null}
                </figcaption>
              </figure>
            ) : null}
          </div>
        </div>
      </section>

      {/* ---- Philosophy: an asymmetric bento ---------------------------- */}
      {show.about || show.features ? (
        <section id="philosophy" className={`border-t bg-[#0d0d0e] px-0 py-24 ${LINE}/40`}>
          <div className={WRAP}>
            <div className="mb-14 flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div className="max-w-2xl">
                <span className={`${CAPS} ${GOLD} block`}>The Art of Relentless Reduction</span>
                <h2 className={`${SERIF} mt-4 text-[32px] leading-tight sm:text-[48px]`}>
                  {landing.titles?.about || "About Us"}
                </h2>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
              <div className={`border bg-[#181819] p-10 md:col-span-7 ${LINE}/60`}>
                <span className={`${SERIF} ${GOLD} text-[24px]`}>01</span>
                {paras(landing.about?.text).map((p, i) => (
                  <p key={i} className="mt-5 text-[15px] leading-[26px] text-[#cfc7bc]">{p}</p>
                ))}
                {landing.about?.image ? (
                  <img src={landing.about.image.url} alt={landing.about.image.alt || ""} loading="lazy"
                    className={`mt-8 h-64 w-full border object-cover ${LINE}/40`} />
                ) : null}
              </div>

              <div className="flex flex-col gap-6 md:col-span-5">
                {features.slice(0, 2).map((f, i) => (
                  <div key={f.title || i} className={`flex-1 border bg-[#181819] p-8 ${LINE}/60`}>
                    <span className={`${SERIF} ${GOLD} text-[24px]`}>{String(i + 2).padStart(2, "0")}</span>
                    <h3 className={`${SERIF} mt-3 text-[24px] leading-8`}>{f.title}</h3>
                    {f.text ? <p className="mt-3 text-[15px] leading-[26px] text-[#cfc7bc]">{f.text}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- The ledger: a few courses, weighted ------------------------ */}
      {show.menu && dishes.length ? (
        <section id="ledger" className={`border-t py-24 ${LINE}/40`}>
          <div className={WRAP}>
            <div className="mb-12 flex flex-col justify-between gap-4 md:flex-row md:items-baseline">
              <div>
                <span className={`${CAPS} ${GOLD} block`}>The Counter Ledger</span>
                <h2 className={`${SERIF} mt-4 text-[32px] leading-tight sm:text-[48px]`}>
                  {landing.titles?.menu || "Signature Courses"}
                </h2>
              </div>
              <span className="text-[13px] leading-5 text-[#989086]">
                A representative few. The full progression is set on the day.
              </span>
            </div>

            <div className={`grid gap-6 lg:grid-cols-12`}>
              <ol className={`space-y-6 lg:col-span-7`}>
                {dishes.map((d, i) => (
                  <li key={d.id} className={`border bg-[#181819] p-7 ${LINE}/60`}>
                    <div className="flex items-start justify-between gap-6">
                      <div className="min-w-0">
                        <span className={`${CAPS} ${GOLD} block text-[10px]`}>
                          Course {["I", "II", "III"][i] || i + 1} • {d.category}
                        </span>
                        <h3 className="mt-2 text-[16px] font-semibold">{d.name}</h3>
                        {d.description ? (
                          <p className="mt-1.5 text-[13px] leading-5 text-[#989086]">{d.description}</p>
                        ) : null}
                      </div>
                      <span className={`${CAPS} ${GOLD} shrink-0`}>{symbol}{d.price}</span>
                    </div>
                  </li>
                ))}
              </ol>

              <div className={`flex flex-col justify-between border bg-[#1c1c1e] p-8 lg:col-span-5 ${LINE}/60`}>
                <div>
                  <span className={`${CAPS} ${GOLD} block`}>The Full Progression</span>
                  <h3 className={`${SERIF} mt-3 text-[32px] leading-10`}>
                    {categories.length} {categories.length === 1 ? "chapter" : "chapters"}, set on the day
                  </h3>
                  <p className="mt-4 text-[15px] leading-[26px] text-[#cfc7bc]">
                    What is above is a taste of the ledger. The rest is on the menu, priced and ready to order.
                  </p>
                </div>
                <Cta to={menuPath} label={landing.ctaText} className={`${BTN} mt-8`} />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Offers ----------------------------------------------------- */}
      {show.offers ? (
        <section className={`border-t bg-[#0d0d0e] py-20 ${LINE}/40`}>
          <div className={`${WRAP} grid gap-6 sm:grid-cols-2 lg:grid-cols-3`}>
            {offers.map((o, i) => (
              <div key={o.code || o.title || i} className={`border bg-[#181819] p-8 ${LINE}/60`}>
                <h3 className={`${SERIF} ${GOLD} text-[24px]`}>{o.title}</h3>
                {o.description ? <p className="mt-3 text-[13px] leading-5 text-[#989086]">{o.description}</p> : null}
                {o.code ? <p className={`${CAPS} mt-5 inline-block border border-dashed px-3 py-1.5 ${LINE}`}>{o.code}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- The room --------------------------------------------------- */}
      {show.gallery ? (
        <section id="room" className={`border-t py-24 ${LINE}/40`}>
          <div className={WRAP}>
            <span className={`${CAPS} ${GOLD} block`}>The Room</span>
            <h2 className={`${SERIF} mb-12 mt-4 text-[32px] leading-tight sm:text-[48px]`}>Ten Seats</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {gallery.slice(0, 6).map((g, i) => (
                <img key={g.url + i} src={g.thumbnail || g.url} alt={g.alt || ""} loading="lazy"
                  className={`w-full border object-cover ${LINE}/40 ${i % 3 === 0 ? "aspect-[3/4]" : "aspect-square"}`} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Seatings --------------------------------------------------- */}
      {show.hours || show.contact ? (
        <section id="seatings" className={`border-t bg-[#0d0d0e] py-24 ${LINE}/40`}>
          <div className={WRAP}>
            <div className="mx-auto mb-14 max-w-2xl text-center">
              <span className={`${CAPS} ${GOLD} block`}>Nightly Assembly</span>
              <h2 className={`${SERIF} mt-4 text-[32px] leading-tight sm:text-[48px]`}>
                {landing.titles?.contact || "Seatings & Arrival"}
              </h2>
            </div>
            <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
              {show.hours ? (
                <div className={`border bg-[#1c1c1e] p-9 ${LINE}/60`}>
                  <span className={`${CAPS} ${GOLD} block`}>Service Windows</span>
                  <ul className={`mt-6 divide-y ${LINE}/40 divide-[#3f3c38]/60`}>
                    {hours.map((h) => (
                      <li key={h.day} className="flex justify-between gap-6 py-3 text-[15px]">
                        <span className="text-[#989086]">{DAYS[h.day]}</span>
                        <span>{h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {show.contact ? (
                <div className={`flex flex-col justify-between border bg-[#1c1c1e] p-9 ${LINE}/60`}>
                  <div>
                    <span className={`${CAPS} ${GOLD} block`}>Arrival</span>
                    <div className={`${SERIF} mt-5 space-y-1 text-[24px] leading-8`}>
                      {addressLines(contact)?.map((line) => <p key={line}>{line}</p>)}
                    </div>
                    {contact.phone ? (
                      <p className="mt-5"><a href={`tel:${contact.phone}`} className="text-[18px] font-light text-[#cfc7bc]">{contact.phone}</a></p>
                    ) : null}
                    {contact.email ? (
                      <p><a href={`mailto:${contact.email}`} className={`text-[18px] font-light ${GOLD}`}>{contact.email}</a></p>
                    ) : null}
                  </div>
                  <Cta to={menuPath} label={landing.ctaText} className={`${BTN} mt-8`} />
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <footer className={`border-t py-14 ${LINE}/40`}>
        <div className={`${WRAP} flex flex-col items-center justify-between gap-6 sm:flex-row`}>
          <span className={`${SERIF} ${GOLD} text-[22px] uppercase tracking-[0.14em]`}>{landing.headline}</span>
          <div className={`${CAPS} flex gap-8 text-[#989086]`}>
            {socialLinks(contact).map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer noopener" className="hover:text-[#eae3d8]">{l.label}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
