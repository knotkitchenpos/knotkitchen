const mongoose = require("mongoose");

/**
 * A website order waiting for its payment.
 *
 * The order the customer built is kept here, fully priced and validated, and
 * only becomes an Order once the gateway confirms the money moved. Nothing in
 * this collection reaches the POS, the kitchen or the reports: an abandoned
 * checkout is not an order anyone should see.
 *
 *   PENDING  gateway order opened, waiting for the customer to pay
 *   PLACING  payment confirmed, the Order is being written (claim lock)
 *   PLACED   the Order exists; `orderId` points at it
 */
const websiteCheckoutSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    storeId: { type: String, required: true, index: true },
    orderData: { type: mongoose.Schema.Types.Mixed, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    gatewayProvider: { type: String, default: "cashfree" },
    gatewayOrderId: { type: String, default: "", index: true },
    status: { type: String, enum: ["PENDING", "PLACING", "PLACED"], default: "PENDING", index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    transactionId: { type: String, default: "" },
    // Kept a day so a customer who paid and closed the tab can still be
    // placed when they come back; the gateway is asked again either way.
    expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 3600 * 1000) },
  },
  { timestamps: true },
);

websiteCheckoutSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { status: "PENDING" } });

module.exports = mongoose.models.WebsiteCheckout || mongoose.model("WebsiteCheckout", websiteCheckoutSchema);
