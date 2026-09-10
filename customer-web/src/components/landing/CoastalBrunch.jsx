import React, { useState } from "react";
import { Cta, MobileLinks } from "./kit";
import {
  DAYS, addressLines, featuredDishes, paras, socialLinks, useGoogleFont, useLandingData, useScrolled,
} from "./data";

/**
 * Coastal Brunch — the daytime room.
 *
 * The only light one of the five. Warm sand and paper, an italic serif for the
 * accents, generous rounding, and photography that sits in the page rather
 * than behind it: the hero is a two-column spread with the picture framed on
 * the right, not a dark scrim over a full-bleed image.
 *
 * A brunch room's customers arrive in daylight and read the page in daylight,
 * so the dark treatment every other template uses would be the wrong room.
 */

const FONT = "family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..600&family=Manrope:wght@300;400;500;600;700";
const WRAP = "mx-auto w-full max-w-6xl px-5 sm:px-8";
const SERIF = "font-[Fraunces]";
const CAPS = "font-[Manrope] text-[11px] font-semibold uppercase tracking-[0.16em]";
const WARM = "text-[#c2610c]";
const LINE = "border-[#e6ddcd]";
const BTN = `${CAPS} inline-flex items-center justify-center rounded-full bg-[#e07a25] px-8 py-3.5 text-white transition hover:bg-[#c2610c]`;
const GHOST = `${CAPS} inline-flex items-center justify-center rounded-full border border-[#d8cab2] px-7 py-3.5 text-[#4a3d2c] transition hover:border-[#e07a25] hover:text-[#c2610c]`;

export default function CoastalBrunch({ landing, store, menuPath }) {
  useGoogleFont(FONT);
  const { symbol, categories, offers, hours, contact, features, gallery, show } =
    useLandingData(landing, store);
  const scrolled = useScrolled(40);
  const [open, setOpen] = useState(false);
  const dishes = featuredDishes(landing, categories, 3);

  const links = [
    show.menu ? { id: "morning", label: "Morning Menu" } : null,
    show.about ? { id: "kitchen", label: "Our Kitchen" } : null,
    show.gallery ? { id: "patio", label: "The Patio" } : null,
    show.hours || show.contact ? { id: "find", label: "Find Us" } : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-[#fdf9f2] font-[Manrope] text-[15px] leading-6 text-[#2f2a22]">
      <header className={`sticky top-0 z-50 transition-shadow ${scrolled || open ? "bg-[#fdf9f2]/95 backdrop-blur shadow-[0_1px_0_#e6ddcd]" : ""}`}>
        <div className={`${WRAP} flex h-[72px] items-center justify-between gap-5`}>
          <a href="#top" className="flex min-w-0 items-center gap-3">
            {landing.logo ? <img src={landing.logo} alt="" className="h-10 w-10 rounded-full object-cover" /> : null}
            <span className={`${SERIF} truncate text-[20px] font-semibold tracking-tight`}>{landing.headline}</span>
          </a>
          <nav className="hidden items-center gap-7 lg:flex">
            {links.map((l) => (
              <a key={l.id} href={`#${l.id}`} className={`${CAPS} text-[#7a6a55] transition hover:text-[#2f2a22]`}>{l.label}</a>
            ))}
            <Cta to={menuPath} label={landing.ctaText} className={`${BTN} !px-6 !py-2.5`} />
          </nav>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className={`${CAPS} rounded-full border px-4 py-2 lg:hidden ${LINE}`}>
            {open ? "Close" : "Menu"}
          </button>
        </div>
        <MobileLinks open={open} links={links} onClose={() => setOpen(false)}
          className={`${WRAP} flex flex-col border-t pb-5 lg:hidden ${LINE}`}
          linkClass={`${CAPS} py-3`} />
      </header>

      {/* ---- Hero: a spread, not a scrim -------------------------------- */}
      <section id="top" className="relative overflow-hidden">
        {/* A soft wash rather than a photograph behind the words. */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_80%_0%,#fbe6cf_0%,#fdf9f2_60%)]" aria-hidden="true" />
        <div className={`${WRAP} relative grid items-center gap-12 py-16 lg:grid-cols-[1.05fr_1fr] lg:py-24`}>
          <div>
            <span className={`${CAPS} ${WARM}`}>Coastal Roast &amp; Bakehouse</span>
            <h1 className={`${SERIF} mt-5 text-[38px] font-semibold leading-[1.1] tracking-tight sm:text-[54px]`}>
              {landing.headline}
            </h1>
            {landing.subheadline ? (
              <p className="mt-6 max-w-lg text-[17px] leading-[29px] text-[#6b5c47]">{landing.subheadline}</p>
            ) : null}

            {show.hours ? (
              <div className={`mt-9 rounded-2xl border bg-white/70 p-5 ${LINE}`}>
                <span className={`${CAPS} text-[#8a7860]`}>Today</span>
                <div className={`${SERIF} mt-1 text-[26px] font-semibold`}>
                  {hours.find((h) => h.isOpen)?.openTime || "—"} – {hours.find((h) => h.isOpen)?.closeTime || "—"}
                </div>
              </div>
            ) : null}

            <div className="mt-9 flex flex-wrap gap-3">
              <Cta to={menuPath} label={landing.ctaText} className={BTN} />
              {show.menu ? <a href="#morning" className={GHOST}>Browse the Menu</a> : null}
            </div>
          </div>

          <div className="relative">
            {landing.backgroundImage ? (
              <img src={landing.backgroundImage} alt={landing.backgroundAlt || ""}
                className="aspect-[4/3] w-full rounded-[1.75rem] object-cover shadow-[0_20px_50px_rgba(80,60,30,0.14)]" />
            ) : (
              <div className="aspect-[4/3] w-full rounded-[1.75rem] bg-[#f0e2cd]" />
            )}
            {dishes[0] ? (
              <div className={`absolute -bottom-6 left-6 right-6 flex items-center gap-4 rounded-2xl border bg-white p-4 shadow-lg ${LINE} sm:right-auto sm:w-80`}>
                {dishes[0].image ? (
                  <img src={dishes[0].thumbnail || dishes[0].image} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                ) : null}
                <div className="min-w-0">
                  <span className={`${CAPS} block text-[10px] text-[#8a7860]`}>{dishes[0].category}</span>
                  <span className="mt-0.5 block truncate text-[14px] font-bold">{dishes[0].name}</span>
                </div>
                <span className={`${SERIF} ml-auto shrink-0 text-[18px] font-semibold ${WARM}`}>
                  {symbol}{dishes[0].price}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {show.features ? (
        <div className={`mt-10 border-y bg-white/60 ${LINE}`}>
          <div className={`${WRAP} grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0 ${LINE} divide-[#e6ddcd]`}>
            {features.map((f, i) => (
              <div key={f.title || i} className="py-7 sm:px-8 sm:first:pl-0 sm:last:pr-0">
                <span className={`${CAPS} block text-[#8a7860]`}>{String(i + 1).padStart(2, "0")}</span>
                <div className={`${SERIF} mt-2 text-[22px] font-semibold`}>{f.title}</div>
                {f.text ? <p className="mt-1.5 text-[13px] leading-5 text-[#7a6a55]">{f.text}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ---- A few things worth getting up for -------------------------- */}
      {show.menu && dishes.length ? (
        <section id="morning" className="py-20">
          <div className={WRAP}>
            <div className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <span className={`${CAPS} ${WARM}`}>Daily Culinary Repertoire</span>
                <h2 className={`${SERIF} mt-3 text-[30px] font-semibold tracking-tight sm:text-[40px]`}>
                  {landing.titles?.menu || "Morning Favourites"}
                </h2>
              </div>
              <Cta to={menuPath} label="See everything" className={`${CAPS} ${WARM} self-start border-b border-[#e07a25]/40 pb-1 hover:border-[#e07a25] sm:self-auto`} />
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {dishes.map((d) => (
                <a key={d.id} href={menuPath} className={`group overflow-hidden rounded-3xl border bg-white transition hover:shadow-lg ${LINE}`}>
                  {d.image ? (
                    <img src={d.thumbnail || d.image} alt={d.imageAlt || d.name} loading="lazy" className="h-52 w-full object-cover" />
                  ) : null}
                  <div className="p-6">
                    <span className={`${CAPS} block text-[10px] text-[#8a7860]`}>{d.category}</span>
                    <div className="mt-2 flex items-baseline justify-between gap-3">
                      <h3 className={`${SERIF} text-[20px] font-semibold leading-tight`}>{d.name}</h3>
                      <span className={`shrink-0 text-[16px] font-bold ${WARM}`}>{symbol}{d.price}</span>
                    </div>
                    {d.description ? (
                      <p className="mt-2 line-clamp-3 text-[13px] leading-5 text-[#7a6a55]">{d.description}</p>
                    ) : null}
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Our kitchen ------------------------------------------------ */}
      {show.about ? (
        <section id="kitchen" className={`border-y bg-white/60 py-20 ${LINE}`}>
          <div className={`${WRAP} grid items-center gap-12 lg:grid-cols-2`}>
            <div>
              <span className={`${CAPS} ${WARM}`}>Micro-Batch Philosophy</span>
              <h2 className={`${SERIF} mt-3 text-[30px] font-semibold tracking-tight sm:text-[40px]`}>
                {landing.titles?.about || "The Bakehouse"}
              </h2>
              {paras(landing.about?.text).map((p, i) => (
                <p key={i} className="mt-5 text-[16px] leading-[28px] text-[#6b5c47]">{p}</p>
              ))}
            </div>
            {landing.about?.image ? (
              <img src={landing.about.image.url} alt={landing.about.image.alt || ""} loading="lazy"
                className="aspect-[4/3] w-full rounded-[1.75rem] object-cover" />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ---- Offers ----------------------------------------------------- */}
      {show.offers ? (
        <section className="py-16">
          <div className={`${WRAP} grid gap-5 sm:grid-cols-2 lg:grid-cols-3`}>
            {offers.map((o, i) => (
              <div key={o.code || o.title || i} className={`rounded-3xl border bg-white p-7 ${LINE}`}>
                <h3 className={`${SERIF} text-[20px] font-semibold`}>{o.title}</h3>
                {o.description ? <p className="mt-2 text-[13px] leading-5 text-[#7a6a55]">{o.description}</p> : null}
                {o.code ? (
                  <p className={`${CAPS} mt-4 inline-block rounded-full border border-dashed px-4 py-1.5 ${LINE}`}>{o.code}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- The patio -------------------------------------------------- */}
      {show.gallery ? (
        <section id="patio" className="pb-20">
          <div className={WRAP}>
            <span className={`${CAPS} ${WARM}`}>Sanctuary by the Sea</span>
            <h2 className={`${SERIF} mb-9 mt-3 text-[30px] font-semibold tracking-tight sm:text-[40px]`}>
              The Garden Patio
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {gallery.slice(0, 5).map((g, i) => (
                <img key={g.url + i} src={g.thumbnail || g.url} alt={g.alt || ""} loading="lazy"
                  className={`w-full rounded-3xl object-cover ${i === 0 ? "aspect-[16/10] sm:col-span-2" : "aspect-square"}`} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- Find us ---------------------------------------------------- */}
      {show.hours || show.contact ? (
        <section id="find" className={`border-t bg-white/60 py-20 ${LINE}`}>
          <div className={`${WRAP} grid gap-6 md:grid-cols-2`}>
            {show.contact ? (
              <div className={`rounded-3xl border bg-white p-8 ${LINE}`}>
                <h3 className={`${SERIF} text-[24px] font-semibold`}>{landing.titles?.contact || "Visit Us"}</h3>
                <div className="mt-4 space-y-1 text-[15px] leading-[26px] text-[#6b5c47]">
                  {addressLines(contact)?.map((line) => <p key={line}>{line}</p>)}
                </div>
                {contact.phone ? <a href={`tel:${contact.phone}`} className={`${BTN} mt-6 w-full`}>Call {contact.phone}</a> : null}
                {contact.mapUrl ? (
                  <a href={contact.mapUrl} target="_blank" rel="noreferrer noopener" className={`${GHOST} mt-3 w-full`}>Directions</a>
                ) : null}
              </div>
            ) : null}
            {show.hours ? (
              <div className={`rounded-3xl border bg-white p-8 ${LINE}`}>
                <h3 className={`${SERIF} text-[24px] font-semibold`}>Opening Hours</h3>
                <ul className={`mt-4 divide-y ${LINE} divide-[#e6ddcd]`}>
                  {hours.map((h) => (
                    <li key={h.day} className="flex justify-between gap-6 py-2.5 text-[14px]">
                      <span className="text-[#8a7860]">{DAYS[h.day]}</span>
                      <span className="font-semibold">{h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <footer className="bg-[#221c14] py-14 text-[#efe6d6]">
        <div className={`${WRAP} flex flex-col items-center justify-between gap-6 sm:flex-row`}>
          <span className={`${SERIF} text-[22px] font-semibold`}>{landing.headline}</span>
          <div className={`${CAPS} flex gap-7 text-white/50`}>
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
