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

const { round2 } = require("./money");

const normalise = (entry, fallbackName) => {
  const name = String(entry?.name || entry?.optionName || fallbackName || "").trim();
  if (!name) return null;
  return {
    name,
    price: round2(entry?.price),
    quantity: Math.max(1, Math.floor(Number(entry?.quantity) || 1)),
  };
};

/**
 * The names an older order kept only inside its product name.
 *
 * Until the till stopped composing "Sandwich (+ Coke, Fries)", the order
 * controller read `m.name` while the till sent `m.optionName` -- so every
 * stored extra had a price and an EMPTY name. Those orders are real, their
 * bills are reachable by link for good, and the names are still there in the
 * one place nobody meant to put them.
 */
const namesFromComposedTitle = (name) => {
  const tail = String(name || "").match(/\(\+\s*([^)]*)\)\s*$/);
  if (!tail) return [];
  return tail[1].split(",").map((t) => t.trim()).filter(Boolean);
};

// The till sends `modifierSelections: {}` for a dish with nothing chosen: an
// object, which cannot be spread. Same guard as pos-frontend/src/utils/orderItems.js.
const list = (v) => (Array.isArray(v) ? v : []);

const orderItemExtras = (item = {}) => {
  const source =
    Array.isArray(item.modifiers) && item.modifiers.length
      ? item.modifiers
      : [...list(item.addons), ...list(item.modifierSelections)];

  const variantName = String(item.variant?.name || "").trim().toLowerCase();
  const salvaged = source.some((e) => !String(e?.name || e?.optionName || "").trim())
    ? namesFromComposedTitle(item.name)
    : [];

  // The salvaged name is passed IN rather than spread onto a copy of the
  // entry. These are Mongoose subdocuments when the order came from a
  // non-lean query, and spreading one copies its internals rather than its
  // fields -- which silently dropped the price and printed every recovered
  // extra as free.
  return source
    .map((entry, i) => normalise(entry, salvaged[i]))
    .filter(Boolean)
    .filter((e) => !variantName || e.name.toLowerCase() !== variantName);
};

/**
 * A line's product name, without the extras an older till baked into it.
 *
 * Those orders keep their composed title -- it is the only record of what the
 * extras were called. Printing it AND the rows salvaged from it would list
 * every extra twice on the same bill, so the tail comes off the name and the
 * rows carry it.
 */
const itemDisplayName = (item = {}) =>
  String(item?.name || "").replace(/\s*\(\+\s*[^)]*\)\s*$/, "").trim();

module.exports = { orderItemExtras, itemDisplayName };
