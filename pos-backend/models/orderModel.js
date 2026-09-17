const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: "Menu" },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, default: 1 },
  price: { type: Number, required: true },
  total: { type: Number, required: true },
  modifiers: [{ name: String, price: Number }],
  note: { type: String, default: "" },
  // Stock for this line has been taken off the shelf (services/inventory.js).
  stockDepleted: { type: Boolean, default: false },

  // --- Website/storefront line detail (additive; POS lines simply omit these) ---
  // The Menu document id (category) + the embedded item id. Together they
  // uniquely resolve a product, which is what the server re-validates against.
  menuId: { type: mongoose.Schema.Types.ObjectId, ref: "Menu" },
  itemId: { type: mongoose.Schema.Types.ObjectId },
  basePrice: { type: Number, default: 0 },   // price before modifiers, per unit
  unitPrice: { type: Number, default: 0 },   // base + modifiers, per unit
  variant: {
    variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
    name: { type: String, default: "" },
    price: { type: Number, default: 0 },
  },
  addons: {
    type: [{ addonId: mongoose.Schema.Types.ObjectId, name: String, price: Number, _id: false }],
    default: [],
  },
  modifierSelections: {
    type: [{
      groupId: mongoose.Schema.Types.ObjectId,
      groupName: String,
      optionId: mongoose.Schema.Types.ObjectId,
      optionName: String,
      price: Number,
      _id: false,
    }],
    default: [],
  },
  imageUrl: { type: String, default: "" },

  status: {
    type: String,
    enum: ["pending", "preparing", "ready", "served", "cancelled", "refunded"],
    default: "pending",
  },
  cancelledAt: Date,
  cancelReason: String,
});

const paymentSchema = new mongoose.Schema({
  method: { type: String, enum: ["cash", "card", "upi", "wallet", "online", "split"], default: "cash" },
  amount: { type: Number, default: 0 },
  status: { type: String, enum: ["pending", "paid", "failed", "refunded"], default: "pending" },
  transactionId: { type: String, default: "" },
  refund: {
    amount: { type: Number, default: 0 },
    reason: { type: String, default: "" },
    refundedAt: Date,
  },
});

const orderSchema = new mongoose.Schema({
  customerDetails: {
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    guests: { type: Number, default: 1 },
    // Optional structured customer address captured on the POS for
    // collection/delivery flows (Module 4 §5). Kept flat so the
    // existing name/phone fields on customerDetails remain untouched.
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    pinCode: { type: String, default: "" },
    deliveryNote: { type: String, default: "" },
    // B2B bill: the buyer's business, printed with their GSTIN.
    company: { type: String, default: "" },
    gstin: { type: String, default: "" },
  },
  orderType: {
    type: String,
    enum: ["dine-in", "takeaway", "delivery", "online", "marketplace", "collection"],
    default: "dine-in",
  },
  deliveryAddress: {
    line1: String, line2: String, city: String, postalCode: String,
    instructions: String,
  },
  /**
   * Module 4 §2/§3/§4 — Ready state tracking.
   *
   * `readyAt`         when the order was marked/became Ready
   * `readyBy`         "STAFF" | "AUTO" | "KDS" | "SYSTEM"
   * `readyDueAt`      when the server-side automatic-ready timer should fire
   *                   (server is authoritative — never trust browser timers)
   * `readyNotifiedAt` when the "Order is Ready" SMS was sent — used to
   *                   prevent duplicate notifications on retries/restarts
   */
  readyAt: { type: Date, default: null },
  readyBy: { type: String, enum: ["STAFF", "AUTO", "KDS", "SYSTEM", ""], default: "" },
  readyDueAt: { type: Date, default: null, index: true },
  readyNotifiedAt: { type: Date, default: null },
  // When the automatic e-bill was sent, and the lock that stops it going
  // twice. A settle can be retried -- a webhook redelivery, a double-tap on
  // Mark Paid -- and the customer must not be messaged again. Claimed with a
  // conditional update; cleared again if the send fails, so a real failure
  // stays retryable. Queried as `{ eBillSentAt: null }`, which in MongoDB
  // also matches documents written before this field existed.
  eBillSentAt: { type: Date, default: null },

  /**
   * What KnotKitchen charged the RESTAURANT for this order -- the platform's
   * per-order website fee, not anything the diner paid.
   *
   * Lives on the order because the order is the thing being charged: "was
   * this one billed, and if not why not" is answered in the same document,
   * and a status already set is the idempotency guard.
   *
   * PENDING means the fee was owed but the Business Balance was short. The
   * customer's order still went through -- KnotKitchen's billing must never
   * be able to block a restaurant from taking money.
   */
  platformCharge: {
    status: {
      type: String,
      enum: ["PENDING", "PAID", "NOT_APPLICABLE", "WAIVED"],
      default: null,
    },
    reason: { type: String, default: "" },
    amountPaise: { type: Number, default: 0 },
    taxPaise: { type: Number, default: 0 },
    totalPaise: { type: Number, default: 0 },
    taxPercent: { type: Number, default: 0 },
    chargedAt: { type: Date, default: null },
    ledgerEntryId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },

  /**
   * Auto-Complete state tracking.
   * `completeDueAt`   when the server-side auto-complete timer should fire
   * `completedAt`     when the order was marked/became Completed
   * `completedBy`     "STAFF" | "AUTO" | "KDS" | "SYSTEM"
   */
  completeDueAt: { type: Date, default: null, index: true },
  completedAt: { type: Date, default: null },
  completedBy: { type: String, enum: ["STAFF", "AUTO", "KDS", "SYSTEM", ""], default: "" },

  orderStatus: { type: String, required: true },
  marketplace: { type: String, enum: ["Swiggy", "Zomato", "Manual", ""] },
  marketplaceOrderId: { type: String, default: "" },
  orderDate: { type: Date, default: Date.now },
  // Every field defaults to 0. TableSession + Bill sub-docs already do this,
  // and this schema used to disagree — writing a TableSession's `bills`
  // straight into an Order (QR / add-to-session paths) 400'd on missing
  // `total` because TableSession never carried that field. `total` on
  // Order is derivable from totalWithTax − tax anyway; leaving it as 0 for
  // a zero-value order is the same as it being explicit.
  bills: {
    subtotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    // GST rate the tax was charged at, so the receipt can print CGST/SGST @ rate.
    taxPercent: { type: Number, default: 0 },
    taxInclusive: { type: Boolean, default: false },
    totalWithTax: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    packagingFee: { type: Number, default: 0 },
    // Dine-in service charge (Settings > Rules & Charges), inside totalWithTax.
    serviceCharge: { type: Number, default: 0 },
    // A tip left at settle. NOT inside totalWithTax: it is not sales.
    tip: { type: Number, default: 0 },
  },
  items: [orderItemSchema],
  table: { type: mongoose.Schema.Types.ObjectId, ref: "Table" },
  tableSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "TableSession" },
  requestId: { type: String, default: "" },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
  outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },

  /**
   * --- Online/website ordering (additive) ---
   * source distinguishes how the order entered the system. Existing POS code
   * paths default to "POS" so nothing changes for them.
   */
  source: {
    type: String,
    enum: ["POS", "WEBSITE", "QR", "MARKETPLACE", "PHONE"],
    default: "POS",
    index: true,
  },
  // Permanent public store identifier, denormalized onto the order so the POS
  // and future analytics can filter website orders without a join.
  storeId: { type: String, default: "", index: true },
  // Human-friendly reference shown to the customer, e.g. "W-482193-0007".
  orderNumber: { type: String, default: "" },
  // Idempotency key for online checkout (§32 double-click protection).
  idempotencyKey: { type: String, default: "" },
  // Scheduled/pre-orders (§21). Null = ASAP.
  scheduledFor: { type: Date, default: null },
  // A scheduled order accepted ahead of time waits in the queue until the
  // kitchen should start: scheduledFor minus the Auto Ready duration.
  prepStartAt: { type: Date, default: null, index: true },
  // When the POS was told "time to start preparing", and when staff did.
  prepAlertedAt: { type: Date, default: null },
  prepStartedAt: { type: Date, default: null },
  // Structured analytics context (§28) — no PII beyond what the order holds.
  channelMeta: {
    slug: { type: String, default: "" },
    themeKey: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    placedAt: { type: Date },
  },

  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
  couponCode: { type: String, default: "" },
  tips: { type: Number, default: 0 },
  payments: [paymentSchema],
  isSplit: { type: Boolean, default: false },
  splitDetails: [{
    label: String,
    amount: Number,
    items: [String], // item ids or names
    paymentMethod: String,
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    paidAt: Date,
  }],
  refunds: [{
    amount: Number,
    reason: String,
    items: [String],
    refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    refundedByName: { type: String, default: "" },
    refundedAt: { type: Date, default: Date.now },
    // "cash" when handed back at the counter; "gateway" when Cashfree returned it.
    channel: { type: String, default: "cash" },
    gateway: {
      provider: { type: String, default: "" },
      refundId: { type: String, default: "" },
      cfRefundId: { type: String, default: "" },
      status: { type: String, default: "" }, // SUCCESS | PENDING | ONHOLD | CANCELLED
    },
  }],
  // Why the whole order was cancelled (a cancelled line keeps its own reason).
  cancelReason: { type: String, default: "" },
  cancelledBy: { type: String, default: "" },
  timeline: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    user: String,
  }],
  isOffline: { type: Boolean, default: false },
  syncStatus: { type: String, enum: ["synced", "pending", "failed"], default: "synced" },
  paymentMethod: { type: String, default: "" },
  // The gateway's own identifiers for this order's payment, when one went
  // through a gateway. Named for the role rather than the provider: they were
  // called razorpay_* and had to be renamed the moment the provider changed,
  // touching every reader.
  paymentData: { gatewayOrderId: String, gatewayPaymentId: String },
  // Customer-created (QR) orders have no POS user — createdBy is null
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ marketplace: 1, orderDate: -1 });
orderSchema.index({ restaurantId: 1, createdAt: -1 });
orderSchema.index({ "customerDetails.phone": 1 });

// QR double-fire guard: one kitchen order per requestId per table.
// `$gt: ""` (a non-empty string), never `$ne`: a partial index filter cannot
// use $ne, and an index Mongo refuses is an index that silently does not exist.
orderSchema.index(
  { restaurantId: 1, table: 1, requestId: 1 },
  { unique: true, partialFilterExpression: { requestId: { $gt: "" } } }
);
orderSchema.index({ tableSessionId: 1 });

// Every channel creates orders through save(); stock comes off here, once
// per line. Never fails the order: a stock error is logged, the sale stands.
orderSchema.post("save", function depleteStock(doc) {
  if (!doc || doc.isDeleted) return;
  setImmediate(() => {
    require("../services/inventory")
      .depleteOrder(doc)
      .catch((err) => console.warn("[inventory] depletion failed for order", String(doc._id), err.message));
  });
});

// --- Website order indexes ---
// POS "new online orders" query + analytics rollups.
orderSchema.index({ storeId: 1, source: 1, createdAt: -1 });
orderSchema.index({ restaurantId: 1, source: 1, orderStatus: 1, createdAt: -1 });
// Unsettled platform dues for a restaurant, oldest first.
orderSchema.index({ restaurantId: 1, "platformCharge.status": 1, "platformCharge.chargedAt": 1 });
/**
 * Idempotency guard (§32): a repeated checkout POST carrying the same
 * idempotencyKey can never create a second order for the same restaurant.
 * Partial index so the millions of POS orders with an empty key are exempt.
 */
orderSchema.index(
  { restaurantId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $gt: "" } } }
);

/**
 * GLOBALLY UNIQUE order number (Module 3 §4).
 *
 * The application layer allocates `orderNumber` via the atomic
 * services/orderNumberService.js generator, but this partial unique index
 * is the ultimate safety net at the persistence layer: even if a bug
 * elsewhere in the codebase tried to save a duplicate, MongoDB would
 * refuse the second write with E11000. The `partialFilterExpression` on
 * non-empty strings is essential — historical POS orders with `""` as the
 * default must not all collide against each other.
 */
orderSchema.index(
  { orderNumber: 1 },
  { unique: true, partialFilterExpression: { orderNumber: { $gt: "" } } }
);


module.exports = mongoose.model("Order", orderSchema);
