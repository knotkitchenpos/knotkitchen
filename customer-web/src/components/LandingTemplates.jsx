import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/**
 * The five landing-page designs.
 *
 * Every restaurant's website opens on one of these and the menu sits one click
 * behind it, so this file is the front door for every store on the platform.
 * The template key comes from WebsiteSettings.landing.template; the keys here
 * must match LANDING_TEMPLATES in the backend model.
 *
 * ---------------------------------------------------------------------------
 * How a template differs from a theme
 * ---------------------------------------------------------------------------
 * A template is a LAYOUT and a set of typographic decisions. It is not a
 * palette: colours still come from the CSS variables useThemeVars puts on
 * <html>, so two restaurants on the same template look like two different
 * restaurants. What a template decides is the shape of the page -- how the
 * hero is composed, whether sections alternate, how corners and rules are
 * drawn, how loud the headings are.
 *
 * ---------------------------------------------------------------------------
 * Why the sections are shared
 * ---------------------------------------------------------------------------
 * The first version of this file was five heroes and nothing else, and it
 * looked like five heroes and nothing else: no story, no photographs, no sign
 * of the food. A restaurant landing page is a known form -- masthead, hero,
 * selling points, story, a look at the menu, photographs, where to find us --
 * and all five templates need all of it.
 *
 * So the sections are written once and styled by a theme token object. Five
 * copies of the opening-hours markup would be five places to fix the next time
 * the shape of the data changes, and four of them would be missed.
 *
 * ---------------------------------------------------------------------------
 * Where the content comes from
 * ---------------------------------------------------------------------------
 * Almost none of it is typed twice. The menu preview is the store's real menu,
 * the hours are its real hours, the offers are its real offers. What the
 * landing editor adds on top is the photography -- hero, story, one per
 * selling point, and a gallery -- because that is what makes a page look like
 * a particular restaurant rather than like a template.
 */

// -----------------------------------------------------------------------------
// Themes
// -----------------------------------------------------------------------------

const THEMES = {
  // Tandoor Park's register: dark, warm, a bit ceremonial. Serif display type
  // in caps, thin gold rules, square corners.
  "hero-classic": {
    hero: HeritageHero,
    page: "bg-[#12100e] text-[#f4efe7]",
    band: "bg-[#1a1714]",
    card: "bg-[#1f1b17] border border-white/10",
    radius: "rounded-none",
    heading: "font-serif uppercase tracking-[0.18em]",
    eyebrow: "text-[var(--accent,#f5a524)] uppercase tracking-[0.3em] text-xs font-semibold",
    rule: true,
    navBar: "bg-[#12100e]/95 text-[#f4efe7] border-b border-white/10",
    hairline: "border-white/10",
    muted: "text-white/60",
  },

  // Zing's register: clean and corporate-warm. White page, brand-coloured
  // accents, alternating image/text blocks, generous whitespace.
  "split-showcase": {
    hero: BrandHero,
    page: "bg-white text-[#14181f]",
    band: "bg-[#f6f4f1]",
    card: "bg-white border border-black/5 shadow-sm",
    radius: "rounded-xl",
    heading: "font-semibold tracking-tight",
    eyebrow: "text-[var(--primary,#e2571e)] uppercase tracking-[0.22em] text-xs font-bold",
    rule: false,
    navBar: "bg-white/95 text-[#14181f] border-b border-black/10",
    hairline: "border-black/10",
    muted: "text-black/55",
  },

  // Yours Truly's register: cream, unhurried, serif, soft edges. The one to
  // pick when the restaurant has atmosphere rather than a signature dish.
  "minimal-center": {
    hero: ArtisanHero,
    page: "bg-[#fbf6ee] text-[#2e2419]",
    band: "bg-[#f3e9da]",
    card: "bg-white/80 border border-[#e0d2bd]",
    radius: "rounded-3xl",
    heading: "font-serif tracking-tight",
    eyebrow: "text-[#9a7b4f] uppercase tracking-[0.28em] text-xs font-semibold",
    rule: false,
    navBar: "bg-[#fbf6ee]/95 text-[#2e2419] border-b border-[#e0d2bd]",
    hairline: "border-[#e0d2bd]",
    // The only template whose hero does not reach the top of the page.
    navOverHero: false,
    muted: "text-[#7a6a55]",
  },

  // Loud and photographic. Full-viewport hero, oversized type, dark bands.
  // Needs a good picture and rewards one.
  "photo-fullbleed": {
    hero: FullBleedHero,
    page: "bg-[#0b0b0c] text-white",
    band: "bg-[#141416]",
    card: "bg-white/5 border border-white/10 backdrop-blur",
    radius: "rounded-2xl",
    heading: "font-bold tracking-tight",
    eyebrow: "text-[var(--accent,#f5a524)] uppercase tracking-[0.3em] text-xs font-bold",
    rule: false,
    navBar: "bg-black/60 text-white border-b border-white/10 backdrop-blur",
    hairline: "border-white/10",
    muted: "text-white/60",
  },

  // Light, rounded, friendly. Cards everywhere. The safest of the five for a
  // store with mixed-quality photography.
  "card-stack": {
    hero: CardHero,
    page: "bg-[#f5f6f8] text-[#111827]",
    band: "bg-white",
    card: "bg-white shadow-sm border border-black/5",
    radius: "rounded-3xl",
    heading: "font-bold tracking-tight",
    eyebrow: "text-[var(--primary,#e2571e)] uppercase tracking-[0.2em] text-xs font-bold",
    rule: false,
    navBar: "bg-white/95 text-[#111827] border-b border-black/10",
    hairline: "border-black/10",
    muted: "text-black/55",
  },
};

export const TEMPLATE_KEYS = Object.keys(THEMES);

export default function LandingTemplate({ landing, store, menuPath }) {
  // An unknown key means the database holds a template this build does not
  // ship yet -- a rollback, or a key added backend-first. Show the default
  // rather than a blank page.
  const t = THEMES[landing?.template] || THEMES["hero-classic"];
  const Hero = t.hero;

  const symbol = store?.ordering?.currencySymbol || "₹";
  const categories = store?.categories || [];
  const offers = store?.offers || [];
  const hours = store?.openingHours || [];
  const contact = store?.contact || {};

  const show = {
    features: (landing?.features || []).length > 0,
    about: landing?.showAbout !== false && Boolean(landing?.about?.text || landing?.about?.image),
    menu: landing?.showMenuPreview !== false && categories.length > 0,
    gallery: landing?.showGallery !== false && (landing?.gallery || []).length > 0,
    offers: landing?.showOffers !== false && offers.length > 0,
    hours: landing?.showHours !== false && hours.length > 0,
    contact:
      landing?.showContact !== false &&
      Boolean(contact.phone || contact.email || contact.addressLine1),
  };

  // Only offer a jump link to a section that is actually on the page.
  const navLinks = [
    show.about ? { id: "about", label: landing.titles?.about || "About" } : null,
    show.menu ? { id: "menu", label: landing.titles?.menu || "Menu" } : null,
    show.gallery ? { id: "gallery", label: "Gallery" } : null,
    show.hours || show.contact ? { id: "visit", label: "Visit" } : null,
  ].filter(Boolean);

  return (
    <div className={`min-h-screen ${t.page}`} style={{ fontFamily: "var(--font-body, Inter), system-ui, sans-serif" }}>
      <Nav t={t} landing={landing} links={navLinks} menuPath={menuPath} />

      <Hero t={t} landing={landing} menuPath={menuPath} />

      {/* Bands alternate by position rather than per section, so whichever
          sections a store has switched on, no two of the same tone ever end up
          touching and losing the seam between them. */}
      {[
        show.features ? <Features key="f" t={t} features={landing.features} /> : null,
        show.about ? <About key="a" t={t} landing={landing} /> : null,
        show.menu ? (
          <MenuPreview key="m" t={t} landing={landing} categories={categories} symbol={symbol} menuPath={menuPath} />
        ) : null,
        show.offers ? <Offers key="o" t={t} landing={landing} offers={offers} /> : null,
        show.gallery ? <Gallery key="g" t={t} gallery={landing.gallery} /> : null,
        show.hours || show.contact ? (
          <Visit key="v" t={t} landing={landing} hours={show.hours ? hours : []} contact={show.contact ? contact : {}} />
        ) : null,
      ]
        .filter(Boolean)
        .map((node, i) => React.cloneElement(node, { tone: i % 2 === 0 ? "band" : "page" }))}

      <Footer t={t} landing={landing} contact={contact} menuPath={menuPath} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Shared pieces
// -----------------------------------------------------------------------------

const WRAP = "mx-auto w-full max-w-6xl px-5 sm:px-8";

/** The button that takes the customer to the menu -- the point of the page. */
function Cta({ menuPath, label, className = "" }) {
  return (
    <Link
      to={menuPath}
      className={`inline-flex items-center justify-center rounded-full bg-brand text-brand-fg px-8 py-3.5 text-sm font-bold uppercase tracking-wider shadow-lg transition hover:opacity-90 ${className}`}
    >
      {label || "View Menu"}
    </Link>
  );
}

function SectionHead({ t, eyebrow, title, children }) {
  return (
    <div className="mb-10 max-w-2xl">
      {eyebrow ? <p className={t.eyebrow}>{eyebrow}</p> : null}
      <h2 className={`mt-3 text-3xl sm:text-4xl ${t.heading}`}>{title}</h2>
      {t.rule ? <span className="mt-5 block h-px w-24 bg-[var(--accent,#f5a524)]" /> : null}
      {children ? <p className={`mt-4 text-base leading-relaxed ${t.muted}`}>{children}</p> : null}
    </div>
  );
}

function Section({ t, id, tone = "page", children }) {
  return (
    <section id={id} className={`${tone === "band" ? t.band : ""} py-16 sm:py-24`}>
      <div className={WRAP}>{children}</div>
    </section>
  );
}

/**
 * The photograph behind a hero, plus its darkening scrim.
 *
 * `overlayOpacity` is chosen per store because the right amount depends
 * entirely on the picture: a bright plate on a white tablecloth needs a heavy
 * scrim for white text to be readable, a dim interior shot needs almost none.
 */
function Backdrop({ url, opacity, fallback = "bg-[var(--secondary,#0d1526)]" }) {
  return (
    <>
      {url ? (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${url})` }}
          aria-hidden="true"
        />
      ) : (
        <div className={`absolute inset-0 ${fallback}`} aria-hidden="true" />
      )}
      <div
        className="absolute inset-0 bg-black"
        style={{ opacity: (Number(opacity) || 0) / 100 }}
        aria-hidden="true"
      />
    </>
  );
}

function Nav({ t, landing, links, menuPath }) {
  const [open, setOpen] = useState(false);
  const [solid, setSolid] = useState(false);

  // The masthead sits over the hero photograph until the page scrolls, then
  // takes its own background. Transparent-over-photo is what all three of the
  // sites this is modelled on do, and it is what keeps the hero full height.
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors ${
        solid || open || t.navOverHero === false
          ? t.navBar
          : "bg-transparent text-white border-b border-transparent"
      }`}
    >
      <div className={`${WRAP} flex h-16 items-center justify-between gap-4`}>
        <a href="#top" className="flex min-w-0 items-center gap-3">
          {landing.logo ? (
            <img src={landing.logo} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : null}
          <span className={`truncate text-sm font-bold uppercase tracking-[0.18em]`}>
            {landing.headline}
          </span>
        </a>

        <nav className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <a key={l.id} href={`#${l.id}`} className="text-xs font-semibold uppercase tracking-[0.16em] hover:opacity-70">
              {l.label}
            </a>
          ))}
          <Cta menuPath={menuPath} label={landing.ctaText} className="!px-6 !py-2.5 !text-xs !shadow-none" />
        </nav>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu"
          aria-expanded={open}
          className="md:hidden rounded-lg border border-current px-3 py-1.5 text-xs font-bold uppercase tracking-wider"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {open ? (
        <div className={`md:hidden ${t.navBar} border-t ${t.hairline}`}>
          <div className={`${WRAP} flex flex-col gap-1 py-4`}>
            {links.map((l) => (
              <a
                key={l.id}
                href={`#${l.id}`}
                onClick={() => setOpen(false)}
                className="py-2 text-sm font-semibold uppercase tracking-[0.16em]"
              >
                {l.label}
              </a>
            ))}
            <Cta menuPath={menuPath} label={landing.ctaText} className="mt-3 w-full" />
          </div>
        </div>
      ) : null}
    </header>
  );
}

function Features({ t, features, tone }) {
  return (
    <Section t={t} tone={tone}>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f, i) => (
          <div key={f.title || i} className={`${t.card} ${t.radius} overflow-hidden`}>
            {f.image ? (
              <img
                src={f.image.thumbnail || f.image.url}
                alt={f.image.alt || ""}
                loading="lazy"
                className="h-44 w-full object-cover"
              />
            ) : null}
            <div className="p-6">
              <h3 className={`text-lg ${t.heading}`}>{f.title}</h3>
              {f.text ? <p className={`mt-2 text-sm leading-relaxed ${t.muted}`}>{f.text}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function About({ t, landing, tone }) {
  const image = landing.about?.image;
  return (
    <Section t={t} id="about" tone={tone}>
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        {image ? (
          <img
            src={image.url}
            alt={image.alt || ""}
            loading="lazy"
            className={`${t.radius} h-[22rem] w-full object-cover lg:h-[28rem]`}
          />
        ) : null}
        <div className={image ? "" : "max-w-3xl"}>
          <SectionHead t={t} eyebrow="Our story" title={landing.titles?.about || "About Us"} />
          {/* Operator-typed prose. Paragraphs are split on blank lines rather
              than rendered as HTML -- nothing typed into the POS reaches this
              page as markup. */}
          {String(landing.about?.text || "")
            .split(/\n{2,}/)
            .filter(Boolean)
            .map((para, i) => (
              <p key={i} className={`mb-4 text-base leading-relaxed ${t.muted}`}>
                {para}
              </p>
            ))}
        </div>
      </div>
    </Section>
  );
}

/**
 * A look at the real menu.
 *
 * Deliberately a taste and not the whole thing: a few categories, a few dishes
 * each, then through to the ordering page. A landing page that printed the
 * entire catalogue would be the ordering page, only slower and with no basket.
 */
function MenuPreview({ t, landing, categories, symbol, menuPath, tone }) {
  const [active, setActive] = useState(0);
  const shown = categories.slice(0, 8);
  const category = shown[Math.min(active, shown.length - 1)] || shown[0];
  const items = (category?.products || []).slice(0, 6);

  return (
    <Section t={t} id="menu" tone={tone}>
      <SectionHead t={t} eyebrow="From the kitchen" title={landing.titles?.menu || "Our Menu"} />

      {shown.length > 1 ? (
        <div className="mb-8 flex flex-wrap gap-2">
          {shown.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActive(i)}
              className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider transition ${
                i === active ? "bg-brand text-brand-fg" : `${t.card} ${t.muted}`
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => (
          <Link key={p.id} to={menuPath} className={`${t.card} ${t.radius} overflow-hidden transition hover:opacity-95`}>
            {p.image ? (
              <img
                src={p.thumbnail || p.image}
                alt={p.imageAlt || p.name}
                loading="lazy"
                className="h-48 w-full object-cover"
              />
            ) : null}
            <div className="p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-base font-semibold">{p.name}</h3>
                <span className="shrink-0 text-base font-bold">
                  {symbol}
                  {p.price}
                </span>
              </div>
              {p.description ? (
                <p className={`mt-2 line-clamp-2 text-sm leading-relaxed ${t.muted}`}>{p.description}</p>
              ) : null}
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-10">
        <Cta menuPath={menuPath} label={landing.ctaText} />
      </div>
    </Section>
  );
}

function Offers({ t, landing, offers, tone }) {
  return (
    <Section t={t} tone={tone}>
      <SectionHead t={t} eyebrow="On now" title={landing.titles?.offers || "Special Offers"} />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {offers.map((o, i) => (
          <div key={o.code || o.title || i} className={`${t.card} ${t.radius} overflow-hidden`}>
            {o.image ? (
              <img src={o.image} alt="" loading="lazy" className="h-40 w-full object-cover" />
            ) : null}
            <div className="p-6">
              <h3 className={`text-lg ${t.heading}`}>{o.title}</h3>
              {o.description ? <p className={`mt-2 text-sm ${t.muted}`}>{o.description}</p> : null}
              {o.code ? (
                <p className="mt-4 inline-block rounded-lg border border-dashed border-current px-3 py-1 font-mono text-xs">
                  {o.code}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Gallery({ t, gallery, tone }) {
  return (
    <Section t={t} id="gallery" tone={tone}>
      <SectionHead t={t} eyebrow="Look inside" title="Gallery" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {gallery.map((g, i) => (
          <img
            key={g.url || i}
            src={g.thumbnail || g.url}
            alt={g.alt || ""}
            loading="lazy"
            className={`${t.radius} aspect-square w-full object-cover`}
          />
        ))}
      </div>
    </Section>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function Visit({ t, landing, hours, contact, tone }) {
  return (
    <Section t={t} id="visit" tone={tone}>
      <SectionHead t={t} eyebrow="Find us" title={landing.titles?.contact || "Visit Us"} />
      <div className="grid gap-10 sm:grid-cols-2 lg:gap-16">
        {contact.phone || contact.email || contact.addressLine1 ? (
          <div className="space-y-4 text-base">
            {contact.addressLine1 ? (
              <p className="leading-relaxed">
                {contact.addressLine1}
                {contact.addressLine2 ? <><br />{contact.addressLine2}</> : null}
                {contact.city ? <><br />{contact.city}{contact.postalCode ? ` ${contact.postalCode}` : ""}</> : null}
              </p>
            ) : null}
            {contact.phone ? (
              <p>
                <a href={`tel:${contact.phone}`} className="font-semibold underline underline-offset-4">
                  {contact.phone}
                </a>
              </p>
            ) : null}
            {contact.email ? (
              <p>
                <a href={`mailto:${contact.email}`} className="underline underline-offset-4">
                  {contact.email}
                </a>
              </p>
            ) : null}
            {contact.mapUrl ? (
              <p>
                <a
                  href={contact.mapUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm font-bold uppercase tracking-wider underline underline-offset-4"
                >
                  Open in maps
                </a>
              </p>
            ) : null}
          </div>
        ) : null}

        {hours.length ? (
          <div>
            <h3 className={`mb-4 text-lg ${t.heading}`}>Opening hours</h3>
            <ul className="space-y-2 text-sm">
              {hours.map((h) => (
                <li key={h.day} className={`flex justify-between gap-6 border-b ${t.hairline} pb-2`}>
                  <span className={t.muted}>{DAYS[h.day]}</span>
                  <span className="font-semibold">
                    {h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

function Footer({ t, landing, contact, menuPath }) {
  const social = contact?.social || {};
  const links = [
    social.instagram ? { href: social.instagram, label: "Instagram" } : null,
    social.facebook ? { href: social.facebook, label: "Facebook" } : null,
    social.twitter ? { href: social.twitter, label: "Twitter" } : null,
  ].filter(Boolean);

  return (
    <footer className={`${t.band} border-t ${t.hairline} py-14`}>
      <div className={`${WRAP} flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between`}>
        <div className="flex items-center gap-4">
          {landing.logo ? (
            <img src={landing.logo} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : null}
          <div>
            <p className={`text-lg ${t.heading}`}>{landing.headline}</p>
            {landing.subheadline ? (
              <p className={`mt-1 text-sm ${t.muted}`}>{landing.subheadline}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col items-start gap-4 sm:items-end">
          <Cta menuPath={menuPath} label={landing.ctaText} />
          {links.length ? (
            <div className="flex gap-5 text-xs font-semibold uppercase tracking-wider">
              {links.map((l) => (
                <a key={l.label} href={l.href} target="_blank" rel="noreferrer noopener" className="hover:opacity-70">
                  {l.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

// -----------------------------------------------------------------------------
// The five heroes
// -----------------------------------------------------------------------------

/** Heritage: the logo carried large and centred over a dark photograph. */
function HeritageHero({ t, landing, menuPath }) {
  return (
    <section id="top" className="relative flex min-h-[92vh] items-center justify-center text-center text-white">
      <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} fallback="bg-[#12100e]" />
      <div className={`${WRAP} relative py-32`}>
        {landing.logo ? (
          <img
            src={landing.logo}
            alt=""
            className="mx-auto mb-8 h-28 w-28 rounded-full border-4 border-white/20 object-cover shadow-2xl"
          />
        ) : null}
        <span className="mx-auto mb-6 block h-px w-16 bg-[var(--accent,#f5a524)]" />
        <h1 className={`text-4xl leading-tight sm:text-6xl ${t.heading}`}>{landing.headline}</h1>
        {landing.subheadline ? (
          <p className="mx-auto mt-6 max-w-xl text-base text-white/75 sm:text-lg">{landing.subheadline}</p>
        ) : null}
        <div className="mt-10">
          <Cta menuPath={menuPath} label={landing.ctaText} className="!px-10 !py-4" />
        </div>
      </div>
    </section>
  );
}

/** Brand: a wide photograph with the words held to the left, magazine-style. */
function BrandHero({ t, landing, menuPath }) {
  return (
    <section id="top" className="relative flex min-h-[88vh] items-end text-white">
      <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} />
      <div className={`${WRAP} relative pb-20 pt-36`}>
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-white/70">Welcome</p>
          <h1 className={`mt-5 text-4xl leading-[1.05] sm:text-6xl ${t.heading}`}>{landing.headline}</h1>
          {landing.subheadline ? (
            <p className="mt-6 max-w-xl text-lg text-white/80">{landing.subheadline}</p>
          ) : null}
          <div className="mt-9">
            <Cta menuPath={menuPath} label={landing.ctaText} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Artisan: cream, serif, centred, with the photograph framed rather than
 *  bled. Reads calm where the others read loud. */
function ArtisanHero({ t, landing, menuPath }) {
  return (
    <section id="top" className="px-5 pb-8 pt-24 sm:px-8">
      <div className="relative mx-auto flex min-h-[70vh] max-w-7xl items-center justify-center overflow-hidden rounded-3xl text-center text-white">
        <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} fallback="bg-[#8a6a45]" />
        <div className="relative px-6 py-24">
          {landing.logo ? (
            <img src={landing.logo} alt="" className="mx-auto mb-7 h-20 w-20 rounded-full object-cover" />
          ) : null}
          <h1 className={`text-4xl leading-tight sm:text-5xl ${t.heading}`}>{landing.headline}</h1>
          {landing.subheadline ? (
            <p className="mx-auto mt-5 max-w-lg text-base text-white/85">{landing.subheadline}</p>
          ) : null}
          <div className="mt-9">
            <Cta menuPath={menuPath} label={landing.ctaText} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Full bleed: one photograph, the whole screen, the largest type of the five. */
function FullBleedHero({ t, landing, menuPath }) {
  return (
    <section id="top" className="relative flex min-h-screen items-center justify-center text-center text-white">
      <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} fallback="bg-[#0b0b0c]" />
      <div className={`${WRAP} relative py-32`}>
        {landing.logo ? (
          <img src={landing.logo} alt="" className="mx-auto mb-10 h-24 w-24 rounded-full object-cover" />
        ) : null}
        <h1 className={`text-5xl leading-[0.95] sm:text-7xl lg:text-8xl ${t.heading}`}>{landing.headline}</h1>
        {landing.subheadline ? (
          <p className="mx-auto mt-8 max-w-2xl text-lg text-white/75">{landing.subheadline}</p>
        ) : null}
        <div className="mt-12">
          <Cta menuPath={menuPath} label={landing.ctaText} className="!px-12 !py-5 !text-base" />
        </div>
      </div>
    </section>
  );
}

/** Card: a solid panel floating over the photograph, so the words stay legible
 *  no matter how busy the picture behind them is. */
function CardHero({ t, landing, menuPath }) {
  return (
    <section id="top" className="relative flex min-h-[85vh] items-center justify-center px-5 py-28 sm:px-8">
      <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} />
      <div className={`relative w-full max-w-xl ${t.card} ${t.radius} p-9 text-center sm:p-12`}>
        {landing.logo ? (
          <img
            src={landing.logo}
            alt=""
            className="mx-auto -mt-20 mb-7 h-24 w-24 rounded-full border-4 border-white object-cover shadow-lg"
          />
        ) : null}
        <h1 className={`text-3xl sm:text-4xl ${t.heading}`}>{landing.headline}</h1>
        {landing.subheadline ? (
          <p className={`mt-4 text-base ${t.muted}`}>{landing.subheadline}</p>
        ) : null}
        <div className="mt-8">
          <Cta menuPath={menuPath} label={landing.ctaText} className="w-full" />
        </div>
      </div>
    </section>
  );
}
