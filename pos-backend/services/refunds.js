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

module.exports = { orderTotal, refundedTotal, refundableAmount, netAmount, validateRefund };
