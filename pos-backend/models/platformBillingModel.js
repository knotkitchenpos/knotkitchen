const mongoose = require("mongoose");

/**
 * Everything KnotKitchen charges for, and what it charges.
 *
 * ONE singleton document holds the platform defaults; a small per-restaurant
 * document overrides them. The catalogue ships with seeded defaults, but the
 * admin panel is the only place prices change -- nothing reads a price from
 * code.
 *
 * Effective dating is deliberately shallow. Only the dates the business
 * actually needs are stored (GST start, each usage charge's start), because invoices
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
    // null rides the POS plan's period (prorated when bought mid-period,
    // renewed with the plan). A number is the add-on's OWN period: bought at
    // full price for that many days from the day it is paid, and renewed on
    // its own date (the yearly Website). services/subscription.
    periodDays: { type: Number, default: null, min: 1, max: 366 },
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
    // One-time, and GST-INCLUSIVE: the displayed price is what the store
    // pays. GST is never added on top of it.
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
    description: "Your own ordering website and table booking.",
    pricePaise: 360000,
    periodDays: 365,
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

// Devices: one-time, GST-inclusive, paid online. Kept under `printers` (the
// tablet too, since tablets stopped being rented) so the purchase path stays
// one path; the apps call the list "Devices".
const DEFAULT_PRINTERS = [
  { code: "TABLET", name: "Tablet", pricePaise: 1000000 },
  { code: "PRINTER_2IN", name: "2-inch Bluetooth printer", pricePaise: 170000 },
  { code: "PRINTER_3IN", name: "3-inch Bluetooth printer", pricePaise: 430000 },
  { code: "PRINTER_3IN_LAN", name: "3-inch LAN printer", pricePaise: 390000 },
  { code: "PRINTER_3IN_USB", name: "3-inch USB printer", pricePaise: 350000 },
];

const DEFAULT_PLAN_PAISE = 49900;
const DEFAULT_FIRST_RECHARGE_MIN_PAISE = 300000;

// Bumped when the shipped catalogue changes in a way a stored row has to be
// moved to; services/pricing.getPlatformConfig does that once per version.
// v3: first top-up ₹3,000 (was ₹2,500), later top-ups ₹1,000 (topUpMinPaise).
const CATALOG_VERSION = 3;

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

/**
 * The usage charges as shipped: priced, but OFF with no start date. CSD
 * switches each one on and picks the day it starts; until then nothing is
 * charged. services/pricing.getPlatformConfig backfills these into a config
 * row that predates them, without switching anything on.
 *
 * The platform fee is one charge per order source, each with its own amount:
 * websiteOrderCharge for website orders ("WEBSITE"), qrOrderCharge for
 * table-QR orders ("QR") and knotEatsOrderCharge for website orders placed
 * through Knot Eats (source "WEBSITE", salesChannel "KNOT_EATS"; it replaces
 * the website fee on those). It is added to the customer's bill only when
 * they pay online, and the same amount is then deducted from the store's
 * wallet. Never shown in the POS app, with one exception: the POS Knot Eats
 * opt-in screen shows the Knot Eats fee, because opting in is consent to it.
 */
const DEFAULT_ORDER_CHARGE = {
  enabled: false,
  amountPaise: 300,
  effectiveFrom: null,
  taxable: true,
};

const DEFAULT_QR_ORDER_CHARGE = {
  enabled: false,
  amountPaise: 100,
  effectiveFrom: null,
  taxable: true,
};

const DEFAULT_KNOT_EATS_ORDER_CHARGE = { enabled: false, amountPaise: 900, effectiveFrom: null, taxable: true }; // ₹9 + GST

const DEFAULT_EBILL_CHARGE = {
  enabled: false,
  amountPaise: 25,
  effectiveFrom: null,
  taxable: true,
};

/**
 * A usage charge: an amount, the date it starts applying, and whether GST is
 * added. The platform fee (one per order source) and the e-bill charge are all
 * this shape; a new charge should reuse it rather than invent another.
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
      pricePaise: { type: Number, default: DEFAULT_PLAN_PAISE, min: 0 },
    },
    addons: { type: [addonSchema], default: () => DEFAULT_ADDONS.map((a) => ({ ...a })) },
    // Tablet RENTAL prices, for tablets already rented only: they keep
    // renewing at these until ended. No new rentals -- a tablet is now bought
    // once, like a printer (the TABLET device below).
    tablet: {
      firstPricePaise: { type: Number, default: 60000, min: 0 },
      extraPricePaise: { type: Number, default: 50000, min: 0 },
    },
    printers: { type: [printerSchema], default: () => DEFAULT_PRINTERS.map((p) => ({ ...p })) },
    // A store that has not activated yet must top up at least this much in
    // one go; that top-up starts the POS plan.
    firstRechargeMinPaise: { type: Number, default: DEFAULT_FIRST_RECHARGE_MIN_PAISE, min: 0 },
    // Every top-up after the POS plan has started must be at least this; 0 = none.
    topUpMinPaise: { type: Number, default: 100000, min: 0 },
    gst: { type: gstSchema, default: () => ({}) },
    // Platform fee per online-paid website order, per table-QR one and per Knot Eats one.
    websiteOrderCharge: { type: messageChargeSchema, default: () => ({ ...DEFAULT_ORDER_CHARGE }) },
    qrOrderCharge: { type: messageChargeSchema, default: () => ({ ...DEFAULT_QR_ORDER_CHARGE }) },
    knotEatsOrderCharge: { type: messageChargeSchema, default: () => ({ ...DEFAULT_KNOT_EATS_ORDER_CHARGE }) },
    // Charged per e-bill actually delivered -- never per attempt.
    ebillCharge: { type: messageChargeSchema, default: () => ({ ...DEFAULT_EBILL_CHARGE }) },
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
    // Which shipped catalogue this row has been moved to. A new row starts on
    // the current one; a stored row without it reads as unset (a plain
    // default would be filled in on load and hide that it is old).
    catalogVersion: {
      type: Number,
      default: function catalogVersionDefault() {
        return this.isNew ? CATALOG_VERSION : undefined;
      },
    },
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
  DEFAULT_PLAN_PAISE,
  DEFAULT_FIRST_RECHARGE_MIN_PAISE,
  CATALOG_VERSION,
  DEFAULT_ORDER_CHARGE,
  DEFAULT_QR_ORDER_CHARGE,
  DEFAULT_KNOT_EATS_ORDER_CHARGE,
  DEFAULT_EBILL_CHARGE,
  PlatformBillingConfig: mongoose.model("PlatformBillingConfig", platformBillingConfigSchema),
};
