/**
 * Which order types a category or product can be bought through, in words.
 *
 * A restaurant can restrict a category to Collection, Delivery or Table
 * Orders. That restriction is enforced at checkout, but until now it was
 * invisible while browsing: the first the customer heard of it was "One or
 * more items are no longer available" on the payment step, which named
 * neither the item nor the reason and read like the dish had sold out.
 *
 * Returns null when there is nothing worth saying — all three order types
 * allowed, or none set at all (the backend treats that as unrestricted too).
 *
 * This mirrors `dispatchLabel` in pos-backend/services/menuCache.js. The two
 * cannot import from each other, so if the wording changes in one it must
 * change in the other: the label a customer read while browsing and the
 * refusal they get at checkout have to agree.
 */

const LABELS = { collection: "Collection", delivery: "Delivery", table: "Table Orders" };
const KEYS = ["collection", "delivery", "table"];

export function dispatchLabel(dispatchType) {
  if (!dispatchType) return null;
  const allowed = KEYS.filter((k) => dispatchType[k] !== false);
  if (allowed.length === 3 || allowed.length === 0) return null;
  const names = allowed.map((k) => LABELS[k]);
  const joined =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  return `${joined} Only`;
}

/**
 * Is this restriction relevant to the order type the customer has chosen?
 *
 * The website only asks for collection vs delivery, and "pickup" there is a
 * collection order — the same mapping the backend uses at checkout. Used to
 * warn in the basket, where the choice has actually been made.
 */
export function allowsFulfilment(dispatchType, fulfilment) {
  if (!dispatchType) return true;
  const allowed = KEYS.filter((k) => dispatchType[k] !== false);
  if (allowed.length === 3 || allowed.length === 0) return true;
  const key = fulfilment === "delivery" ? "delivery" : "collection";
  return dispatchType[key] !== false;
}
