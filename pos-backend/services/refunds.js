/**
 * Refunds: the money rules, kept pure where they can be.
 *
 * The rule, by how the order was paid:
 *
 *   cash      never refunded from here: the counter hands it back.
 *   offline   UPI, card or wallet taken at the counter. KnotKitchen did not
 *             move that money, so it cannot move it back.
 *   gateway   paid through Cashfree. Refundable once the order is CANCELLED,
 *             through Cashfree's refund API, for what was paid less what has
 *             already gone back.
 *
 * Cancelling and refunding are two actions. A cancelled gateway order is
 * NOT_REFUNDED until Cashfree confirms; REFUND_PENDING while Cashfree is
 * processing; REFUNDED only on Cashfree's word; REFUND_FAILED when Cashfree
 * refused, or the attempt could not be confirmed.
 *
 * Nothing here trusts a browser: the amount is what the payment record says
 * was paid, the gateway order id is the one stored when the payment settled,
 * and the status is what Cashfree answers.
 */
const { isCancelled, isRefunded, isSettled } = require("../constants/orderStatus");
const { round2 } = require("./money");

const REFUND_STATUS = Object.freeze({
  NOT_APPLICABLE: "NOT_APPLICABLE",
  NOT_REFUNDED: "NOT_REFUNDED",
  REFUND_PENDING: "REFUND_PENDING",
  REFUNDED: "REFUNDED",
  REFUND_FAILED: "REFUND_FAILED",
});

const PAYMENT_KIND = Object.freeze({ CASH: "cash", OFFLINE: "offline", GATEWAY: "gateway", NONE: "none" });
const PAYMENT_KIND_LABELS = Object.freeze({
  cash: "Cash",
  offline: "UPI / Offline Payment",
  gateway: "Gateway Payment",
  none: "Unpaid",
});

const GATEWAY_METHODS = ["online", "payment gateway", "paymentlink", "payment_link", "link", "gateway"];

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });

const methodOf = (order) =>
  String(order?.payments?.[0]?.method || order?.paymentMethod || "").trim().toLowerCase();

/** cash | offline | gateway | none, from the payment record. */
const paymentKindOf = (order) => {
  if (order?.paymentData?.gatewayOrderId) return PAYMENT_KIND.GATEWAY;
  const m = methodOf(order);
  if (!m) return PAYMENT_KIND.NONE;
  if (GATEWAY_METHODS.includes(m)) return PAYMENT_KIND.GATEWAY;
  if (m === "cash") return PAYMENT_KIND.CASH;
  return PAYMENT_KIND.OFFLINE;
};

/** Was this order paid through the payment gateway (so a refund must go back through it)? */
const paidViaGateway = (order) => paymentKindOf(order) === PAYMENT_KIND.GATEWAY;

const isPaidPayment = (p) => String(p?.status || "").toLowerCase() === "paid";

/** Did money actually change hands? The payment record says so; a settled status is the older way of saying it. */
const wasPaid = (order) => {
  if ((order?.payments || []).some(isPaidPayment)) return true;
  if (paymentKindOf(order) === PAYMENT_KIND.NONE) return false;
  return isSettled(order?.orderStatus) || isRefunded(order?.orderStatus) || Boolean(order?.completedAt);
};

const orderTotal = (order) => round2(order?.bills?.totalWithTax || order?.bills?.total || 0);

/** What was actually paid: the payment lines, or the bill when there are none. */
const paidAmount = (order) => {
  const lines = (order?.payments || []).filter(isPaidPayment);
  const sum = round2(lines.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  return sum > 0 ? sum : orderTotal(order);
};

// An entry written before the lifecycle existed carries no status; it was
// recorded only after the money went back, so it counts as SUCCESS.
const entryStatus = (r) => String(r?.status || r?.gateway?.status || "SUCCESS").toUpperCase();
const isSuccessEntry = (r) => entryStatus(r) === "SUCCESS";
const isPendingEntry = (r) => ["PENDING", "ONHOLD"].includes(entryStatus(r));

const refundedTotal = (order) =>
  round2((order?.refunds || []).filter(isSuccessEntry).reduce((sum, r) => sum + (Number(r.amount) || 0), 0));

const pendingTotal = (order) =>
  round2((order?.refunds || []).filter(isPendingEntry).reduce((sum, r) => sum + (Number(r.amount) || 0), 0));

/** What is left to give back through the gateway. Zero unless cancelled, gateway-paid and paid. */
const refundableAmount = (order) => {
  if (!order || !isCancelled(order.orderStatus)) return 0;
  if (paymentKindOf(order) !== PAYMENT_KIND.GATEWAY || !wasPaid(order)) return 0;
  return Math.max(0, round2(paidAmount(order) - refundedTotal(order) - pendingTotal(order)));
};

/** Takings after refunds: what reports should count. */
const netAmount = (order) => {
  if (!order || isCancelled(order.orderStatus)) return 0;
  if (isRefunded(order.orderStatus) && !refundedTotal(order)) return 0; // refunded before refunds[] existed
  return Math.max(0, round2(orderTotal(order) - refundedTotal(order)));
};

/** The lifecycle state, derived from the payment record and the attempts on file. */
const refundStatusOf = (order) => {
  if (!order) return REFUND_STATUS.NOT_APPLICABLE;
  if (paymentKindOf(order) !== PAYMENT_KIND.GATEWAY || !wasPaid(order)) return REFUND_STATUS.NOT_APPLICABLE;
  const entries = order.refunds || [];
  if (entries.some(isPendingEntry)) return REFUND_STATUS.REFUND_PENDING;
  const back = refundedTotal(order);
  if (back > 0 && back >= paidAmount(order) - 0.005) return REFUND_STATUS.REFUNDED;
  if (isRefunded(order.orderStatus)) return REFUND_STATUS.REFUNDED;
  const last = entries[entries.length - 1];
  if (last && entryStatus(last) === "FAILED") return REFUND_STATUS.REFUND_FAILED;
  return REFUND_STATUS.NOT_REFUNDED;
};

/**
 * May this order be refunded now? Every rule the backend enforces, in order,
 * each with the message the operator sees. `{ ok: true, amount }` when it may.
 */
const refundEligibility = (order) => {
  const no = (status, code, message) => ({ ok: false, status, code, message });
  if (!order) return no(404, "ORDER_NOT_FOUND", "Order not found!");
  const kind = paymentKindOf(order);
  if (kind === PAYMENT_KIND.CASH) {
    return no(409, "PAYMENT_METHOD_CASH", "Paid in cash: hand the money back at the counter. There is nothing to refund through Cashfree.");
  }
  if (kind === PAYMENT_KIND.OFFLINE) {
    return no(409, "PAYMENT_OFFLINE", "Paid by UPI or card at the counter, not through Cashfree, so there is nothing to refund online.");
  }
  if (kind === PAYMENT_KIND.NONE || !wasPaid(order)) {
    return no(409, "PAYMENT_NOT_SUCCESSFUL", "This order was not paid, so there is nothing to refund.");
  }
  if (!isCancelled(order.orderStatus)) {
    return no(409, "ORDER_NOT_CANCELLED", "Cancel the order first. A refund is only offered on a cancelled order.");
  }
  const status = refundStatusOf(order);
  if (status === REFUND_STATUS.REFUNDED) return no(409, "ALREADY_REFUNDED", "This order has already been refunded.");
  if (status === REFUND_STATUS.REFUND_PENDING) return no(409, "REFUND_PENDING", "A refund is already in progress with Cashfree.");
  const last = (order.refunds || [])[order.refunds.length - 1];
  if (status === REFUND_STATUS.REFUND_FAILED && last && last.retrySafe === false) {
    return no(409, "REFUND_UNCONFIRMED", "The last attempt could not be confirmed with Cashfree. Check its status before trying again.");
  }
  const amount = refundableAmount(order);
  if (!(amount > 0)) return no(409, "NOTHING_LEFT", "There is nothing left to refund on this order.");
  return { ok: true, amount };
};

/**
 * The merchant order id Cashfree knows the payment by. Stored on the order
 * when the payment settled; older orders are looked up through what settled
 * them. Never reconstructed from a display id.
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
  const link = await PaymentLink.findOne({ orderId: order._id, gatewayOrderId: { $gt: "" } }).select("gatewayOrderId").lean();
  if (link?.gatewayOrderId) return link.gatewayOrderId;
  const WebsiteCheckout = require("../models/websiteCheckoutModel");
  const co = await WebsiteCheckout.findOne({ orderId: order._id, gatewayOrderId: { $gt: "" } }).select("gatewayOrderId").lean();
  if (co?.gatewayOrderId) return co.gatewayOrderId;
  return "";
};

/** The store's Cashfree credentials and the gateway order, or a readable 409. */
const gatewayFor = async (order) => {
  const { resolveGateway } = require("./paymentGateway");
  const gw = await resolveGateway({ restaurantId: order.restaurantId, storeId: order.storeId });
  if (!gw.enabled || gw.provider !== "cashfree") {
    throw httpError(409, "This order was paid online but the store's Cashfree gateway is not configured, so it cannot be refunded from here.", "GATEWAY_NOT_CONFIGURED");
  }
  const gatewayOrderId = await gatewayOrderIdFor(order);
  if (!gatewayOrderId) {
    throw httpError(409, "The gateway order for this payment could not be found, so it cannot be refunded automatically.", "GATEWAY_ORDER_MISSING");
  }
  return { gw, gatewayOrderId };
};

/**
 * Send one refund to Cashfree. `refundId` is ours and unique per attempt;
 * Cashfree answers a repeat of the same id with the existing refund, which
 * is what makes a retried request safe.
 * @returns {{ refundId, cfRefundId, status, amount }}
 */
const refundThroughGateway = async (order, { amount, note, refundId }) => {
  const { gw, gatewayOrderId } = await gatewayFor(order);
  const cashfree = require("./gateways/cashfree");
  return cashfree.createRefund({
    appId: gw.keyId,
    secretKey: gw.secret,
    environment: gw.environment,
    orderId: gatewayOrderId,
    refundId,
    amount,
    note,
  });
};

/** Ask Cashfree what became of one refund. */
const fetchRefundFromGateway = async (order, refundId) => {
  const { gw, gatewayOrderId } = await gatewayFor(order);
  const cashfree = require("./gateways/cashfree");
  return cashfree.getRefund({
    appId: gw.keyId,
    secretKey: gw.secret,
    environment: gw.environment,
    orderId: gatewayOrderId,
    refundId,
  });
};

/**
 * Cashfree's answer, written onto the attempt. Only SUCCESS marks money as
 * returned; PENDING and ONHOLD stay open; CANCELLED and FAILED close the
 * attempt as failed with the reason on record.
 */
const applyGatewayResult = (entry, result) => {
  const status = String(result?.status || "").toUpperCase();
  entry.gateway = entry.gateway || {};
  entry.gateway.provider = "cashfree";
  if (result?.refundId) entry.gateway.refundId = result.refundId;
  if (result?.cfRefundId) entry.gateway.cfRefundId = result.cfRefundId;
  entry.gateway.status = status;
  if (status === "SUCCESS") {
    entry.status = "SUCCESS";
    entry.completedAt = new Date();
    entry.failureReason = "";
  } else if (status === "PENDING" || status === "ONHOLD") {
    entry.status = "PENDING";
  } else {
    entry.status = "FAILED";
    entry.completedAt = new Date();
    entry.failureReason = result?.failureReason || (status === "CANCELLED" ? "Cashfree cancelled the refund." : `Cashfree reported ${status || "an unknown status"}.`);
    entry.retrySafe = result?.retrySafe !== false;
  }
  return entry;
};

/**
 * The request to Cashfree did not come back clean. Decide what the attempt
 * is: a refusal (nothing was created, retry is safe), a timeout that Cashfree
 * may still have acted on (ask it), or a store without a gateway.
 */
const reconcileFailedAttempt = async (order, refundId, err) => {
  if (err?.retryable) {
    // The request may or may not have reached Cashfree. Ask before deciding.
    try {
      return await fetchRefundFromGateway(order, refundId);
    } catch (lookup) {
      if (lookup?.status === 404) {
        return { status: "FAILED", failureReason: `Cashfree did not receive the request: ${err.message}`, retrySafe: true };
      }
      return { status: "FAILED", failureReason: `Could not confirm the refund with Cashfree: ${err.message}`, retrySafe: false };
    }
  }
  return { status: "FAILED", failureReason: err?.message || "Cashfree refused the refund.", retrySafe: true };
};

/**
 * Refund a cancelled, gateway-paid order through Cashfree.
 *
 * One attempt at a time: the claim is a conditional update on the stored
 * refundStatus, so a second click that races the first finds it already
 * pending and is refused before Cashfree is asked twice. The attempt is on
 * record BEFORE Cashfree is called, so a crash mid-flight leaves a pending
 * entry that `syncRefund` can reconcile, never a refund nobody knows about.
 */
const refundCancelledOrder = async (order, { user, reason, amount: asked } = {}) => {
  const check = refundEligibility(order);
  if (!check.ok) throw httpError(check.status, check.message, check.code);

  // The owner may refund part of it: any amount up to what is left. Left out,
  // it is everything that is left. Never more, whatever the till sends.
  let amount = check.amount;
  if (asked !== undefined && asked !== null && asked !== "") {
    const n = round2(Number(asked));
    if (!Number.isFinite(n) || n <= 0 || n > check.amount + 0.005) {
      throw httpError(400, `Enter an amount between ₹0.01 and ₹${check.amount.toFixed(2)}.`, "REFUND_AMOUNT_INVALID");
    }
    amount = Math.min(n, check.amount);
  }

  const Order = require("../models/orderModel");
  const claimed = await Order.findOneAndUpdate(
    {
      _id: order._id,
      refundStatus: { $in: [REFUND_STATUS.NOT_REFUNDED, REFUND_STATUS.REFUND_FAILED, "", null] },
    },
    { $set: { refundStatus: REFUND_STATUS.REFUND_PENDING } },
  );
  if (!claimed) throw httpError(409, "A refund for this order is already in progress.", "DUPLICATE_REFUND");

  order.refunds = order.refunds || [];
  const sequence = order.refunds.length + 1;
  const refundId = `rf_${String(order._id).slice(-10)}_${sequence}`;
  // No reason needed: the order was cancelled with one, and that is the note.
  const note = String(reason || order.cancelReason || "Order cancelled").trim().slice(0, 100);
  const now = new Date();
  order.refunds.push({
    amount,
    reason: note,
    refundedBy: user?._id,
    refundedByName: user?.name || "POS",
    requestedAt: now,
    refundedAt: now,
    channel: "gateway",
    status: "PENDING",
    gateway: { provider: "cashfree", refundId, cfRefundId: "", status: "" },
  });
  order.refundStatus = REFUND_STATUS.REFUND_PENDING;
  await order.save();
  const entry = order.refunds[order.refunds.length - 1];

  let result;
  try {
    result = await refundThroughGateway(order, { amount, note, refundId });
  } catch (err) {
    result = await reconcileFailedAttempt(order, refundId, err);
  }
  applyGatewayResult(entry, result);
  order.refundStatus = refundStatusOf(order);
  order.timeline = order.timeline || [];
  order.timeline.push({
    status: `Refund ₹${amount.toFixed(2)} ${entry.status.toLowerCase()}`,
    timestamp: new Date(),
    user: user?.name || "POS",
  });
  await order.save();
  return { order, entry, amount };
};

/**
 * Bring an open attempt up to date from Cashfree: the pending one, or the
 * last one that could not be confirmed. Used by the operator's "check
 * status", and by the refund webhook after its signature is verified.
 */
const syncRefund = async (order, { refundId } = {}) => {
  const entries = order?.refunds || [];
  const target = refundId
    ? entries.find((r) => r?.gateway?.refundId === refundId)
    : [...entries].reverse().find((r) => isPendingEntry(r) || (entryStatus(r) === "FAILED" && r.retrySafe === false));
  if (!target || !target.gateway?.refundId) return { order, entry: null, changed: false };
  let result;
  try {
    result = await fetchRefundFromGateway(order, target.gateway.refundId);
  } catch (err) {
    if (err?.status === 404) {
      result = { status: "FAILED", failureReason: "Cashfree has no record of this refund.", retrySafe: true };
    } else {
      throw httpError(502, `Could not reach Cashfree to check the refund: ${err.message}`, "GATEWAY_UNAVAILABLE");
    }
  }
  const before = `${target.status}|${target.gateway.status}`;
  applyGatewayResult(target, result);
  order.refundStatus = refundStatusOf(order);
  await order.save();
  return { order, entry: target, changed: before !== `${target.status}|${target.gateway.status}` };
};

/** What a screen needs alongside the order: the kind of payment and where the refund stands. */
const refundView = (order) => {
  const kind = paymentKindOf(order);
  return {
    paymentKind: kind,
    paymentKindLabel: PAYMENT_KIND_LABELS[kind],
    paid: wasPaid(order),
    refundStatus: refundStatusOf(order),
    refundableAmount: refundableAmount(order),
    refundedTotal: refundedTotal(order),
  };
};

module.exports = {
  REFUND_STATUS,
  PAYMENT_KIND,
  PAYMENT_KIND_LABELS,
  paymentKindOf,
  paidViaGateway,
  wasPaid,
  paidAmount,
  orderTotal,
  refundedTotal,
  refundableAmount,
  netAmount,
  refundStatusOf,
  refundEligibility,
  gatewayOrderIdFor,
  refundThroughGateway,
  applyGatewayResult,
  refundCancelledOrder,
  syncRefund,
  refundView,
};
