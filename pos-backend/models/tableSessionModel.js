const mongoose = require("mongoose");

const tableSessionItemSchema = new mongoose.Schema(
  {
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: "Menu", required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    price: { type: Number, required: true }, // unit price at time of order
    total: { type: Number, required: true },
    modifiers: [{ name: String, price: Number }],
    note: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "preparing", "ready", "served", "cancelled", "refunded"],
      default: "pending",
    },
    addedBy: { type: String, enum: ["POS", "QR", "SYSTEM"], default: "POS" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" }, // internal kitchen order if any
    kdsItemId: { type: mongoose.Schema.Types.ObjectId }, // KDS item reference inside kitchen order
    cancelledAt: Date,
    cancelReason: String,
  },
  { _id: true }
);

const tableSessionSchema = new mongoose.Schema(
  {
    sessionCode: { type: String, required: true, unique: true },

    // The diner's claim on THIS session, and nothing else.
    //
    // The QR stuck to the table is permanent, so the link it opens is
    // permanent too: whoever scanned it once, or photographed the card, could
    // reopen it months later and land on whichever party is sitting there
    // now -- reading their name, phone and bill, and adding dishes to it.
    //
    // This token is minted per session, handed only to the browser that is
    // ordering, and carried in the page URL. It dies with the session, so a
    // saved link stops working the moment the table is settled. It is NOT the
    // sessionCode: that one is printed on the bill (`BL_<sessionCode>`), so
    // anybody who saw a receipt would hold the claim.
    accessToken: { type: String, default: "", index: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    // Optional. Single-outlet restaurants (which is the norm outside the
    // multi-outlet enterprise plan) never have an Outlet document, so
    // outletId legitimately ends up null — every reader downstream already
    // handles it that way (`{ $in: [outletId, null] }` in scoped queries,
    // `table.outletId || req.user?.outletId || null` at write sites).
    // Marking it required here broke every POS + QR order for such stores
    // with ValidationError 'Path `outletId` is required.'
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet", default: null },
    tableId: { type: mongoose.Schema.Types.ObjectId, ref: "Table", required: true },

    // Origin of the session: opened from POS UI or from customer QR scan
    source: { type: String, enum: ["POS", "QR"], default: "POS" },

    // Optional canonical bill once bill is requested
    billId: { type: mongoose.Schema.Types.ObjectId, ref: "Bill" },

    status: {
      type: String,
      enum: ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING", "PAID", "CLOSED"],
      default: "OPEN",
    },

    customerCount: { type: Number, default: 1 },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
    // When the automatic e-bill was sent, and the lock that stops it going
    // twice. A settle can be retried -- a webhook redelivery, a double-tap on
    // Mark Paid -- and the customer must not be messaged again. Claimed with a
    // conditional update; cleared again if the send fails, so a real failure
    // stays retryable. Queried as `{ eBillSentAt: null }`, which in MongoDB
    // also matches documents written before this field existed.
    eBillSentAt: { type: Date, default: null },

    items: [tableSessionItemSchema],
    originalItemsCount: { type: Number, default: 0 }, // snapshot of count of initial items

    bills: {
      subtotal: { type: Number, default: 0 },
      tax: { type: Number, default: 0 },
      taxPercent: { type: Number, default: 0 },
      taxInclusive: { type: Boolean, default: false },
      discount: { type: Number, default: 0 },
      charges: { type: Number, default: 0 },
      serviceCharge: { type: Number, default: 0 },
      tip: { type: Number, default: 0 },
      totalWithTax: { type: Number, default: 0 },
    },
    // B2B bill details, when a company asks for a GST bill.
    customerCompany: { type: String, default: "" },
    customerGstin: { type: String, default: "" },

    payment: {
      method: { type: String, default: "" },
      status: { type: String, enum: ["PENDING", "PARTIAL", "PAID", "FAILED", "REFUNDED"], default: "PENDING" },
      transactionId: { type: String, default: "" },
      paidAt: Date,
      recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

      // The gateway order this session's online payment was opened against.
      //
      // Stored so payment-verify asks the gateway about OUR order rather than
      // one the browser named -- without it a caller could hand back any paid
      // order id from the same merchant account and settle this table with
      // someone else's money. Subdocuments are strict, so these have to exist
      // here or the assignment is silently dropped and the check has nothing
      // to compare against.
      gatewayProvider: { type: String, default: "" },
      gatewayOrderId: { type: String, default: "" },
    },

    paymentHistory: [
      {
        method: { type: String, default: "" },
        amount: { type: Number, default: 0 },
        status: { type: String, enum: ["PENDING", "PAID", "FAILED", "REFUNDED"], default: "PENDING" },
        transactionId: { type: String, default: "" },
        idempotencyKey: { type: String, default: "" },
        at: { type: Date, default: Date.now },
        recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],

    timeline: [
      {
        event: { type: String, required: true },
        note: { type: String, default: "" },
        actorType: { type: String, enum: ["POS", "QR", "SYSTEM", "ADMIN"], default: "SYSTEM" },
        actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        at: { type: Date, default: Date.now },
      },
    ],

    openedAt: { type: Date, default: Date.now },
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    closedAt: Date,
    billRequestedAt: Date,
    paymentRequestedAt: Date,

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Enforce one active session per table at DB level (partial unique index)
tableSessionSchema.index(
  { tableId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"] } },
  }
);
tableSessionSchema.index({ restaurantId: 1, status: 1 });
tableSessionSchema.index({ outletId: 1, status: 1 });

// Duplicate-payment guard at DB level: one successful payment per idempotency
// key, per restaurant. The key is chosen by the till, so the index is scoped
// like every other idempotency index (see migrations/010 for the old global one).
tableSessionSchema.index(
  { restaurantId: 1, "paymentHistory.idempotencyKey": 1 },
  {
    unique: true,
    partialFilterExpression: { "paymentHistory.idempotencyKey": { $ne: "" }, "paymentHistory.status": "PAID" },
  }
);

module.exports = mongoose.model("TableSession", tableSessionSchema);