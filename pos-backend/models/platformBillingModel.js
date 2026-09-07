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

const platformBillingConfigSchema = new mongoose.Schema(
  {
    // Enforces the singleton: only one document can hold this value.
    singleton: { type: String, default: "platform", unique: true, immutable: true },
    plans: { type: [planSchema], default: [] },
    gst: { type: gstSchema, default: () => ({}) },
    websiteOrderCharge: { type: orderChargeSchema, default: () => ({}) },
    subscriptionDays: { type: Number, default: 30, min: 1 },
    // Hours a restaurant gets to settle a due invoice before the account locks.
    graceHours: { type: Number, default: 24, min: 0 },
    currency: { type: String, default: "INR" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

/**
 * Per-restaurant overrides. Absent fields fall through to the platform config,
 * so a restaurant with nothing special stored costs nothing to reason about.
 *
 * Written only by the admin panel. There is no restaurant-facing route that
 * touches this collection.
 */
const restaurantBillingOverrideSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      unique: true,
    },
    // [{ code: "growth", pricePaise: 99900 }] -- "ABC pays 999 for Growth".
    planPrices: {
      type: [
        new mongoose.Schema(
          {
            code: { type: String, required: true },
            pricePaise: { type: Number, required: true, min: 0 },
            note: { type: String, default: "" },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    // null = use the platform charge. 0 is a real value (this restaurant is
    // not charged per order) and must not be confused with "unset".
    orderChargePaise: { type: Number, default: null, min: 0 },
    orderChargeEnabled: { type: Boolean, default: null },
    note: { type: String, default: "" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

module.exports = {
  PlatformBillingConfig: mongoose.model("PlatformBillingConfig", platformBillingConfigSchema),
  RestaurantBillingOverride: mongoose.model(
    "RestaurantBillingOverride",
    restaurantBillingOverrideSchema,
  ),
};
