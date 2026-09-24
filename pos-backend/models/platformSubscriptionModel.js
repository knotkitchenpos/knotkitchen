const mongoose = require("mongoose");

/**
 * A restaurant's KnotKitchen subscription, and the invoices it produced.
 *
 * Named `Platform*` because the `subscriptions` and `invoices` collections
 * belonged to an unfinished prototype (since removed) that stored dollars.
 * Repurposing them would mix real money with its leftover records.
 *
 * The invoice is a SNAPSHOT, not a view. Every number, rate, name and address
 * it needs is copied onto it at the moment it is issued, so an admin changing
 * the price of the POS plan tomorrow cannot alter what a bill issued today
 * says. Nothing on an issued invoice is ever recomputed.
 */

const subscriptionSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      unique: true,
    },
    storeId: { type: String, default: "", index: true },

    planCode: { type: String, default: "" },
    planName: { type: String, default: "" },

    // NONE until the first qualifying top-up activates the POS plan. EXPIRED
    // when a renewal found the wallet short; the next top-up renews it.
    status: {
      type: String,
      enum: ["NONE", "ACTIVE", "EXPIRED", "CANCELLED"],
      default: "NONE",
      index: true,
    },

    // Both are IST midnights. The period is [start, end) -- active while now
    // is before `currentPeriodEnd`. See services/subscriptionPeriod.js.
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null, index: true },

    // What the last charge for a period came to, ex-tax, so the UI can say
    // what was paid without re-resolving prices that may have moved since.
    lastPaidPricePaise: { type: Number, default: 0 },
    lastInvoiceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    lastPaidAt: { type: Date, default: null },

    // The first qualifying top-up. Never moves; null means not activated yet.
    activatedAt: { type: Date, default: null },

    // Monthly add-ons. endsAt null renews with the plan; a date means it was
    // stopped and lapses then (the current period end). Name, feature and
    // price are snapshots of what was bought.
    addons: {
      type: [
        new mongoose.Schema(
          {
            code: { type: String, required: true },
            name: { type: String, default: "" },
            feature: { type: String, default: "" },
            pricePaise: { type: Number, default: 0 },
            activatedAt: { type: Date, default: null },
            endsAt: { type: Date, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    // Rented tablets, numbered per store. endsAt is set by CSD when a tablet
    // comes back (the physical return), at the current period end.
    tablets: {
      type: [
        new mongoose.Schema(
          {
            serial: { type: Number, required: true },
            pricePaise: { type: Number, default: 0 },
            rentedAt: { type: Date, default: null },
            endsAt: { type: Date, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    // Qualifying top-ups not yet used to rent a tablet. One each.
    tabletRechargeCredits: { type: Number, default: 0, min: 0 },

    // One-time purchases (printers).
    hardware: {
      type: [
        new mongoose.Schema(
          {
            // The payment key, so a purchase is recorded once however often it is retried.
            key: { type: String, default: "" },
            code: { type: String, required: true },
            name: { type: String, default: "" },
            pricePaise: { type: Number, default: 0 },
            totalPaise: { type: Number, default: 0 },
            invoiceId: { type: mongoose.Schema.Types.ObjectId, default: null },
            purchasedAt: { type: Date, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    lastRenewalAttemptAt: { type: Date, default: null },
    // Why the last automatic renewal did not go through ("" once it has).
    lastRenewalError: { type: String, default: "" },
  },
  { timestamps: true },
);

/**
 * What the restaurant saw and accepted in the app for an explicit purchase
 * (an add-on, a tablet, a printer). One row per acceptance, never edited. The
 * hash fingerprints `values` (services/subscription scheduleHash).
 */
const commercialScheduleSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    storeId: { type: String, default: "", index: true },
    version: { type: Number, required: true },
    agreementVersion: { type: String, default: "v2.0" },
    reason: { type: String, default: "" }, // ADDON | TABLET | HARDWARE
    values: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    hash: { type: String, required: true },
    acceptedAt: { type: Date, required: true },
    acceptedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, default: null },
      name: { type: String, default: "" },
      role: { type: String, default: "" },
    },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true },
);
commercialScheduleSchema.index({ restaurantId: 1, version: -1 }, { unique: true });

const lineSchema = new mongoose.Schema(
  {
    serial: { type: Number, required: true },
    description: { type: String, required: true },
    // All paise, all snapshots.
    amountPaise: { type: Number, required: true },
    taxableValuePaise: { type: Number, required: true },
    cgstRate: { type: Number, default: 0 },
    cgstPaise: { type: Number, default: 0 },
    sgstRate: { type: Number, default: 0 },
    sgstPaise: { type: Number, default: 0 },
    igstRate: { type: Number, default: 0 },
    igstPaise: { type: Number, default: 0 },
    totalPaise: { type: Number, required: true },
  },
  { _id: false },
);

const partySchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    gstin: { type: String, default: "" },
    addressLines: { type: [String], default: [] },
    state: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
  },
  { _id: false },
);

const invoiceSchema = new mongoose.Schema(
  {
    // KK-<storeId>-0001. Unique so a retry cannot mint the same number twice.
    invoiceNumber: { type: String, required: true, unique: true },
    invoiceDate: { type: Date, required: true },

    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    storeId: { type: String, default: "", index: true },

    kind: {
      type: String,
      enum: ["SUBSCRIPTION", "ADDON", "TABLET", "HARDWARE", "OTHER"],
      default: "SUBSCRIPTION",
    },

    // Both parties as they were on the day. A restaurant that renames itself
    // must not rewrite the name on last year's bills.
    seller: { type: partySchema, default: () => ({}) },
    buyer: { type: partySchema, default: () => ({}) },

    lines: { type: [lineSchema], default: [] },

    subtotalPaise: { type: Number, required: true },
    cgstPaise: { type: Number, default: 0 },
    sgstPaise: { type: Number, default: 0 },
    igstPaise: { type: Number, default: 0 },
    totalTaxPaise: { type: Number, default: 0 },
    totalPaise: { type: Number, required: true },
    // Rendered once and stored, so the PDF and the record can never disagree
    // about the amount -- and so a change to the words helper cannot alter
    // what an old invoice reads.
    totalInWords: { type: String, default: "" },

    placeOfSupply: { type: String, default: "" },
    interState: { type: Boolean, default: false },

    status: { type: String, enum: ["PAID", "VOID"], default: "PAID" },
    paidAt: { type: Date, default: null },
    ledgerEntryId: { type: mongoose.Schema.Types.ObjectId, default: null },

    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },

    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

invoiceSchema.index({ restaurantId: 1, invoiceDate: -1 });

/**
 * An issued invoice is a record, not a document to be edited.
 *
 * Voiding is the only permitted change -- a mistake is cancelled by a void and
 * a fresh invoice, never by rewriting the original, because the original may
 * already have been filed with a return.
 */
const EDITABLE_AFTER_ISSUE = ["status", "notes", "updatedAt"];

/**
 * Which of these changes are not allowed on an issued invoice.
 *
 * A named function rather than an inline filter so the rule can be tested
 * directly -- reaching into Mongoose's hook plumbing to prove it tests the
 * plumbing, not the rule.
 */
const rejectedEdits = (modifiedPaths = []) =>
  modifiedPaths.filter((p) => !EDITABLE_AFTER_ISSUE.includes(p));

invoiceSchema.pre("save", function guardImmutability(next) {
  if (this.isNew) return next();

  const changed = rejectedEdits(this.modifiedPaths());
  if (changed.length) {
    return next(
      new Error(
        `An issued invoice cannot be modified (attempted: ${changed.join(", ")}). Void it and issue a new one.`,
      ),
    );
  }
  return next();
});

module.exports = {
  rejectedEdits,
  EDITABLE_AFTER_ISSUE,
  PlatformSubscription: mongoose.model("PlatformSubscription", subscriptionSchema),
  PlatformInvoice: mongoose.model("PlatformInvoice", invoiceSchema),
  CommercialSchedule: mongoose.model("CommercialSchedule", commercialScheduleSchema),
};
