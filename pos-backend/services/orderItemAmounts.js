/**
 * What a line on a bill actually costs.
 *
 * The stored contract, stated explicitly on tableSessionItemSchema, is:
 *
 *     price = unit price at time of order
 *     total = the line total
 *
 * Table sessions have always honoured it. The POS order path did not: the
 * Redux cart keeps the LINE total in `price` (cartSlice writes
 * `price = pricePerQuantity * quantity`) and the whole cart was posted
 * straight through, so every POS order stored the line total in `price` and,
 * having no `total` field to send, left `total` at 0.
 *
 * Nothing complained. The consequence only showed up on the receipt, which
 * reads `total || price * quantity` -- with `total` at 0 that multiplied the
 * quantity in a second time, so a 100 item taken twice printed
 * "2 x Rs200 = Rs400" against a bill whose subtotal correctly said 200.
 *
 * Orders written before the fix cannot be distinguished by inspection, but
 * they CAN be distinguished by shape: a legacy POS line has `total` at 0,
 * and its `price` is the line total. That is the disambiguation below, so
 * bills printed for old orders come out right too.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const resolveItemAmounts = (item = {}) => {
  const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
  const storedTotal = Number(item.total || 0);

  // `total` present and positive -> written under the current contract, or by
  // a table session, which has always been correct.
  // `total` absent or zero -> a legacy POS line, whose `price` IS the line
  // total. Either way this is the amount actually charged for the line.
  const lineTotal = storedTotal > 0 ? storedTotal : Number(item.price || 0);

  return {
    quantity,
    unitPrice: round2(lineTotal / quantity),
    lineTotal: round2(lineTotal),
  };
};

module.exports = { resolveItemAmounts, round2 };
