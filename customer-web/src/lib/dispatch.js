/**
 * A restaurant can restrict a category to Collection, Delivery or Table
 * Orders. The words for that ("Collection Only") arrive in the storefront
 * payload as `dispatchLabel` on every category and product, computed by the
 * same backend function that refuses the order at checkout, so the site
 * never spells the rule itself.
 */

const KEYS = ["collection", "delivery", "table"];

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
