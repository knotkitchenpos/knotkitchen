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
    template: landing.template || "hero-classic",
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

    showAbout: landing.showAbout !== false,
    showMenuPreview: landing.showMenuPreview !== false,
    showGallery: landing.showGallery !== false,
    showHours: landing.showHours !== false,
    showContact: landing.showContact !== false,
    showOffers: landing.showOffers !== false,
  };
};

module.exports = { buildLandingPayload };
