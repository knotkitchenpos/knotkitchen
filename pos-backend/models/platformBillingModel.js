const mongoose = require("mongoose");

/**
 * Everything KnotKitchen charges for, and what it charges.
 *
 * ONE singleton document holds the platform defaults; a small per-restaurant
 * document overrides them. Nothing here has a default price baked into code --
 * a hard-coded 1299 or 18% is a price nobody can change without a deploy, and
 * the whole point of this is that the admin panel is the only place prices
 * live.
 *
 * Effective dating is deliberately shallow. Only the two dates the business
 * actually needs are stored (GST start, order-charge start) plus an offer
 * window, because invoices SNAPSHOT what they charged at the moment they were
 * issued. Immutable invoices are what make old bills correct forever; a full
 * temporal history of config would be a second, redundant source of truth.
 */

const offerSchema = new mongoose.Schema(
  {
    // Null price means "no offer", regardless of the dates.
    pricePaise: { type: Number, default: null, min: 0 },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    label: { type: String, default: "" },
  },
  { _id: false },
);

const planSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    // Paise. Integers only -- see services/money.js for why.
    standardPricePaise: { type: Number, required: true, min: 0 },
    // `isActive` false retires a plan for everyone; `isAvailable` false keeps
    // existing subscribers but hides it from new sign-ups. The spec asks for
    // both and they are not the same switch.
    isActive: { type: Boolean, default: true },
    isAvailable: { type: Boolean, default: true },
    offer: { type: offerSchema, default: () => ({}) },
    features: { type: [String], default: [] },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);

/**
 * The four plans KnotKitchen sells, as shipped.
 *
 * Seeded rather than hard-coded: the CSD owns pricing, offers and per-store
 * rates, and every one of these is editable there. They exist here only so a
 * fresh install has something to sell -- an empty catalogue is why the POS
 * showed "No plans are available at the moment".
 *
 * Essential and Connect ship with `isAvailable: false`: listed so a restaurant
 * can see what exists, but closed to new subscriptions until they open. That
 * is exactly the distinction `isAvailable` was added for -- `isActive` false
 * would hide them completely.
 */
const DEFAULT_PLANS = [
  { code: "ESSENTIAL", name: "Essential", standardPricePaise: 39900, sortOrder: 1, isAvailable: false },
  { code: "CONNECT", name: "Connect", standardPricePaise: 59900, sortOrder: 2, isAvailable: false },
  { code: "GROWTH", name: "Growth", standardPricePaise: 129900, sortOrder: 3, isAvailable: true },
  { code: "SCALE", name: "Scale", standardPricePaise: 169900, sortOrder: 4, isAvailable: true },
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
    plans: { type: [planSchema], default: () => DEFAULT_PLANS.map((p) => ({ ...p })) },
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

    /**
     * What an upgrade costs mid-period. PRORATE is the default and matches
     * "calculated based on the remaining subscription period".
     */
    upgradePolicy: {
      type: String,
      enum: ["PRORATE", "FULL_DIFFERENCE", "FULL_PRICE"],
      default: "PRORATE",
    },
    // Hours a restaurant gets to settle a due invoice before the account locks.
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
 * this codebase keeps repeating -- so the plan-price overrides were added
 * there instead and this file holds only the platform-wide defaults.
 */

module.exports = {
  DEFAULT_PLANS,
  PlatformBillingConfig: mongoose.model("PlatformBillingConfig", platformBillingConfigSchema),
};
