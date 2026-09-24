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

    // Predates the catalogue and charges nothing any more; planPrices below
    // is what a negotiated POS plan price is.
    monthlySubscription: { type: Number, default: DEFAULTS.monthlySubscription, min: 0 },

    /**
     * A negotiated price for one thing in the catalogue -- "ABC pays 299 for
     * the POS plan" while the standard price stays 399. Codes: POS, an add-on
     * code, TABLET_FIRST, TABLET_EXTRA, a printer code.
     *
     * Rupees, like every other amount on this document, because this is what
     * the admin dialog edits. services/pricing.js converts to paise at the
     * single point where money is computed.
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
     * A demo / test store: never billed and never locked. It gets every
     * add-on without buying it, no per-order or e-bill charge is taken, and
     * nothing -- an expired plan, an empty balance -- locks the POS.
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
