/**
 * The restaurant's own details as the public website prints them.
 *
 * Two sources feed the website: what the owner typed into Manage Website >
 * Contact, and what the POS already knows about the restaurant (Store
 * Properties: address, phones, email, map pin, FSSAI, GST). The website used
 * to read only the first, so a store that never filled in the Contact tab had
 * a "Find us" block with nothing in it. Now a blank Contact field falls back
 * to the POS, field by field, and the legal pages read the same merged view.
 */

const clean = (v) => String(v ?? "").trim();

/** A Google Maps link for an address, when the restaurant has not given one. */
const mapsSearchUrl = (parts) => {
  const q = parts.map(clean).filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : "";
};

/**
 * Contact details with POS fallbacks. `settings.contact` wins where it is
 * filled in; otherwise the restaurant record supplies the value.
 */
const mergedContact = (settings = {}, restaurant = null) => {
  const c = settings.contact || {};
  const a = restaurant?.address || {};
  const addressLine1 = clean(c.addressLine1) || clean(a.line1);
  const addressLine2 = clean(c.addressLine2) || clean(a.line2);
  const city = clean(c.city) || [clean(a.city), clean(a.state)].filter(Boolean).join(", ");
  const postalCode = clean(c.postalCode) || clean(a.postalCode);
  return {
    phone: clean(c.phone) || clean(restaurant?.restaurantPhone) || clean(restaurant?.ownerPhone),
    email: clean(c.email) || clean(restaurant?.ownerEmail),
    addressLine1,
    addressLine2,
    city,
    postalCode,
    mapUrl:
      clean(c.mapUrl) ||
      clean(restaurant?.mapsLink) ||
      clean(restaurant?.googleBusinessUrl) ||
      mapsSearchUrl([restaurant?.name, addressLine1, addressLine2, city, postalCode]),
    social: {
      facebook: clean(c.social?.facebook),
      instagram: clean(c.social?.instagram),
      twitter: clean(c.social?.twitter),
    },
  };
};

/** Manage Website > Legal, with the defaults the policy text was written for. */
const LEGAL_DEFAULTS = Object.freeze({
  refundWindowHours: 24,
  refundAckHours: 24,
  refundDecisionDays: 3,
  refundProcessingDays: 7,
  returnWindowDays: 7,
  grievanceHours: "10 AM – 8 PM, all days",
});

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
};

/**
 * Everything the five legal pages substitute into the policy text. Restaurant
 * identity comes from the POS; the operator-set windows and the grievance
 * officer come from Manage Website > Legal, with the contact block as the
 * fallback for the officer's phone and email.
 */
const buildLegalPayload = (settings = {}, restaurant = null, { websiteUrl = "" } = {}) => {
  const legal = settings.legal || {};
  const contact = mergedContact(settings, restaurant);
  const name = clean(settings.displayName) || clean(restaurant?.name);
  const addressText = [contact.addressLine1, contact.addressLine2, contact.city, contact.postalCode]
    .filter(Boolean)
    .join(", ");
  return {
    restaurantName: name,
    legalName: clean(restaurant?.legalName) || name,
    websiteUrl,
    address: addressText,
    fssaiNumber: clean(restaurant?.fssaiNumber),
    gstin: restaurant?.gstRegistered ? clean(restaurant?.taxId) : "",
    phone: contact.phone,
    email: contact.email,
    jurisdictionCity: clean(legal.jurisdictionCity) || clean(restaurant?.address?.city) || "Kolkata",
    jurisdictionState: clean(restaurant?.address?.state) || "West Bengal",
    refundWindowHours: num(legal.refundWindowHours, LEGAL_DEFAULTS.refundWindowHours),
    refundAckHours: num(legal.refundAckHours, LEGAL_DEFAULTS.refundAckHours),
    refundDecisionDays: num(legal.refundDecisionDays, LEGAL_DEFAULTS.refundDecisionDays),
    refundProcessingDays: num(legal.refundProcessingDays, LEGAL_DEFAULTS.refundProcessingDays),
    returnWindowDays: num(legal.returnWindowDays, LEGAL_DEFAULTS.returnWindowDays),
    grievance: {
      name: clean(legal.grievanceName) || clean(restaurant?.ownerName),
      email: clean(legal.grievanceEmail) || contact.email,
      phone: clean(legal.grievancePhone) || contact.phone,
      hours: clean(legal.grievanceHours) || LEGAL_DEFAULTS.grievanceHours,
    },
    // Shown on the legal pages only when KnotKitchen has set one.
    knotkitchenSupportEmail: clean(process.env.KK_SUPPORT_EMAIL),
    // "Last updated": the legal settings' own save, else the site's last publish.
    updatedAt: legal.updatedAt || settings.publishedAt || settings.updatedAt || null,
  };
};

module.exports = { mergedContact, mapsSearchUrl, buildLegalPayload, LEGAL_DEFAULTS };
