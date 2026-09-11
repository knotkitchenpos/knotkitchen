/**
 * The extras on an order line, as rows in their own right.
 *
 * A line's add-ons used to be flattened into the product name -- "Tandoori
 * Chicken Sandwich (+ Jeera Rice, Coke)" -- which cost the customer the one
 * thing they wanted to know, what each extra cost, and truncated to nothing on
 * any narrow column. They are rows now: name on the left, price on the right,
 * indented under the dish.
 *
 * ---------------------------------------------------------------------------
 * Why the shape needs deciding
 * ---------------------------------------------------------------------------
 * The same extras arrive under three field names depending on where the order
 * was rung in, and on a POS line TWO of them hold the same entries:
 *
 *   POS         modifiers === modifierSelections (the chosen options), and
 *               addons is empty. Entries carry `optionName`, not `name`.
 *   Storefront  modifiers is already the UNION -- add-ons, chosen options and
 *               the variant -- while addons and modifierSelections hold the
 *               structured originals.
 *
 * So concatenating all three prints every extra twice on a POS bill and up to
 * three times on a website one. `modifiers` wins where it exists, because it
 * is the union on the surface that has a union and a complete list on the one
 * that does not.
 *
 * The variant is dropped: it is part of what the dish IS, it is priced into
 * the base, and it is already printed beside the name.
 *
 * Mirrors `pos-frontend/src/utils/orderItems.js` -- keep them in step.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const normalise = (entry) => {
  const name = String(entry?.name || entry?.optionName || "").trim();
  if (!name) return null;
  return {
    name,
    price: round2(entry?.price),
    quantity: Math.max(1, Math.floor(Number(entry?.quantity) || 1)),
  };
};

const orderItemExtras = (item = {}) => {
  const source =
    Array.isArray(item.modifiers) && item.modifiers.length
      ? item.modifiers
      : [...(item.addons || []), ...(item.modifierSelections || [])];

  const variantName = String(item.variant?.name || "").trim().toLowerCase();

  return source
    .map(normalise)
    .filter(Boolean)
    .filter((e) => !variantName || e.name.toLowerCase() !== variantName);
};

module.exports = { orderItemExtras };
