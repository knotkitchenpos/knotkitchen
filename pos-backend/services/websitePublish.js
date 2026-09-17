/**
 * Manage Website publish gate. Pure helpers, no model import, so the
 * storefront resolver and tests that stub the model can both use them.
 */

/**
 * The Manage Website fields that wait for Publish System. Everything else
 * (domain, enabled, ordering rules, hours, holidays, payment gateways,
 * discounts, coupons) is operational and applies as soon as it is saved: a
 * store closing for the day cannot depend on someone remembering to publish.
 */
const PUBLISHED_FIELDS = Object.freeze([
  "displayName",
  "branding",
  "sectionTitles",
  "banners",
  "landing",
  "theme",
  "contact",
  "legal",
  "offers",
]);

/** Plain copy of the publishable fields, as stored in publishedSnapshot. */
const snapshotForPublish = (settings) => {
  const plain = typeof settings?.toObject === "function" ? settings.toObject() : { ...(settings || {}) };
  const snap = { publishedAt: new Date() };
  for (const key of PUBLISHED_FIELDS) {
    if (plain[key] !== undefined) snap[key] = JSON.parse(JSON.stringify(plain[key]));
  }
  return snap;
};

/**
 * Overlay the published copy onto a settings document, in memory, so public
 * readers see what was last published. A document with no snapshot is left
 * as it is.
 */
const applyPublishedSnapshot = (settings) => {
  const snap = settings?.publishedSnapshot;
  if (!snap || typeof snap !== "object") return settings;
  for (const key of PUBLISHED_FIELDS) {
    if (snap[key] !== undefined) settings.set(key, snap[key]);
  }
  return settings;
};

module.exports = { PUBLISHED_FIELDS, snapshotForPublish, applyPublishedSnapshot };
