/**
 * The cart's client-side ESTIMATE. The server prices the order again and the
 * payment is opened for its figure, so this only has to show the customer
 * what they are about to pay.
 *
 * `ordering.platformFee` is KnotKitchen's fee for paying online (rupees, GST
 * already included; 0 when the store has none). Website orders are always
 * paid online, so it is always added. It is not the restaurant's sale, so it
 * sits outside the restaurant's tax.
 */
export function cartEstimate({ subtotal, ordering, orderType }) {
  const deliveryFee =
    orderType === "delivery" && subtotal < (ordering?.freeDeliveryAbove || 0)
      ? Number(ordering?.deliveryFee || 0)
      : 0;
  const packaging = Number(ordering?.packagingFee || 0);
  const taxable = subtotal + deliveryFee + packaging;
  const taxAmount = ordering?.taxInclusive ? 0 : taxable * (Number(ordering?.taxPercent || 0) / 100);
  const platformFee = Number(ordering?.platformFee || 0);
  return { deliveryFee, packaging, taxAmount, platformFee, total: taxable + taxAmount + platformFee };
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
