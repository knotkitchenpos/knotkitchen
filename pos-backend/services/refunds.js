/**
 * Refunds and voids: the money rules, kept pure so they are testable.
 *
 * An order's takings are bills.totalWithTax (or bills.total). A refund takes
 * some of that back and is recorded on order.refunds[]; the order stays
 * Completed until every rupee is returned, then it is Refunded. A cancelled
 * order was never paid, so it has nothing to refund.
 */
const { isCancelled, isRefunded } = require("../constants/orderStatus");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const orderTotal = (order) => round2(order?.bills?.totalWithTax || order?.bills?.total || 0);

const refundedTotal = (order) =>
  round2((order?.refunds || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0));

/** What is left to give back. */
const refundableAmount = (order) => {
  if (!order || isCancelled(order.orderStatus)) return 0;
  return Math.max(0, round2(orderTotal(order) - refundedTotal(order)));
};

/** Takings after refunds: what reports should count. */
const netAmount = (order) => {
  if (!order || isCancelled(order.orderStatus)) return 0;
  if (isRefunded(order.orderStatus) && !refundedTotal(order)) return 0; // refunded before refunds[] existed
  return Math.max(0, round2(orderTotal(order) - refundedTotal(order)));
};

/**
 * Check a refund request. Returns { ok, amount, message }.
 * A blank amount means "everything that is left".
 */
const validateRefund = (order, { amount, reason } = {}) => {
  const left = refundableAmount(order);
  if (!order || left <= 0) return { ok: false, message: "There is nothing left to refund on this order." };
  const text = String(reason || "").trim();
  if (text.length < 3) return { ok: false, message: "A reason is required." };
  const wanted = amount === undefined || amount === null || amount === "" ? left : round2(amount);
  if (!(wanted > 0)) return { ok: false, message: "Refund amount must be more than zero." };
  if (wanted > left) return { ok: false, message: `Only ₹${left.toFixed(2)} is left to refund.` };
  return { ok: true, amount: wanted, reason: text.slice(0, 200), full: wanted >= left };
};

/** Was this order paid through the payment gateway (so a refund must go back through it)? */
const paidViaGateway = (order) => {
  const method = String(order?.payments?.[0]?.method || order?.paymentMethod || "").trim().toLowerCase();
  if (order?.paymentData?.gatewayOrderId) return true;
  return ["online", "payment gateway", "paymentlink", "payment_link", "link", "gateway"].includes(method);
};

/**
 * The merchant order id Cashfree knows the payment by. On the order since
 * this feature; older orders are looked up through what settled them.
 */
const gatewayOrderIdFor = async (order) => {
  if (order?.paymentData?.gatewayOrderId) return order.paymentData.gatewayOrderId;
  const mongoose = require("mongoose");
  if (mongoose.connection?.readyState !== 1) return "";
  if (order?.tableSessionId) {
    const TableSession = require("../models/tableSessionModel");
    const s = await TableSession.findById(order.tableSessionId).select("payment.gatewayOrderId").lean();
    if (s?.payment?.gatewayOrderId) return s.payment.gatewayOrderId;
  }
  const PaymentLink = require("../models/paymentLinkModel");
  const link = await PaymentLink.findOne({ orderId: order._id, gatewayOrderId: { $ne: "" } }).select("gatewayOrderId").lean();
  if (link?.gatewayOrderId) return link.gatewayOrderId;
  const WebsiteCheckout = require("../models/websiteCheckoutModel");
  const co = await WebsiteCheckout.findOne({ orderId: order._id, gatewayOrderId: { $ne: "" } }).select("gatewayOrderId").lean();
  if (co?.gatewayOrderId) return co.gatewayOrderId;
  return "";
};

/**
 * Send the refund to the gateway the store is paid through.
 * @returns {{ provider, refundId, cfRefundId, status }}
 * Throws a readable error when the store's gateway is missing or the
 * gateway refuses; the caller records nothing in that case.
 */
const refundThroughGateway = async (order, { amount, reason, sequence }) => {
  const { resolveGateway } = require("./paymentGateway");
  const gw = await resolveGateway({ restaurantId: order.restaurantId, storeId: order.storeId });
  if (!gw.enabled || gw.provider !== "cashfree") {
    const err = new Error("This order was paid online but the store's Cashfree gateway is not configured, so it cannot be refunded from here.");
    err.status = 409;
    throw err;
  }
  const gatewayOrderId = await gatewayOrderIdFor(order);
  if (!gatewayOrderId) {
    const err = new Error("The gateway order for this payment could not be found, so it cannot be refunded automatically.");
    err.status = 409;
    throw err;
  }
  const cashfree = require("./gateways/cashfree");
  try {
    const result = await cashfree.createRefund({
      appId: gw.keyId,
      secretKey: gw.secret,
      environment: gw.environment,
      orderId: gatewayOrderId,
      refundId: `rf_${String(order._id).slice(-10)}_${sequence}`,
      amount,
      note: reason,
    });
    return { provider: "cashfree", ...result };
  } catch (e) {
    const err = new Error(`Cashfree did not accept the refund: ${e.message}`);
    err.status = 502;
    throw err;
  }
};

module.exports = { orderTotal, refundedTotal, refundableAmount, netAmount, validateRefund, paidViaGateway, gatewayOrderIdFor, refundThroughGateway };
