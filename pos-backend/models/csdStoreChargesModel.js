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

// null = "use the platform amount" (CSD → Billing). A row must never copy a
// platform price into itself, or it silently overrides every later change.
const DEFAULTS = {
  onlinePaidOrderCharge: null,
  qrPaidOrderCharge: null,
  knotEatsPaidOrderCharge: null,
  orderChargeFrom: null,
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

    // The platform fee on this store's online-paid orders, rupees before GST:
    // website orders here ("Website platform fee"), table-QR orders below
    // ("Table QR platform fee"). null means "use the platform amount"; 0
    // means "this restaurant's customers pay none", which is a real setting.
    onlinePaidOrderCharge: { type: Number, default: DEFAULTS.onlinePaidOrderCharge, min: 0 },
    qrPaidOrderCharge: { type: Number, default: DEFAULTS.qrPaidOrderCharge, min: 0 },
    knotEatsPaidOrderCharge: { type: Number, default: DEFAULTS.knotEatsPaidOrderCharge, min: 0 }, // ₹ before GST; null = platform; 0 = none
    // Delays the platform fee (all three sources) for this store only: it applies
    // to orders placed on or after max(platform effectiveFrom, orderChargeFrom).
    // null = the platform start date alone.
    orderChargeFrom: { type: Date, default: DEFAULTS.orderChargeFrom },
    // Per e-bill delivered. null means "use the platform amount"; 0 means
    // "this restaurant is charged nothing", which is a real setting.
    ebillCharge: { type: Number, default: null, min: 0 },

    /**
     * A negotiated price for one thing in the catalogue -- "ABC pays 449 for
     * the POS plan" while the standard price stays 499. Codes: POS, an add-on
     * code (per that add-on's own period: a WEBSITE price is per YEAR), a
     * device code (TABLET or a printer, GST-inclusive), and TABLET_FIRST /
     * TABLET_EXTRA for tablets rented before tablets were sold.
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
     * add-on without buying it, no platform fee or e-bill charge is taken, and
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
