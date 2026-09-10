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
const buildLandingPayload = (settings = {}, restaurant = null, store = null) => {
  const landing = settings.landing || {};
  const branding = settings.branding || {};
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
    showHours: landing.showHours !== false,
    showContact: landing.showContact !== false,
    showOffers: landing.showOffers !== false,
  };
};

module.exports = { buildLandingPayload };
