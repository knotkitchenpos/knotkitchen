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

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const toOrderItems = (cart = []) =>
  (Array.isArray(cart) ? cart : []).map((item) => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
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
export const itemExtras = (item = {}) => {
  const source =
    Array.isArray(item.modifiers) && item.modifiers.length
      ? item.modifiers
      : [...(item.addons || []), ...(item.modifierSelections || [])];

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
export const itemDisplayName = (item = {}) =>
  String(item?.name || "").replace(/\s*\(\+\s*[^)]*\)\s*$/, "").trim();

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
  const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
  const storedTotal = Number(item.total || 0);
  const lineTotal = storedTotal > 0 ? storedTotal : Number(item.price || 0);

  return {
    quantity,
    unitPrice: round2(lineTotal / quantity),
    lineTotal: round2(lineTotal),
  };
};
