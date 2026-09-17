/**
 * Is GST chargeable on this order, and at what rate?
 *
 * GST used to be a constant: services/price carried `TAX_RATE = 0.05` and
 * applied it to every table, QR and POS bill regardless of whether the store
 * was GST registered at all. Every store in production has an empty GST number
 * and `gstRegistered: false`, and was still being charged 5%.
 *
 * A store is chargeable only when BOTH are true:
 *
 *   - it has a GST number on Store Properties. This is the switch: a business
 *     that is not registered has no number to give, and clearing the field is
 *     how you turn GST off.
 *   - a rate above zero is set under Rules & Charges. A registered business
 *     with no rate configured yet is not chargeable either -- guessing a rate
 *     on its behalf is how the 5% got there in the first place.
 *
 * `gstApplyTo` narrows it further to one channel where the operator wants
 * that, and is left alone here.
 */

/** Normalised GST number, or "" when the store has none. */
const gstinOf = (restaurant) => String(restaurant?.taxId || "").trim().toUpperCase();

/** 15-character GSTIN: 2-digit state, 10-char PAN, entity code, "Z", check digit. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const isValidGstin = (value) => GSTIN_RE.test(String(value || "").trim().toUpperCase());

/** SAC for restaurant service; printed on a B2B bill so the buyer can claim credit. */
const RESTAURANT_SAC = "996331";

/**
 * The buyer named on a B2B bill: { company, gstin } or null. Throws with a
 * readable message on a malformed GSTIN so a typo is caught at the till,
 * not by the buyer's accountant.
 */
const buyerFrom = (input = {}) => {
  const company = String(input?.company || input?.buyerCompany || "").trim().slice(0, 160);
  const gstin = String(input?.gstin || input?.buyerGstin || "").trim().toUpperCase();
  if (!company && !gstin) return null;
  if (gstin && !isValidGstin(gstin)) {
    const err = new Error("That GSTIN does not look right (15 characters, e.g. 19ABCDE1234F1Z5).");
    err.status = 400;
    throw err;
  }
  return { company, gstin };
};

/**
 * @param {object} args
 * @param {object} args.restaurant  the store (for its GST number)
 * @param {object} args.ordering    ordering settings (for taxPercent / gstApplyTo / taxInclusive)
 * @param {string} args.environment "system" | "website" — which channel this order is on
 * @returns {{applicable:boolean, percent:number, rate:number, gstin:string, inclusive:boolean, reason:string}}
 */
const resolveGst = ({ restaurant, ordering = {}, environment = "system" } = {}) => {
  const gstin = gstinOf(restaurant);
  const percent = Number(ordering?.taxPercent) || 0;
  const inclusive = ordering?.taxInclusive === true;

  const applyTo = ordering?.gstApplyTo || "both";
  const appliesToThisChannel = applyTo === "both" || applyTo === environment;

  let reason = "";
  if (!gstin) reason = "no GST number on Store Properties";
  else if (percent <= 0) reason = "no GST rate set under Rules & Charges";
  else if (!appliesToThisChannel) reason = `GST is set to apply to "${applyTo}" only`;

  const applicable = Boolean(gstin) && percent > 0 && appliesToThisChannel;

  return {
    applicable,
    percent: applicable ? percent : 0,
    // Fraction, for callers that bill with a rate rather than a percentage.
    rate: applicable ? percent / 100 : 0,
    gstin,
    inclusive,
    reason,
  };
};

/**
 * The same answer, fetched for a restaurant id.
 *
 * Kept separate so the pure resolver above stays trivially testable, and so a
 * caller that already holds both documents does not pay for two more reads.
 */
const resolveGstForRestaurant = async (restaurantId, environment = "system") => {
  if (!restaurantId) return resolveGst({});

  const mongoose = require("mongoose");
  if (mongoose.connection?.readyState !== 1) return resolveGst({});

  try {
    const Restaurant = require("../models/restaurantModel");
    const WebsiteSettings = require("../models/websiteSettingsModel");

    const [restaurant, settings] = await Promise.all([
      Restaurant.findById(restaurantId).select("taxId gstRegistered").lean(),
      WebsiteSettings.findOne({ restaurantId }).select("ordering").lean(),
    ]);

    // The dine-in service charge rides along: same settings document, and
    // the table bill needs both at once.
    const pct = Number(settings?.ordering?.serviceChargePercent) || 0;
    return { ...resolveGst({ restaurant, ordering: settings?.ordering, environment }), serviceChargePercent: Math.max(0, Math.min(25, pct)) };
  } catch {
    // A store we cannot read is a store we cannot prove is registered, so it
    // is not charged. Failing open here would re-create the original bug.
    return resolveGst({});
  }
};

module.exports = { resolveGst, resolveGstForRestaurant, gstinOf, isValidGstin, buyerFrom, RESTAURANT_SAC };
