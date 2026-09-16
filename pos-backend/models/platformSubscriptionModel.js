const mongoose = require("mongoose");

/**
 * A restaurant's KnotKitchen subscription, and the invoices it produced.
 *
 * Named `Platform*` because `Subscription` and `Invoice` are already taken by
 * models/billingModel.js -- the unfinished prototype that no screen calls.
 * Registering the same model name twice throws, and quietly repurposing those
 * collections would mix real money with records written by code that stored
 * dollars.
 *
 * The invoice is a SNAPSHOT, not a view. Every number, rate, name and address
 * it needs is copied onto it at the moment it is issued, so an admin changing
 * the price of Growth from 1299 to 999 tomorrow cannot alter what a bill
 * issued today says. Nothing on an issued invoice is ever recomputed.
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

    status: {
      type: String,
      enum: ["NONE", "ACTIVE", "GRACE", "EXPIRED", "CANCELLED"],
      default: "NONE",
      index: true,
    },

    // Both are IST midnights. The period is [start, end) -- active while now
    // is before `currentPeriodEnd`. See services/subscriptionPeriod.js.
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null, index: true },

    // What was actually charged for the period now running, so the UI can say
    // "you pay 999" without re-resolving prices that may have moved since.
    lastPaidPricePaise: { type: Number, default: 0 },
    lastInvoiceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    lastPaidAt: { type: Date, default: null },

    autoRenew: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },

    // Agreement v2.0, clause 15.3: the first period bought is the Activation
    // Date, and the 12 months of clause 5.6 run from it. Never moves.
    activatedAt: { type: Date, default: null },

    // Clause 5: the one-time Installation Charge, paid before Activation.
    installation: {
      optionCode: { type: String, default: "" },
      optionName: { type: String, default: "" },
      amountPaise: { type: Number, default: 0 },
      paidAt: { type: Date, default: null },
      invoiceId: { type: mongoose.Schema.Types.ObjectId, default: null },
      ledgerEntryId: { type: mongoose.Schema.Types.ObjectId, default: null },
    },

    // Clause 6: a Commitment Period is `periodsTotal` Billing Periods bought
    // at `discountPercent` off. `periodsUsed` counts the ones bought so far.
    // Leaving early (clause 6.5, discount-repayment model): the discount
    // received so far becomes due, and the discount ends.
    commitment: {
      months: { type: Number, default: 0 },
      discountPercent: { type: Number, default: 0 },
      periodsTotal: { type: Number, default: 0 },
      periodsUsed: { type: Number, default: 0 },
      startedAt: { type: Date, default: null },
      endsAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      discountGrantedPaise: { type: Number, default: 0 },
      lapsedAt: { type: Date, default: null },
      repaymentDuePaise: { type: Number, default: 0 },
      repaidAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

/**
 * Schedule 1 of the Agreement: the commercial values the restaurant saw and
 * accepted in the app. One row per acceptance, never edited; a later change
 * is a new version. The hash fingerprints `values` (services/commercialTerms).
 */
const commercialScheduleSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    storeId: { type: String, default: "", index: true },
    version: { type: Number, required: true },
    agreementVersion: { type: String, default: "v2.0" },
    reason: { type: String, default: "" }, // INSTALLATION | SUBSCRIPTION | COMMITMENT | UPGRADE
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
      enum: ["SUBSCRIPTION", "UPGRADE", "INSTALLATION", "COMMITMENT_REPAYMENT", "OTHER"],
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
