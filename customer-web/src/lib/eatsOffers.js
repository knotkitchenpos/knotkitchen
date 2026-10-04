/**
 * Knot Eats offers in the cart: the store's active website coupons, as the
 * server lists them (§7.4: { code, type, value, minOrderAmount, channels }).
 *
 * Only an ESTIMATE, like the rest of the cart. The server applies the code
 * with the same rule (orderPricingService.isRuleEligible) and its figure is
 * the one charged; these mirror it so the cart rarely disagrees.
 *
 * Pure: no JSX, no storage, tested with plain Node.
 */

const round2 = (n) => Math.round(n * 100) / 100;
// "pickup" in the cart is a collection order on the server.
const channelOf = (orderType) => (orderType === "delivery" ? "delivery" : "collection");

export function couponApplies(o, { subtotal, orderType }) {
  if (!o) return false;
  if (o.channels?.[channelOf(orderType)] === false) return false;
  return subtotal >= (Number(o.minOrderAmount) || 0);
}

/** Rupees off a subtotal; never more than the subtotal, as on the server. */
export function couponDiscount(o, subtotal) {
  const value = Number(o?.value) || 0;
  const off = o?.type === "percent" ? round2((subtotal * value) / 100) : value;
  return Math.min(subtotal, Math.max(0, off));
}

/** The offer worth the most for this cart, or null. Ties keep the server's order. */
export function bestCoupon(offers, { subtotal, orderType }) {
  let best = null;
  let bestOff = 0;
  for (const o of offers || []) {
    if (!couponApplies(o, { subtotal, orderType })) continue;
    const off = couponDiscount(o, subtotal);
    if (off > bestOff) {
      best = o;
      bestOff = off;
    }
  }
  return best;
}

/** Why a chosen offer is not applied right now, in the customer's words ("" when it is). */
export function couponNote(o, { subtotal, orderType }) {
  if (!o || couponApplies(o, { subtotal, orderType })) return "";
  if (o.channels?.[channelOf(orderType)] === false) {
    return `${o.code} is for ${orderType === "delivery" ? "pickup" : "delivery"} orders only`;
  }
  return `${o.code} needs ₹${Number(o.minOrderAmount) || 0}+`;
}
