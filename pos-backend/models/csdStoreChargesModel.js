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
    gstPercent: { type: Number, default: DEFAULTS.gstPercent, min: 0, max: 100 },

    // Subscription amount. The plan NAME lives on Restaurant.subscription.plan
    // (the POS reads it for entitlements); only the price is set here, so the
    // two can't drift into disagreeing about which plan a store is on.
    monthlySubscription: { type: Number, default: DEFAULTS.monthlySubscription, min: 0 },

    notes: { type: String, default: "", maxlength: 1000 },

    // Kept on the document as well as in AuditLog so the pricing history is
    // readable without cross-referencing the platform-wide log.
    history: { type: [changeSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CsdStoreCharges", csdStoreChargesSchema);
module.exports.DEFAULTS = DEFAULTS;
