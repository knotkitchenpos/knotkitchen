const { isItemAvailableNow, getEffectivePrice } = require("./businessHours");

/**
 * Authoritative order pricing (§9, §24).
 *
 * THE GOLDEN RULE: nothing monetary is ever taken from the request body.
 * The client may only send *identifiers and quantities*:
 *
 *     { menuId, itemId, quantity, variantId, addonIds[], modifierSelections[], note }
 *
 * Every price, tax, fee and total below is recomputed from the store's own
 * Menu documents and WebsiteSettings. If a customer tampers with the payload
 * (price=1, a variant from another restaurant, an unavailable dish) the request
 * is rejected — it can never result in an underpriced order.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const MAX_LINE_ITEMS = 50;
const MAX_QUANTITY_PER_LINE = 30;

class PricingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const idsMatch = (a, b) => String(a) === String(b);

/**
 * Price a single cart line against its authoritative Menu item.
 * @param {object} line   client-supplied identifiers/quantity
 * @param {Map}    itemIndex  key `${menuId}:${itemId}` -> { item, menu }
 * @param {string} timezone
 */
const priceLine = (line, itemIndex, timezone) => {
  const quantity = Math.floor(Number(line?.quantity));
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new PricingError("Invalid quantity in cart.");
  }
  if (quantity > MAX_QUANTITY_PER_LINE) {
    throw new PricingError(`Maximum ${MAX_QUANTITY_PER_LINE} of a single item per order.`);
  }

  const key = `${line.menuId}:${line.itemId}`;
  const entry = itemIndex.get(key);
  // A missing entry means the product does not exist *within this store*.
  // We deliberately return the same generic message for "not found" and
  // "belongs to another store" so the API cannot be used to enumerate other
  // tenants' product ids.
  if (!entry) throw new PricingError("One or more items are no longer available.");

  const { item } = entry;

  if (item.showOnWebsite === false) {
    throw new PricingError(`${item.name} is not available for online ordering.`);
  }
  if (!isItemAvailableNow(item, timezone)) {
    throw new PricingError(`${item.name} is currently unavailable.`);
  }

  // ---- Base price: time-aware price rules, then optional discount price ----
  let basePrice = getEffectivePrice(item, timezone);
  if (
    item.discountPrice !== null &&
    item.discountPrice !== undefined &&
    Number(item.discountPrice) > 0 &&
    Number(item.discountPrice) < basePrice
  ) {
    basePrice = Number(item.discountPrice);
  }

  // ---- Variant (size). Replaces the base price, never adds to it. ----
  let variant = null;
  if (line.variantId) {
    const found = (item.variants || []).find((v) => idsMatch(v._id, line.variantId));
    if (!found) throw new PricingError(`Invalid option selected for ${item.name}.`);
    if (found.isAvailable === false) {
      throw new PricingError(`${found.name} is unavailable for ${item.name}.`);
    }
    basePrice = Number(found.price) || 0;
    variant = { variantId: found._id, name: found.name, price: Number(found.price) || 0 };
  } else if ((item.variants || []).length > 0) {
    // The storefront always forces a choice when variants exist; enforce it
    // server-side too so a crafted request cannot buy the cheapest implicitly.
    throw new PricingError(`Please select an option for ${item.name}.`);
  }

  // ---- Add-ons ----
  const addons = [];
  const addonIds = Array.isArray(line.addonIds) ? line.addonIds : [];
  if (addonIds.length > 20) throw new PricingError("Too many add-ons selected.");
  const seenAddons = new Set();
  for (const addonId of addonIds) {
    if (seenAddons.has(String(addonId))) continue; // ignore duplicates
    seenAddons.add(String(addonId));
    const found = (item.addons || []).find((a) => idsMatch(a._id, addonId));
    if (!found) throw new PricingError(`Invalid add-on selected for ${item.name}.`);
    if (found.isAvailable === false) {
      throw new PricingError(`${found.name} is unavailable.`);
    }
    addons.push({ addonId: found._id, name: found.name, price: Number(found.price) || 0 });
  }

  // ---- Modifier groups (meal options, choices) ----
  const modifierSelections = [];
  const rawSelections = Array.isArray(line.modifierSelections) ? line.modifierSelections : [];
  const byGroup = new Map();
  for (const sel of rawSelections) {
    const group = (item.modifierGroups || []).find((g) => idsMatch(g._id, sel?.groupId));
    if (!group) throw new PricingError(`Invalid selection for ${item.name}.`);
    const option = (group.options || []).find((o) => idsMatch(o._id, sel?.optionId));
    // Enforces "option belongs to that product's group" — cross-group or
    // cross-product option ids are rejected here.
    if (!option) throw new PricingError(`Invalid selection for ${item.name}.`);
    if (option.isAvailable === false) throw new PricingError(`${option.name} is unavailable.`);

    const list = byGroup.get(String(group._id)) || [];
    if (list.some((o) => idsMatch(o.optionId, option._id))) continue; // dedupe
    list.push({
      groupId: group._id,
      groupName: group.name,
      optionId: option._id,
      optionName: option.name,
      price: Number(option.price) || 0,
    });
    byGroup.set(String(group._id), list);
  }

  // Validate min/max per group, including required groups the client omitted.
  for (const group of item.modifierGroups || []) {
    const chosen = byGroup.get(String(group._id)) || [];
    const min = group.required ? Math.max(1, Number(group.minSelections) || 1) : Number(group.minSelections) || 0;
    const max = Number(group.maxSelections) || 1;
    if (chosen.length < min) {
      throw new PricingError(`Please choose ${min} option(s) for "${group.name}" on ${item.name}.`);
    }
    if (max > 0 && chosen.length > max) {
      throw new PricingError(`You may choose at most ${max} option(s) for "${group.name}".`);
    }
    modifierSelections.push(...chosen);
  }

  const modifiersTotal =
    addons.reduce((sum, a) => sum + a.price, 0) +
    modifierSelections.reduce((sum, m) => sum + m.price, 0);

  const unitPrice = round2(basePrice + modifiersTotal);
  const total = round2(unitPrice * quantity);

  const note = typeof line.note === "string" ? line.note.trim().slice(0, 300) : "";

  return {
    // Kept for compatibility with the existing POS order item shape
    menuItemId: entry.menu._id,
    name: item.name,
    quantity,
    price: unitPrice,
    total,
    modifiers: [
      ...addons.map((a) => ({ name: a.name, price: a.price })),
      ...modifierSelections.map((m) => ({ name: m.optionName, price: m.price })),
      ...(variant ? [{ name: variant.name, price: 0 }] : []),
    ],
    note,
    // Structured storefront detail
    menuId: entry.menu._id,
    itemId: item._id,
    // Keep the server's exact pre-modifier amount for the receipt. For a
    // selected variant this is the variant price; for a discounted item it is
    // the effective customer-facing price.
    basePrice: round2(basePrice),
    unitPrice,
    variant: variant || undefined,
    addons,
    modifierSelections,
    imageUrl: item.imageThumbnailUrl || item.imageUrl || item.image || "",
    status: "pending",
  };
};

/**
 * Build a lookup of every orderable item in the store's published menus.
 * Because `menus` is fetched with a hard restaurantId filter by the caller,
 * anything absent from this index is — by construction — not this store's.
 */
const buildItemIndex = (menus) => {
  const index = new Map();
  for (const menu of menus || []) {
    for (const item of menu.items || []) {
      index.set(`${menu._id}:${item._id}`, { item, menu });
    }
  }
  return index;
};

/**
 * Compute the complete, authoritative bill.
 *
 * @param {object} params
 *   items     {Array}  client cart lines (identifiers + quantities only)
 *   menus     {Array}  store-scoped Menu documents
 *   settings  {object} WebsiteSettings (fees/tax config)
 *   orderType {string} "pickup" | "delivery"
 *   timezone  {string}
 * @returns {{ items, bills }}
 */
const calculateOrderTotals = ({ items, menus, settings, orderType, timezone }) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new PricingError("Your cart is empty.");
  }
  if (items.length > MAX_LINE_ITEMS) {
    throw new PricingError("Too many items in the cart.");
  }

  const itemIndex = buildItemIndex(menus);
  const pricedItems = items.map((line) => priceLine(line, itemIndex, timezone));

  const subtotal = round2(pricedItems.reduce((sum, i) => sum + i.total, 0));

  const ordering = settings?.ordering || {};
  const isDelivery = orderType === "delivery";

  if (isDelivery && !ordering.deliveryEnabled) {
    throw new PricingError("This restaurant does not offer delivery.");
  }
  if (!isDelivery && ordering.pickupEnabled === false) {
    throw new PricingError("This restaurant does not offer pickup.");
  }

  const minOrderValue = Number(ordering.minOrderValue) || 0;
  if (minOrderValue > 0 && subtotal < minOrderValue) {
    throw new PricingError(
      `Minimum order value is ${ordering.currencySymbol || ""}${minOrderValue}.`
    );
  }

  // ---- Delivery fee (waived above the configured threshold) ----
  let deliveryFee = 0;
  if (isDelivery) {
    deliveryFee = Number(ordering.deliveryFee) || 0;
    const freeAbove = Number(ordering.freeDeliveryAbove) || 0;
    if (freeAbove > 0 && subtotal >= freeAbove) deliveryFee = 0;
  }

  const packagingFee = Number(ordering.packagingFee) || 0;

  // ---- Tax ----
  const taxPercent = Number(ordering.taxPercent) || 0;
  const taxableBase = round2(subtotal + packagingFee);
  let tax = 0;
  if (taxPercent > 0) {
    tax = ordering.taxInclusive
      // Price already contains tax: extract the tax component for the receipt.
      ? round2(taxableBase - taxableBase / (1 + taxPercent / 100))
      : round2((taxableBase * taxPercent) / 100);
  }

  const discount = 0; // coupons are a future extension; never client-supplied
  const totalWithTax = round2(
    subtotal + packagingFee + deliveryFee + (ordering.taxInclusive ? 0 : tax) - discount
  );

  return {
    items: pricedItems,
    bills: {
      subtotal,
      total: subtotal,        // matches existing POS semantics (pre-tax)
      tax,
      totalWithTax,
      discount,
      deliveryFee,
      packagingFee,
    },
  };
};

module.exports = {
  calculateOrderTotals,
  buildItemIndex,
  priceLine,
  PricingError,
  round2,
  MAX_LINE_ITEMS,
  MAX_QUANTITY_PER_LINE,
};
