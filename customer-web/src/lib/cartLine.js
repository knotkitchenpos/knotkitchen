/**
 * Adding a dish straight from the menu list (the ADD button), without the
 * product sheet. Only a dish with nothing to choose can be: a variant, an
 * add-on or a modifier group means the sheet opens instead.
 *
 * The line has exactly the shape ProductModal builds, so the cart merges a
 * dish added either way into one line (useCart lineSignature), and the
 * server re-prices it from the ids as always.
 */
export const isCustomisable = (product) =>
  (product.variants || []).length > 0 ||
  (product.addons || []).length > 0 ||
  (product.modifierGroups || []).length > 0;

export const simpleLine = (product) => ({
  menuId: product.menuId,
  itemId: product.id,
  name: product.name,
  dispatchType: product.dispatchType || null,
  dispatchLabel: product.dispatchLabel || null,
  quantity: 1,
  unitPrice: product.price,
  price: product.price,
  variant: null,
  addons: [],
  modifierSelections: [],
  note: "",
});

/**
 * What the server bills for one of `product` through `channel` (collection |
 * delivery) right now: it sends `prices` per channel, rules already applied.
 */
export const priceFor = (product, channel) =>
  Number(product?.prices?.[channel] ?? product?.price) || 0;

/**
 * A cart line's unit price from the latest menu. A line whose dish left the
 * menu keeps its stamped price (the server will refuse it at checkout).
 */
export const lineUnitPrice = (line, product, channel) => {
  if (!product) return Number(line.unitPrice ?? line.price) || 0;
  const fresh = line.variant
    ? (product.variants || []).find((v) => String(v.id) === String(line.variant.variantId))
    : null;
  const base = line.variant ? Number(fresh ? fresh.price : line.variant.price) || 0 : priceFor(product, channel);
  const extras = [...(line.addons || []), ...(line.modifierSelections || [])];
  return base + extras.reduce((s, x) => s + (Number(x.price) || 0), 0);
};

/** The cart lines for one dish, and how many of it are in the cart. */
export const linesFor = (items, productId) =>
  (items || []).filter((l) => String(l.itemId) === String(productId));
export const qtyInCart = (items, productId) =>
  linesFor(items, productId).reduce(
    (sum, l) => sum + (Number(l.quantity) || 0),
    0,
  );
