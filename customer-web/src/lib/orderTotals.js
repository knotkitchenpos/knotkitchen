/**
 * The cart's client-side ESTIMATE. The server prices the order again and the
 * payment is opened for its figure, so this only has to show the customer
 * what they are about to pay.
 *
 * `ordering.platformFee` is KnotKitchen's fee for paying online (rupees, GST
 * already included; 0 when the store has none). Website orders are always
 * paid online, so it is always added. It is not the restaurant's sale, so it
 * sits outside the restaurant's tax.
 *
 * `discount` is a coupon's value (Knot Eats offers); it comes off before tax.
 * The rest follows the server's one totals rule (services/price.computeTotals):
 * packaging is taxed with the food, delivery is added after tax, and free
 * delivery is judged on the subtotal before the discount. A threshold of 0
 * means "never free": the fee used to vanish for every store without one.
 */
export function cartEstimate({ subtotal, ordering, orderType, discount = 0 }) {
  const freeAbove = Number(ordering?.freeDeliveryAbove) || 0;
  const deliveryFee =
    orderType === "delivery" && !(freeAbove > 0 && subtotal >= freeAbove)
      ? Number(ordering?.deliveryFee || 0)
      : 0;
  const packaging = Number(ordering?.packagingFee || 0);
  const off = Math.min(subtotal, Math.max(0, Number(discount) || 0));
  const taxable = subtotal - off + packaging;
  const taxAmount = ordering?.taxInclusive ? 0 : taxable * (Number(ordering?.taxPercent || 0) / 100);
  const platformFee = Number(ordering?.platformFee || 0);
  return {
    deliveryFee,
    packaging,
    discount: off,
    taxAmount,
    platformFee,
    total: taxable + taxAmount + deliveryFee + platformFee,
  };
}

/**
 * What the customer was actually charged. The server reports it as
 * `totalPaid`; an order view without it (older server) is the bill plus the
 * platform fee, which is kept outside bills.totalWithTax.
 */
export function totalPaid(order) {
  if (order?.totalPaid != null) return Number(order.totalPaid);
  const sum = Number(order?.bills?.totalWithTax || 0) + Number(order?.bills?.platformFee || 0);
  return Math.round(sum * 100) / 100;
}

/**
 * The order type the cart uses: never one the store doesn't offer. A
 * pickup-less store is delivery whatever was picked or defaulted (a blocked
 * delivery is then explained, not swapped for pickup); otherwise a delivery
 * the customer can't have (no exact point, out of range) is pickup.
 */
export const cartOrderType = (wanted, ordering, deliveryBlocked) =>
  ordering?.pickupEnabled === false ? "delivery" : deliveryBlocked ? "pickup" : wanted;
