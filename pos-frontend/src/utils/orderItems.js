/**
 * Turn the Redux cart into the shape the API stores.
 *
 * The cart and the database disagree about what `price` means, and the whole
 * cart was being posted straight through:
 *
 *   cart     price = the LINE total (cartSlice writes pricePerQuantity x quantity)
 *   database price = the UNIT price, with `total` holding the line
 *                    (stated on tableSessionItemSchema; table sessions have
 *                     always honoured it)
 *
 * So every POS order stored the line total in `price` and, with no `total`
 * field in the cart to send, left `total` at 0. The receipt then rebuilt the
 * line as `total || price * quantity`, multiplying the quantity in a second
 * time: a 100 item taken twice printed "2 x Rs200 = Rs400" on a bill whose
 * subtotal correctly said 200.
 */

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// A line's quantity. A weighed dish keeps its fraction to the gram (1.8 stays
// 1.8, never 1 or 2); missing, zero, negative or nonsense reads as 1.
// Mirrors pos-backend/services/orderItemAmounts.js -- keep them in step.
export const toQuantity = (q) => (round3(q) > 0 ? round3(q) : 1);

// How a quantity is printed: 2 -> "2", 1.8 -> "1.80", 0.375 -> "0.375".
export const formatQty = (q) => {
  const n = round3(q);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0$/, "");
};

// A quantity the biller typed ("1.80"), or null. Read from a text box: a
// type=number box snaps 1.80 to its step. At most 999.999 (the server caps a line at 1000).
export const typedQty = (t) => (/^\d{1,3}(\.\d{1,3})?$/.test(String(t).trim()) && Number(t) > 0 ? Number(t) : null);

export const toOrderItems = (cart = []) =>
  (Array.isArray(cart) ? cart : []).map((item) => {
    const quantity = toQuantity(item.quantity);
    // `item.price` is the line total. `pricePerQuantity` is the unit, but fall
    // back to dividing for a cart restored from a held order saved before it.
    const lineTotal = Number(item.price || 0);
    const unitPrice = Number(item.pricePerQuantity) || lineTotal / quantity;

    return {
      ...item,
      quantity,
      price: round2(unitPrice),
      total: round2(lineTotal),
    };
  });

export default toOrderItems;

/**
 * The extras on a line, as rows in their own right.
 *
 * Mirrors `pos-backend/services/orderItemExtras.js`, which carries the full
 * reasoning -- keep them in step. The short version: the same extras arrive
 * under three field names, and on a POS line two of them hold the SAME
 * entries, so concatenating all three prints every extra twice. `modifiers`
 * wins where it exists. The variant is dropped: it is part of what the dish
 * is, it is priced into the base, and it is already printed beside the name.
 */
// A plain dish carries `modifierSelections: {}` (an object, the shape the
// server takes for "nothing chosen"). Spreading that threw, and only offline:
// online the invoice shows the server's copy, offline it shows the cart's own.
const list = (v) => (Array.isArray(v) ? v : []);

export const itemExtras = (item = {}) => {
  const source =
    Array.isArray(item.modifiers) && item.modifiers.length
      ? item.modifiers
      : [...list(item.addons), ...list(item.modifierSelections)];

  const variantName = String(item.variant?.name || "").trim().toLowerCase();

  // Orders taken before the till stopped composing the name stored a price
  // for every extra and an EMPTY name, because the controller read `name`
  // while the till sent `optionName`. The names are still in the product
  // title those orders carry, which is the only place left to read them.
  const tail = String(item.name || "").match(/\(\+\s*([^)]*)\)\s*$/);
  const salvaged =
    tail && source.some((e) => !String(e?.name || e?.optionName || "").trim())
      ? tail[1].split(",").map((t) => t.trim()).filter(Boolean)
      : [];

  return source
    .map((entry, i) => {
      const name = String(entry?.name || entry?.optionName || salvaged[i] || "").trim();
      if (!name) return null;
      return {
        name,
        price: round2(entry?.price),
        quantity: Math.max(1, Math.floor(Number(entry?.quantity) || 1)),
      };
    })
    .filter(Boolean)
    .filter((e) => !variantName || e.name.toLowerCase() !== variantName);
};

/**
 * A line's product name, without the extras an older till baked into it.
 *
 * Those orders keep their composed title -- it is the only record of what the
 * extras were called. Printing it AND the rows salvaged from it would list
 * every extra twice on the same bill.
 */
/**
 * A line the kitchen or the till struck off. It stays on the order as a
 * record, but it was not sold: bills, receipts and kitchen tickets skip it.
 */
export const isCancelledItem = (item = {}) => String(item?.status || "").toLowerCase() === "cancelled";

/** The lines that were actually sold: what a bill prints. */
export const billableItems = (items = []) => (Array.isArray(items) ? items : []).filter((i) => !isCancelledItem(i));

/** N069: when a line joined its order after the first minute (a later round), else null. A line's ObjectId starts with the second it was made. */
export const addedAfterOpening = (item, order) => {
  const at = parseInt(String(item?._id || "").slice(0, 8), 16) * 1000;
  return at && order?.createdAt && at - new Date(order.createdAt).getTime() > 60_000 ? new Date(at) : null;
};

export const itemDisplayName = (item = {}) => {
  const base = String(item?.name || "").replace(/\s*\(\+\s*[^)]*\)\s*$/, "").trim();
  // Till and table lines carry the variant in the name ("Pizza (Large)");
  // website lines keep it only in `variant`, and itemExtras drops it there,
  // so the kitchen never saw the size. Mirrors pos-backend/services/orderItemExtras.js.
  const v = String(item?.variant?.name || "").trim();
  return v && !base.toLowerCase().includes(`(${v.toLowerCase()})`) ? `${base} (${v})` : base;
};

/**
 * What a SAVED order line actually cost.
 *
 * Mirrors `pos-backend/services/orderItemAmounts.js` -- keep them in step.
 *
 * Orders written before `toOrderItems` existed put the line total in `price`
 * and left `total` at 0, and they cannot be told apart by inspection. They can
 * by shape: `total` at zero means the row is legacy and its `price` is the
 * line. That keeps receipts for old orders correct too.
 */
export const resolveItemAmounts = (item = {}) => {
  const quantity = toQuantity(item.quantity);
  const storedTotal = Number(item.total || 0);
  const lineTotal = storedTotal > 0 ? storedTotal : Number(item.price || 0);

  return {
    quantity,
    unitPrice: round2(lineTotal / quantity),
    lineTotal: round2(lineTotal),
  };
};
