const mongoose = require("mongoose");

/**
 * Everything KnotKitchen charges for, and what it charges.
 *
 * ONE singleton document holds the platform defaults; a small per-restaurant
 * document overrides them. The catalogue ships with seeded defaults, but the
 * admin panel is the only place prices change -- nothing reads a price from
 * code.
 *
 * Effective dating is deliberately shallow. Only the two dates the business
 * actually needs are stored (GST start, order-charge start), because invoices
 * SNAPSHOT what they charged at the moment they were issued. Immutable invoices are what make old bills correct forever; a full
 * temporal history of config would be a second, redundant source of truth.
 */

const addonSchema = new mongoose.Schema(
  {
    // Also the per-store override code (CsdStoreCharges.planPrices).
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    // Paise, per billing period, before GST. Integers only -- see services/money.js.
    pricePaise: { type: Number, required: true, min: 0 },
    // What it unlocks (services/planFeatures). "" is a service with no switch
    // in the product, such as GMB Management.
    feature: { type: String, enum: ["", "website", "tableQr"], default: "" },
    // false retires it: no new sign-ups; stores that have it keep it.
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

const printerSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    // One-time, before GST.
    pricePaise: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

/**
 * The catalogue as shipped. Seeded rather than hard-coded: the CSD owns every
 * price here, and services/pricing.getPlatformConfig backfills a config row
 * that predates them.
 */
const DEFAULT_ADDONS = [
  {
    code: "TABLE_QR",
    name: "QR Table Ordering",
    description: "Diners scan the table QR to order and pay.",
    pricePaise: 20000,
    feature: "tableQr",
    sortOrder: 1,
  },
  {
    code: "WEBSITE",
    name: "Website",
    description: "Your own ordering website, online payments and table booking.",
    pricePaise: 30000,
    feature: "website",
    sortOrder: 2,
  },
  {
    code: "GMB",
    name: "GMB Management",
    description: "KnotKitchen keeps your Google Business Profile up to date.",
    pricePaise: 10000,
    feature: "",
    sortOrder: 3,
  },
];

const DEFAULT_PRINTERS = [
  { code: "PRINTER_2IN", name: "2-inch receipt printer", pricePaise: 190000 },
  { code: "PRINTER_3IN", name: "3-inch receipt printer", pricePaise: 425000 },
];

const gstSchema = new mongoose.Schema(
  {
    registered: { type: Boolean, default: false },
    gstin: { type: String, default: "", trim: true },
    // Nothing is taxed before this date, even when `registered` is true. That
    // is the "1299 + 0 GST = 1299" case in the spec.
    effectiveFrom: { type: Date, default: null },
    percent: { type: Number, default: 0, min: 0, max: 100 },
    // exclusive: tax is added on top. inclusive: the price already contains it.
    mode: { type: String, enum: ["exclusive", "inclusive"], default: "exclusive" },
    // KnotKitchen's own state. Same state as the restaurant -> CGST + SGST;
    // different -> IGST.
    placeOfSupplyState: { type: String, default: "", trim: true },
    legalName: { type: String, default: "", trim: true },
    addressLines: { type: [String], default: [] },
  },
  { _id: false },
);

const orderChargeSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    amountPaise: { type: Number, default: 0, min: 0 },
    effectiveFrom: { type: Date, default: null },
    // Which orders qualify. Empty means nothing is charged -- an explicit
    // opt-in, so a new order source cannot start billing restaurants by
    // simply existing.
    chargeableSources: { type: [String], default: [] },
    taxable: { type: Boolean, default: true },
  },
  { _id: false },
);

/**
 * Per-message charge for an e-bill.
 *
 * Same shape as the order charge because it is the same kind of thing: an
 * amount, a date it starts applying, and whether GST is added. A third charge
 * later should reuse this rather than inventing a fourth shape.
 *
 * No `chargeableSources` -- an e-bill is one thing, not several channels.
 */
const messageChargeSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    amountPaise: { type: Number, default: 0, min: 0 },
    effectiveFrom: { type: Date, default: null },
    taxable: { type: Boolean, default: true },
  },
  { _id: false },
);

const platformBillingConfigSchema = new mongoose.Schema(
  {
    // Enforces the singleton: only one document can hold this value.
    singleton: { type: String, default: "platform", unique: true, immutable: true },
    // The POS plan every store pays for once activated. The code is fixed: it
    // is what activation, renewal and per-store overrides look up.
    basePlan: {
      code: { type: String, default: "POS" },
      name: { type: String, default: "POS", trim: true },
      pricePaise: { type: Number, default: 39900, min: 0 },
    },
    addons: { type: [addonSchema], default: () => DEFAULT_ADDONS.map((a) => ({ ...a })) },
    // Monthly tablet rental. Each tablet needs its own qualifying top-up of
    // at least rechargeRequiredPaise first (services/subscription).
    tablet: {
      firstPricePaise: { type: Number, default: 60000, min: 0 },
      extraPricePaise: { type: Number, default: 50000, min: 0 },
      rechargeRequiredPaise: { type: Number, default: 400000, min: 0 },
    },
    printers: { type: [printerSchema], default: () => DEFAULT_PRINTERS.map((p) => ({ ...p })) },
    // A store that has not activated yet must top up at least this much in
    // one go; that top-up starts the POS plan.
    firstRechargeMinPaise: { type: Number, default: 250000, min: 0 },
    gst: { type: gstSchema, default: () => ({}) },
    websiteOrderCharge: { type: orderChargeSchema, default: () => ({}) },
    // Charged per e-bill actually delivered -- never per attempt.
    ebillCharge: { type: messageChargeSchema, default: () => ({}) },
    subscriptionDays: { type: Number, default: 30, min: 1 },

    /**
     * What a late payment buys. The spec asks for a "configured
     * renewal/activation policy" rather than naming one, and both satisfy its
     * rule that missed days are never free:
     *
     *   FROM_PAYMENT  the new period starts the day they pay, so the gap is
     *                 simply unsubscribed (default)
     *   FROM_EXPIRY   the new period starts at the old expiry, so paying nine
     *                 days late costs nine days of the new month
     *
     * Renewing while still active always continues from the current end under
     * either policy -- charging someone and shortening their subscription
     * would be indefensible.
     */
    renewalPolicy: {
      type: String,
      enum: ["FROM_PAYMENT", "FROM_EXPIRY"],
      default: "FROM_PAYMENT",
    },

    // Hours a restaurant gets to top up after its plan expires (or the balance
    // runs out) before the account locks.
    graceHours: { type: Number, default: 24, min: 0 },
    currency: { type: String, default: "INR" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

/**
 * Per-restaurant overrides live in models/csdStoreChargesModel.js, NOT here.
 *
 * That collection already existed with an audited PATCH endpoint and a CSD
 * dialog behind it. A second override model next to it would have been a
 * fourth copy of "what does this restaurant pay", which is the exact failure
 * this codebase keeps repeating -- so the price overrides were added there
 * instead and this file holds only the platform-wide defaults.
 */

module.exports = {
  DEFAULT_ADDONS,
  DEFAULT_PRINTERS,
  PlatformBillingConfig: mongoose.model("PlatformBillingConfig", platformBillingConfigSchema),
};
