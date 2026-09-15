const mongoose = require("mongoose");

/**
 * Commercial terms KnotKitchen applies to one restaurant (§29).
 *
 * A separate collection rather than fields on Restaurant because these are
 * KnotKitchen's billing terms, not the restaurant's own configuration: they
 * are admin-editable only, every change is audited, and keeping them apart
 * means an ordinary restaurant update can never accidentally rewrite a price.
 *
 * Rows are created lazily — a restaurant with no row is on the platform
 * defaults, and the API materialises one on first edit. That avoids a
 * migration over every existing restaurant just to store the defaults.
 */

const DEFAULTS = {
  onlinePaidOrderCharge: 9, // ₹ per online paid order
  gstPercent: 18,
  monthlySubscription: 999,
};

const changeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    from: { type: mongoose.Schema.Types.Mixed },
    to: { type: mongoose.Schema.Types.Mixed },
    byId: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff" },
    byStaffId: { type: String, default: "" },
    byName: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const csdStoreChargesSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true, unique: true, index: true },

    // Per-order commission on website orders paid online.
    onlinePaidOrderCharge: { type: Number, default: DEFAULTS.onlinePaidOrderCharge, min: 0 },
    // Per e-bill delivered. null means "use the platform amount"; 0 means
    // "this restaurant is charged nothing", which is a real setting.
    ebillCharge: { type: Number, default: null, min: 0 },
    gstPercent: { type: Number, default: DEFAULTS.gstPercent, min: 0, max: 100 },

    // Subscription amount. The plan NAME lives on Restaurant.subscription.plan
    // (the POS reads it for entitlements); only the price is set here, so the
    // two can't drift into disagreeing about which plan a store is on.
    monthlySubscription: { type: Number, default: DEFAULTS.monthlySubscription, min: 0 },

    /**
     * A negotiated price for a specific plan -- "ABC pays 999 for Growth"
     * while the standard price stays 1299.
     *
     * Rupees, like every other amount on this document, because this is what
     * the admin dialog edits. services/pricing.js converts to paise at the
     * single point where money is computed.
     *
     * `monthlySubscription` above predates plans and is a single figure with
     * no plan attached; an entry here for the restaurant's current plan wins
     * over it.
     */
    planPrices: {
      type: [
        new mongoose.Schema(
          {
            code: { type: String, required: true, trim: true },
            price: { type: Number, required: true, min: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    /**
     * A demo / test store: never billed and never locked. No subscription is
     * needed (and none can be bought), no per-order or e-bill charge is taken,
     * and nothing -- an expired plan, an empty balance -- locks the POS.
     */
    billingExempt: { type: Boolean, default: false },

    notes: { type: String, default: "", maxlength: 1000 },

    // Kept on the document as well as in AuditLog so the pricing history is
    // readable without cross-referencing the platform-wide log.
    history: { type: [changeSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CsdStoreCharges", csdStoreChargesSchema);
module.exports.DEFAULTS = DEFAULTS;
