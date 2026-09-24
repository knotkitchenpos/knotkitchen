const mongoose = require("mongoose");

/**
 * A printer or tablet a store asked for from POS Billing, and its way to the
 * counter: REQUESTED (paid) -> ACCEPTED -> DISPATCHED -> DELIVERED, or
 * CANCELLED with a refund to the wallet. services/hardwareRequests.js owns
 * every change; CSD works the queue.
 *
 * The money is not here. The payment is the printer's Cashfree order or the
 * tablet's wallet debit, and the printer/tablet row on the PlatformSubscription
 * is the entitlement. `key` is that payment's key (`printer-pay-<order>` /
 * `tablet-<subscription>-<serial>`), unique, so a payment opens one request
 * however often it is retried.
 */
const STATUSES = ["REQUESTED", "ACCEPTED", "DISPATCHED", "DELIVERED", "CANCELLED"];
const ACTORS = ["STORE", "CSD", "SYSTEM"];

const shipToSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    line1: { type: String, default: "" },
    line2: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    postalCode: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const historySchema = new mongoose.Schema(
  {
    from: { type: String, default: "" },
    to: { type: String, required: true },
    byType: { type: String, enum: ACTORS, default: "SYSTEM" },
    byId: { type: String, default: "" },
    byName: { type: String, default: "" },
    note: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const noteSchema = new mongoose.Schema({
  body: { type: String, required: true },
  byId: { type: String, default: "" },
  byName: { type: String, default: "" },
  at: { type: Date, default: Date.now },
});

const hardwareRequestSchema = new mongoose.Schema(
  {
    // HR-<storeId>-001: per store, like invoice numbers, so a number does not
    // tell a store how many requests everyone else makes.
    requestNo: { type: String, required: true, unique: true },
    key: { type: String, required: true, unique: true },

    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    storeId: { type: String, default: "", index: true },
    restaurantName: { type: String, default: "" },

    type: { type: String, enum: ["PRINTER", "TABLET"], required: true },
    item: {
      code: { type: String, default: "" },
      name: { type: String, default: "" },
      // The store's tablet number (Tablet #3) for a tablet.
      tabletSerial: { type: Number, default: null },
    },

    payment: {
      method: { type: String, enum: ["GATEWAY", "WALLET", "NONE"], default: "NONE" },
      // What the store paid, GST included.
      amountPaise: { type: Number, default: 0 },
      gatewayOrderId: { type: String, default: "" },
      ledgerEntryId: { type: mongoose.Schema.Types.ObjectId, default: null },
      invoiceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    },

    shipTo: { type: shipToSchema, default: () => ({}) },

    status: { type: String, enum: STATUSES, default: "REQUESTED", index: true },

    dispatch: {
      courier: { type: String, default: "" },
      trackingNo: { type: String, default: "" },
      trackingUrl: { type: String, default: "" },
      expectedBy: { type: Date, default: null },
      at: { type: Date, default: null },
    },
    deliveredAt: { type: Date, default: null },
    // The maker's serial / IMEI of the unit handed over.
    deviceSerial: { type: String, default: "" },

    cancel: {
      reason: { type: String, default: "" },
      byType: { type: String, default: "" },
      byName: { type: String, default: "" },
      at: { type: Date, default: null },
      // All the store had paid for it when cancelled (a renewed tablet included).
      paidPaise: { type: Number, default: 0 },
      refundPaise: { type: Number, default: 0 },
      refundLedgerEntryId: { type: mongoose.Schema.Types.ObjectId, default: null },
      // Set once the printer/tablet is released and the refund is made. A
      // cancel with this still null is finished by the next call.
      settledAt: { type: Date, default: null },
    },

    history: { type: [historySchema], default: [] },
    // CSD only. Never sent to the store.
    notes: { type: [noteSchema], default: [] },
  },
  { timestamps: true },
);

hardwareRequestSchema.index({ status: 1, createdAt: -1 });
hardwareRequestSchema.index({ restaurantId: 1, createdAt: -1 });

module.exports = mongoose.models.HardwareRequest || mongoose.model("HardwareRequest", hardwareRequestSchema);
module.exports.STATUSES = STATUSES;
