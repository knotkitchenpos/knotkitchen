import React from "react";
import { Link } from "react-router-dom";

/**
 * The five landing-page layouts.
 *
 * Every restaurant's website opens on one of these and the menu sits one click
 * behind it, so this file is the front door for every store on the platform.
 * The template key comes from WebsiteSettings.landing.template (CSD picks it);
 * the keys here must match LANDING_TEMPLATES in the backend model.
 *
 * What varies between templates is the HERO only. The blocks underneath —
 * hours, contact, offers — are shared, because a restaurant that turns hours on
 * expects the same hours whichever template it picked, and five copies of that
 * markup would be five places to fix the next time the shape changes.
 *
 * Colours come from the CSS variables useThemeVars puts on <html>, so a
 * template is a layout, never a palette.
 */

const TEMPLATES = {
  "hero-classic": HeroClassic,
  "split-showcase": SplitShowcase,
  "minimal-center": MinimalCenter,
  "photo-fullbleed": PhotoFullbleed,
  "card-stack": CardStack,
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

export default function LandingTemplate({ landing, store, menuPath }) {
  // An unknown key means the database has a template this build doesn't ship
  // yet (a rollback, or a key added backend-first). Show the default rather
  // than a blank page.
  const Hero = TEMPLATES[landing?.template] || HeroClassic;

  return (
    <div className="min-h-screen bg-[var(--background,#fff)] text-[var(--text,#12161f)]">
      <Hero landing={landing} menuPath={menuPath} />
      <Details landing={landing} store={store} menuPath={menuPath} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Shared pieces
// -----------------------------------------------------------------------------

/** The button that takes the customer to the menu — the point of the page. */
function Cta({ menuPath, label, className = "" }) {
  return (
    <Link
      to={menuPath}
      className={`inline-flex items-center justify-center rounded-full bg-brand text-brand-fg px-8 py-3.5 text-base font-semibold shadow-lg transition hover:opacity-90 ${className}`}
    >
      {label || "View Menu"}
    </Link>
  );
}

function Logo({ src, className = "" }) {
  if (!src) return null;
  return <img src={src} alt="" className={`rounded-full object-cover shadow-lg ${className}`} />;
}

/**
 * The photo behind a hero, plus its darkening scrim.
 *
 * `overlayOpacity` is a percentage chosen per store because the right amount
 * depends entirely on the photo: a bright plate on a white tablecloth needs a
 * heavy scrim for white text to be readable, a dim interior shot needs almost
 * none.
 */
function Backdrop({ url, opacity }) {
  return (
    <>
      {url ? (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${url})` }}
          aria-hidden="true"
        />
      ) : (
        <div className="absolute inset-0 bg-[var(--secondary,#0d1526)]" aria-hidden="true" />
      )}
      <div
        className="absolute inset-0 bg-black"
        style={{ opacity: (Number(opacity) || 0) / 100 }}
        aria-hidden="true"
      />
    </>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Everything below the hero: what's on, when they're open, how to reach them.
 * Each block is off unless the store has both switched it on and has something
 * to put in it — an empty "Contact" heading is worse than no heading.
 */
function Details({ landing, store, menuPath }) {
  const contact = store?.contact || {};
  const hours = store?.openingHours || [];
  const offers = store?.offers || [];

  const showOffers = landing?.showOffers !== false && offers.length > 0;
  const showHours = landing?.showHours !== false && hours.length > 0;
  const showContact =
    landing?.showContact !== false &&
    Boolean(contact.phone || contact.email || contact.addressLine1);

  if (!showOffers && !showHours && !showContact) {
    // Nothing to show under the hero, so the page ends on the call to action
    // instead of on empty space.
    return null;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 sm:py-16">
      {showOffers ? (
        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4">Today&apos;s offers</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {offers.map((offer, i) => (
              <div
                key={offer.code || offer.title || i}
                className="rounded-2xl border border-black/10 bg-[var(--surface,#f7f8fa)] p-5"
              >
                <h3 className="font-semibold">{offer.title}</h3>
                {offer.description ? (
                  <p className="mt-1 text-sm text-[var(--muted,#6b7280)]">{offer.description}</p>
                ) : null}
                {offer.code ? (
                  <p className="mt-3 inline-block rounded-lg border border-dashed border-current px-3 py-1 text-xs font-mono">
                    {offer.code}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-10 sm:grid-cols-2">
        {showHours ? (
          <section>
            <h2 className="text-xl font-semibold mb-4">Opening hours</h2>
            <ul className="space-y-1 text-sm">
              {hours.map((h) => (
                <li key={h.day} className="flex justify-between max-w-xs">
                  <span className="text-[var(--muted,#6b7280)]">{DAYS[h.day]}</span>
                  <span>{h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {showContact ? (
          <section>
            <h2 className="text-xl font-semibold mb-4">Find us</h2>
            <div className="space-y-1 text-sm">
              {contact.addressLine1 ? (
                <p>
                  {contact.addressLine1}
                  {contact.addressLine2 ? `, ${contact.addressLine2}` : ""}
                  {contact.city ? `, ${contact.city}` : ""}
                  {contact.postalCode ? ` ${contact.postalCode}` : ""}
                </p>
              ) : null}
              {contact.phone ? (
                <p>
                  <a href={`tel:${contact.phone}`} className="underline underline-offset-2">
                    {contact.phone}
                  </a>
                </p>
              ) : null}
              {contact.email ? (
                <p>
                  <a href={`mailto:${contact.email}`} className="underline underline-offset-2">
                    {contact.email}
                  </a>
                </p>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      {/* A customer who read all the way down here should not have to scroll
          back up to order. */}
      <div className="mt-12 text-center">
        <Cta menuPath={menuPath} label={landing?.ctaText} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// The five heroes
// -----------------------------------------------------------------------------

/** Wide photo band, text over the bottom-left. The safe default. */
function HeroClassic({ landing, menuPath }) {
  return (
    <section className="relative min-h-[70vh] flex items-end">
      <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} />
      <div className="relative w-full max-w-5xl mx-auto px-4 pb-14 pt-24 text-white">
        <Logo src={landing.logo} className="h-16 w-16 mb-5" />
        <h1 className="font-[var(--font-heading,Poppins)] text-4xl sm:text-5xl font-bold max-w-2xl">
          {landing.headline}
        </h1>
        {landing.subheadline ? (
          <p className="mt-4 max-w-xl text-lg text-white/85">{landing.subheadline}</p>
        ) : null}
        <div className="mt-8">
          <Cta menuPath={menuPath} label={landing.ctaText} />
        </div>
      </div>
    </section>
  );
}

/** Text on one side, photo on the other. Reads as a magazine spread. */
function SplitShowcase({ landing, menuPath }) {
  return (
    <section className="grid md:grid-cols-2 min-h-[70vh]">
      <div className="flex items-center px-6 py-16 sm:px-12 bg-[var(--surface,#f7f8fa)]">
        <div>
          <Logo src={landing.logo} className="h-14 w-14 mb-6" />
          <h1 className="font-[var(--font-heading,Poppins)] text-4xl sm:text-5xl font-bold">
            {landing.headline}
          </h1>
          {landing.subheadline ? (
            <p className="mt-4 text-lg text-[var(--muted,#6b7280)]">{landing.subheadline}</p>
          ) : null}
          <div className="mt-8">
            <Cta menuPath={menuPath} label={landing.ctaText} />
          </div>
        </div>
      </div>
      {/* The photo column is decorative — on a phone the columns stack and a
          half-height image between the text and the button just pushes the
          call to action off screen, so it is dropped below md. */}
      <div className="relative hidden md:block">
        <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} />
      </div>
    </section>
  );
}

/** No photograph at all — brand colour, centred type. For stores with no good
 *  food photography, which is most of them on day one. */
function MinimalCenter({ landing, menuPath }) {
  return (
    <section className="min-h-[70vh] flex items-center justify-center bg-[var(--surface,#f7f8fa)] px-6 py-20">
      <div className="text-center max-w-xl">
        <Logo src={landing.logo} className="h-20 w-20 mx-auto mb-8" />
        <h1 className="font-[var(--font-heading,Poppins)] text-4xl sm:text-5xl font-bold">
          {landing.headline}
        </h1>
        {landing.subheadline ? (
          <p className="mt-5 text-lg text-[var(--muted,#6b7280)]">{landing.subheadline}</p>
        ) : null}
        <div className="mt-10">
          <Cta menuPath={menuPath} label={landing.ctaText} />
        </div>
      </div>
    </section>
  );
}

/** Full screen photo, centred text. The most dramatic of the five. */
function PhotoFullbleed({ landing, menuPath }) {
  return (
    <section className="relative min-h-screen flex items-center justify-center text-center">
      <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} />
      <div className="relative px-6 py-20 text-white max-w-2xl">
        <Logo src={landing.logo} className="h-20 w-20 mx-auto mb-8" />
        <h1 className="font-[var(--font-heading,Poppins)] text-5xl sm:text-6xl font-bold leading-tight">
          {landing.headline}
        </h1>
        {landing.subheadline ? (
          <p className="mt-5 text-lg text-white/85">{landing.subheadline}</p>
        ) : null}
        <div className="mt-10">
          <Cta menuPath={menuPath} label={landing.ctaText} className="px-10 py-4 text-lg" />
        </div>
      </div>
    </section>
  );
}

/** Photo backdrop with a solid card floating over it. Keeps the type readable
 *  on a busy photo without drowning the photo in a scrim. */
function CardStack({ landing, menuPath }) {
  return (
    <section className="relative min-h-[80vh] flex items-center justify-center px-4 py-20">
      <Backdrop url={landing.backgroundImage} opacity={landing.overlayOpacity} />
      <div className="relative w-full max-w-lg rounded-3xl bg-[var(--background,#fff)] p-8 sm:p-10 text-center shadow-2xl">
        <Logo src={landing.logo} className="h-16 w-16 mx-auto -mt-20 mb-6 border-4 border-[var(--background,#fff)]" />
        <h1 className="font-[var(--font-heading,Poppins)] text-3xl sm:text-4xl font-bold">
          {landing.headline}
        </h1>
        {landing.subheadline ? (
          <p className="mt-4 text-[var(--muted,#6b7280)]">{landing.subheadline}</p>
        ) : null}
        <div className="mt-8">
          <Cta menuPath={menuPath} label={landing.ctaText} className="w-full" />
        </div>
      </div>
    </section>
  );
}
