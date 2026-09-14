/**
 * Build the public landing-page payload for a store.
 *
 * The landing page is the first thing a customer sees, so it is rendered from
 * the bootstrap response (fast, small) and again from the full storefront
 * response (which arrives moments later). Both have to describe the same page
 * or it would visibly re-flow, which is why the fallback chain lives here
 * instead of being written out twice.
 *
 * The fallbacks matter as much as the fields: a restaurant that has never
 * opened the landing editor has an empty `landing` sub-document, and still has
 * to get a real landing page out of the branding it already filled in.
 */

const { LANDING_TEMPLATES, LEGACY_LANDING_TEMPLATES } = require("../models/websiteSettingsModel");

/**
 * The template this store should render, translated if it is an old key.
 *
 * The first five templates were replaced wholesale. A store that had chosen
 * one holds a key the browser no longer ships, and an unknown key falls back
 * to the default -- so every one of them would silently lose the design they
 * picked. Map instead.
 */
const templateOf = (stored) => {
  const key = String(stored || "").trim();
  if (LANDING_TEMPLATES.includes(key)) return key;
  return LEGACY_LANDING_TEMPLATES[key] || LANDING_TEMPLATES[0];
};

const img = (ref) =>
  ref && ref.url
    ? { url: ref.url, thumbnail: ref.thumbnailUrl || ref.url, alt: ref.alt || "" }
    : null;

const buildLandingPayload = (settings = {}, restaurant = null, store = null) => {
  const landing = settings.landing || {};
  const branding = settings.branding || {};
  const titles = settings.sectionTitles || {};
  const name = settings.displayName || store?.storeName || restaurant?.name || "";

  return {
    /**
     * Which edit of the settings this design came from.
     *
     * The browser fetches the landing page twice -- once in the small
     * bootstrap response, once in the full storefront response -- and the two
     * are cached independently. When an owner changes the template, one of
     * those can come back fresh and the other from cache, and whichever
     * arrived second used to win. That is what made a template appear to
     * switch and then switch back, or never switch at all.
     *
     * Carrying the version lets the browser keep the newer of the two rather
     * than the later of the two.
     */
    version: Number(settings.version) || 0,
    template: templateOf(landing.template),
    headline: landing.headline || branding.siteTitle || name,
    subheadline: landing.subheadline || branding.tagline || "",
    ctaText: landing.ctaText || "View Menu",
    backgroundImage: landing.backgroundImage?.url || branding.coverImage?.url || "",
    backgroundAlt: landing.backgroundImage?.alt || branding.coverImage?.alt || "",
    logo: branding.logo?.url || "",
    // 0 is a legitimate choice (no scrim at all), so a plain `||` would quietly
    // turn it back into the default.
    overlayOpacity: Number.isFinite(landing.overlayOpacity) ? landing.overlayOpacity : 45,

    // Section headings come from sectionTitles, which the storefront already
    // owns, rather than a second copy of the same strings on the landing page.
    titles: {
      menu: titles.menuTitle || "Our Menu",
      about: titles.aboutTitle || "About Us",
      offers: titles.offersTitle || "Special Offers",
      contact: titles.contactTitle || "Contact Us",
    },

    about: {
      text: landing.aboutText || branding.aboutText || "",
      image: img(landing.aboutImage) || img(branding.coverImage),
    },

    features: (landing.features || [])
      .filter((f) => f && (f.title || f.text))
      .slice(0, 3)
      .map((f) => ({ title: f.title || "", text: f.text || "", image: img(f.image) })),

    gallery: (landing.gallery || []).map(img).filter(Boolean).slice(0, 12),

    // Ids, not dishes. The browser already holds the whole menu in the
    // storefront payload, so resolving them here would ship each dish twice
    // and give the two copies a way to disagree.
    featuredItems: (landing.featuredItems || []).map(String).slice(0, 3),

    // The restaurant's own name and public contact details, so the landing
    // design can print them from the small bootstrap response.
    name,
    contact: {
      phone: settings.contact?.phone || "",
      email: settings.contact?.email || "",
      addressLine1: settings.contact?.addressLine1 || "",
      addressLine2: settings.contact?.addressLine2 || "",
      city: settings.contact?.city || "",
      postalCode: settings.contact?.postalCode || "",
    },

    // The design's words; empty values fall back to the design's defaults.
    copy: {
      ...(landing.copy?.toObject ? landing.copy.toObject() : landing.copy || {}),
      lead: landing.copy?.lead || landing.subheadline || "",
      headline: landing.copy?.headline || "",
    },

    showAbout: landing.showAbout !== false,
    showMenuPreview: landing.showMenuPreview !== false,
    showGallery: landing.showGallery !== false,
    showHours: landing.showHours !== false,
    showContact: landing.showContact !== false,
    showOffers: landing.showOffers !== false,
  };
};

module.exports = { buildLandingPayload };
