const mongoose = require("mongoose");

/**
 * The KnotKitchen Business Balance, and every movement of it.
 *
 * Two collections, one invariant each:
 *
 *   BusinessBalance  balancePaise never goes below zero
 *   LedgerEntry      exists for every single change to that number
 *
 * Neither is enforced by convention. The balance is only ever moved by a
 * conditional atomic update that cannot match when funds are short, and both
 * writes happen inside one transaction, so a balance change without its
 * ledger row is not a state the database can be left in.
 */

const businessBalanceSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      unique: true,
    },
    // Paise. Never written directly -- see services/ledger.js.
    balancePaise: { type: Number, required: true, default: 0, min: 0 },
    // Set when a due invoice passes its grace period. The restaurant can still
    // sign in and reach Billing; this only gates the rest of the product.
    lockedAt: { type: Date, default: null },
    lockedReason: { type: String, default: "" },
  },
  { timestamps: true },
);

const CREDIT_KINDS = ["RECHARGE", "REFUND", "ADJUSTMENT_CREDIT", "PROMO_CREDIT"];
const DEBIT_KINDS = [
  "SUBSCRIPTION",
  "ORDER_CHARGE",
  "EBILL_CHARGE",
  "USAGE_INVOICE",
  "ADJUSTMENT_DEBIT",
];

const ledgerEntrySchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    direction: { type: String, enum: ["CREDIT", "DEBIT"], required: true },
    kind: { type: String, enum: [...CREDIT_KINDS, ...DEBIT_KINDS], required: true },
    // Always positive. `direction` carries the sign, so no entry can be
    // ambiguous about which way the money went.
    amountPaise: { type: Number, required: true, min: 1 },
    // The running balance immediately after this entry, so the statement the
    // spec asks for renders straight from these rows without re-adding the
    // whole history on every page load.
    balanceAfterPaise: { type: Number, required: true, min: 0 },

    description: { type: String, default: "" },

    /**
     * The dedupe key. A PhonePe callback delivered three times carries the
     * same key three times, and the unique index means only the first one
     * moves money. Sparse: internal entries that are already guarded
     * elsewhere do not need one.
     */
    idempotencyKey: { type: String, default: null },

    // What this entry was for. Kept loose on purpose -- a future KnotKitchen
    // service should be able to bill through this ledger without a migration.
    refType: { type: String, default: "" },
    refId: { type: mongoose.Schema.Types.ObjectId, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

// The statement view: newest first, per restaurant.
ledgerEntrySchema.index({ restaurantId: 1, createdAt: -1 });
// Enforces idempotency. Partial rather than sparse so it applies only to rows
// that actually carry a key.
ledgerEntrySchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);

module.exports = {
  BusinessBalance: mongoose.model("BusinessBalance", businessBalanceSchema),
  LedgerEntry: mongoose.model("LedgerEntry", ledgerEntrySchema),
  CREDIT_KINDS,
  DEBIT_KINDS,
};
