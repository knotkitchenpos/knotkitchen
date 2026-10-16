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

const { round2 } = require("./money");

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// A line's quantity. A weighed dish keeps its fraction to the gram (1.8 stays
// 1.8, never 1 or 2); missing, zero, negative or nonsense reads as 1.
// Mirrors pos-frontend/src/utils/orderItems.js -- keep them in step.
const toQuantity = (q) => (round3(q) > 0 ? round3(q) : 1);

// How a quantity is printed: 2 -> "2", 1.8 -> "1.80", 0.375 -> "0.375".
const formatQty = (q) => {
  const n = round3(q);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0$/, "");
};

const resolveItemAmounts = (item = {}) => {
  const quantity = toQuantity(item.quantity);
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

module.exports = { resolveItemAmounts, round2, round3, toQuantity, formatQty };
