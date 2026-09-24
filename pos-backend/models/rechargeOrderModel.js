const mongoose = require("mongoose");

/**
 * A restaurant topping up its KnotKitchen Business Balance.
 *
 * The row is written BEFORE the customer is sent to Cashfree, for the same
 * reason the webhook looks its subject up rather than trusting the payload:
 * a callback naming a gateway order we never opened must find nothing. An
 * intent created only on success would make every forged event creditable.
 *
 * Money is never credited from this document. The ledger is the only thing
 * that moves a balance; `ledgerEntryId` records which entry did it.
 */
const rechargeOrderSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
      index: true,
    },
    amountPaise: { type: Number, required: true, min: 1 },
    // RECHARGE credits the wallet; PRINTER buys a printer outright through the
    // gateway (the wallet is never touched) -- services/recharge finalizeRecharge.
    purpose: { type: String, enum: ["RECHARGE", "PRINTER"], default: "RECHARGE" },
    item: {
      code: { type: String, default: "" },
      name: { type: String, default: "" },
      pricePaise: { type: Number, default: 0 },
      // The invoice lines (with tax) exactly as charged.
      lines: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },

    status: {
      type: String,
      enum: ["CREATED", "PAID", "FAILED", "EXPIRED"],
      default: "CREATED",
      index: true,
    },

    // Ours, and the handle the webhook resolves on. Unique so a retry of the
    // create call cannot open two intents against one gateway order.
    gatewayOrderId: { type: String, required: true, unique: true },
    gatewayProvider: { type: String, default: "cashfree" },
    // Cashfree's environment at the time. A TEST payment must never be able
    // to credit a balance that PROD money is measured in.
    environment: { type: String, enum: ["TEST", "PROD"], default: "TEST" },

    paymentSessionId: { type: String, default: "" },
    gatewayPaymentId: { type: String, default: "" },
    paidAt: { type: Date, default: null },
    failureReason: { type: String, default: "" },

    ledgerEntryId: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

rechargeOrderSchema.index({ restaurantId: 1, createdAt: -1 });

module.exports = mongoose.model("RechargeOrder", rechargeOrderSchema);
