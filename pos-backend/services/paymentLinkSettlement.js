/**
 * Settling a payment link from a gateway callback.
 *
 * Lifted out of paymentController when Razorpay was removed: the controller
 * was Razorpay end to end (its create-order and verify-payment endpoints were
 * dead code the POS never called, and its webhook was Razorpay's alone), but
 * THIS is gateway-agnostic and is what a webhook needs in order to finish a
 * link the customer's browser never came back from.
 *
 * It is idempotent by construction -- a unique index on the ledger entry, and
 * every write guarded on "not already paid" -- because the browser and the
 * webhook race each other by design and either may win.
 */

const { COMPLETED } = require("../constants/orderStatus");
const { fireAutoEBill } = require("./eBillService");
const { fireOrderCharge } = require("./orderCharge");
const { normalizePaymentMethod, toOrderPaymentMethod } = require("../constants/paymentMethods");
const Order = require("../models/orderModel");
const Bill = require("../models/billModel");
const PaymentLink = require("../models/paymentLinkModel");
const PaymentTransaction = require("../models/paymentTransactionModel");

const finalizePaymentLinkFromGateway = async ({
  gatewayOrderId,
  gatewayPaymentId,
  amount,
  method = "ONLINE",
}) => {
  if (!gatewayOrderId) return { skipped: "no-gateway-order" };

  const link = await PaymentLink.findOne({
    gatewayOrderId,
    isDeleted: { $ne: true },
  });
  // Payment isn't tied to a POS payment link — nothing to do.
  if (!link) return { skipped: "no-matching-link" };

  // Already fully paid: another callback/webhook won. Idempotent no-op.
  if (link.status === "PAID") return { skipped: "already-paid", link };

  // Server-side amount comparison. The link.amount was locked at creation
  // time from the Order's own bill. If the gateway reports a different
  // amount (partial capture, currency mismatch), refuse to finalise —
  // this prevents an under-payment silently marking the order as paid.
  const lockedAmount = Number(link.amount);
  const gatewayAmount = Number(amount || 0);
  if (gatewayAmount > 0 && Math.abs(gatewayAmount - lockedAmount) > 0.5) {
    console.warn(
      `[payment-link] amount mismatch: link=${lockedAmount} gateway=${gatewayAmount} link=${link._id}`,
    );
    // We intentionally still mark as paid IF the gateway paid >= locked
    // (customer overpaid — bank problem, not ours). Under-payment leaves
    // the link pending for the operator to investigate.
    if (gatewayAmount < lockedAmount) return { skipped: "underpaid", link };
  }

  const idempotencyKey =
    gatewayPaymentId
      ? `pay-link-${link._id}-${gatewayPaymentId}`
      : `pay-link-${link._id}-${gatewayOrderId}`;

  // Ledger entry — idempotent via unique index on PaymentTransaction.
  let txn = null;
  try {
    const txnDocs = await PaymentTransaction.create([
      {
        restaurantId: link.restaurantId,
        outletId: link.outletId,
        billId: link.billId,
        tableSessionId: link.tableSessionId,
        customerId: link.customerId,
        paymentLinkId: link._id,
        // `method` arrives as the gateway's own instrument name
        // ("netbanking", "card", "upi", ...) or a provider name, neither of
        // which the model's enum accepts -- those writes threw
        // ValidationError, caught by the caller and logged, so netbanking
        // payments silently never reconciled. Normalise before storing.
        method: normalizePaymentMethod(method),
        amount: lockedAmount,
        status: "PAID",
        provider: "SECURE_LINK",
        transactionId: gatewayPaymentId || `webhook_${Date.now()}`,
        gatewayOrderId,
        gatewayPaymentId: gatewayPaymentId || "",
        idempotencyKey,
        paidAt: new Date(),
      },
    ]);
    txn = txnDocs[0];
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Duplicate — another caller already recorded this exact payment.
    // Continue so we still finalise the link/order/bill if they weren't
    // updated for some reason.
  }

  // Flip PaymentLink → PAID (guarded so two concurrent callers don't
  // over-write each other).
  const updatedLink = await PaymentLink.findOneAndUpdate(
    { _id: link._id, status: { $ne: "PAID" } },
    {
      $set: {
        status: "PAID",
        paidAmount: lockedAmount,
        paidAt: new Date(),
      },
    },
    { new: true },
  );

  // Mark the associated Bill (if any) as PAID.
  if (link.billId) {
    await Bill.findOneAndUpdate(
      { _id: link.billId, restaurantId: link.restaurantId, status: { $ne: "PAID" } },
      { $set: { status: "PAID", paidAmount: lockedAmount, dueAmount: 0, settledAt: new Date() } },
    );
  }

  // Finally, update the Order to Completed + record the payment. The
  // guard on `payments.status != paid` prevents double-appending.
  let updatedOrder = null;
  if (link.orderId) {
    updatedOrder = await Order.findOneAndUpdate(
      {
        _id: link.orderId,
        restaurantId: link.restaurantId,
        "payments.status": { $ne: "paid" },
      },
      {
        $set: {
          orderStatus: COMPLETED,
          paymentMethod: normalizePaymentMethod(method),
        },
        $push: {
          payments: {
            // Order.payments[].method is its own narrower lower-case enum, so
            // the gateway's instrument name has to be mapped, not passed on.
            method: toOrderPaymentMethod(method),
            amount: lockedAmount,
            status: "paid",
            transactionId: gatewayPaymentId || `webhook_${Date.now()}`,
          },
          timeline: {
            status: "Completed",
            timestamp: new Date(),
            user: "Webhook",
          },
        },
      },
      { new: true },
    );
  }

  // A pay-by-link customer settles here and NOWHERE else -- this writes
  // Completed straight onto the order rather than going through
  // updateOrderStatus, so without this they would never get an e-bill.
  //
  // Guarded on updatedOrder: the findOneAndUpdate above only matches while the
  // order is unpaid, so a webhook redelivery returns null here and cannot send
  // a second one. (eBillSentAt makes that safe twice over.)
  if (updatedOrder) fireAutoEBill({ orderId: updatedOrder._id });
  if (updatedOrder) fireOrderCharge(updatedOrder._id);

  return { link: updatedLink || link, txn, order: updatedOrder };
};

module.exports = { finalizePaymentLinkFromGateway };
