const { isItemAvailableNow, getEffectivePrice } = require("./businessHours");
const { calculateDistanceKm, computeDeliveryFeeFromSlabs } = require("./distanceService");
const { capFor } = require("./modifierGroups");
const { resolveGst } = require("./gst");


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

const { round2 } = require("./money");

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
const priceLine = (line, itemIndex, timezone, pricingContext = {}) => {
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
  if (item.displayTarget === "system") {
    throw new PricingError(`${item.name} is not available for online ordering.`);
  }

  if (!isItemAvailableNow(item, timezone, "website")) {
    throw new PricingError(`${item.name} is currently unavailable.`);
  }

  // ---- Base price: the channel's list price, then time-aware price rules,
  //      then optional discount price ----
  // pricingContext carries the environment (POS vs website) and the channel
  // (collection/delivery/table) so "Same price for all channels = off" is
  // actually billed. Without it every channel was charged item.price.
  let basePrice = getEffectivePrice(item, timezone, pricingContext);
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
    // Selecting from a group that is switched off is not a valid order.
    if (group.isActive === false) throw new PricingError(`Invalid selection for ${item.name}.`);
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
    // A group switched OFF is not sold: it is hidden from the customer, so
    // validating it would demand a choice they were never shown, and
    // pricing it would charge for an option that is not on offer. Only an
    // EXPLICIT false counts -- groups predating the flag have it undefined.
    if (group.isActive === false) continue;
    const chosen = byGroup.get(String(group._id)) || [];
    const min = group.required ? Math.max(1, Number(group.minSelections) || 1) : Number(group.minSelections) || 0;
    // Honour Maximum Selection. This used to cap at maxSelections no matter
    // what the flag said, so a group switched to "no limit" still refused.
    const max = capFor(group);
    if (chosen.length < min) {
      throw new PricingError(`Please choose ${min} option(s) for "${group.name}" on ${item.name}.`);
    }
    if (chosen.length > max) {
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
/**
 * Helper to check if a promotion rule is active for current channel, environment, time & day
 */
const isRuleEligible = ({ rule, channel, environment, date = new Date(), subtotal = 0 }) => {
  if (!rule || rule.isActive === false) return false;

  // Environment match: "system", "website", "both"
  if (rule.applyTo && rule.applyTo !== "both" && rule.applyTo !== environment) {
    return false;
  }

  // Channel match: collection, delivery, table
  const chanKey = channel === "pickup" ? "collection" : channel === "takeaway" ? "collection" : channel === "dine-in" ? "table" : channel;
  if (rule.channels && rule.channels[chanKey] === false) {
    return false;
  }

  // Min order amount
  if (rule.minOrderAmount > 0 && subtotal < rule.minOrderAmount) {
    return false;
  }

  // Date range
  if (rule.validFrom && new Date(rule.validFrom) > date) return false;
  if (rule.validUntil) {
    const until = new Date(rule.validUntil);
    until.setHours(23, 59, 59, 999);
    if (until < date) return false;
  }

  // Day of week (0 = Sunday)
  if (Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.length > 0) {
    const currentDay = date.getDay();
    if (!rule.daysOfWeek.includes(currentDay)) return false;
  }

  // Time range HH:mm
  if (rule.startTime && rule.endTime) {
    const curMinutes = date.getHours() * 60 + date.getMinutes();
    const [sh, sm] = (rule.startTime || "00:00").split(":").map(Number);
    const [eh, em] = (rule.endTime || "23:59").split(":").map(Number);
    const startMinutes = (sh || 0) * 60 + (sm || 0);
    const endMinutes = (eh || 23) * 60 + (em || 59);
    if (curMinutes < startMinutes || curMinutes > endMinutes) return false;
  }

  return true;
};

const calculateOrderTotals = ({
  items,
  menus,
  settings,
  // The store itself, for its GST number. Without it a rate alone was
  // enough to charge GST, even for a business that is not registered.
  restaurant,
  orderType = "pickup",
  source = "WEBSITE",
  customerAddress,
  storeAddress,
  couponCode,
  manualDiscount,
  timezone,
}) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new PricingError("Your cart is empty.");
  }
  if (items.length > MAX_LINE_ITEMS) {
    throw new PricingError("Too many items in the cart.");
  }

  const environment = String(source || "WEBSITE").toUpperCase() === "POS" ? "system" : "website";
  const channel = String(orderType || "pickup").toLowerCase() === "delivery"
    ? "delivery"
    : String(orderType || "pickup").toLowerCase() === "table" || String(orderType || "pickup").toLowerCase() === "dine-in"
    ? "table"
    : "collection";

  const itemIndex = buildItemIndex(menus);
  const pricedItems = items.map((line) =>
    priceLine(line, itemIndex, timezone, { environment, channel }),
  );

  let subtotal = round2(pricedItems.reduce((sum, i) => sum + i.total, 0));

  const ordering = settings?.ordering || {};
  const isDelivery = channel === "delivery";

  if (isDelivery && ordering.deliveryEnabled === false) {
    throw new PricingError("This restaurant does not offer delivery.");
  }
  if (!isDelivery && channel === "collection" && ordering.pickupEnabled === false) {
    throw new PricingError("This restaurant does not offer pickup.");
  }

  // ---- Module 8 §6: Free Item Auto-Injection ----
  const freeRules = settings?.freeItemConfig || [];
  const eligibleFreeRule = freeRules.find((rule) =>
    isRuleEligible({ rule, channel, environment, subtotal })
  );
  if (eligibleFreeRule && eligibleFreeRule.itemName) {
    pricedItems.push({
      menuItemId: eligibleFreeRule.menuItemId || null,
      name: `[FREE] ${eligibleFreeRule.itemName}`,
      quantity: 1,
      price: 0,
      total: 0,
      modifiers: [],
      note: "PROMOTION FREE ITEM",
      basePrice: 0,
      unitPrice: 0,
      status: "free_item",
    });
  }

  // ---- Module 8 §1: Minimum Order Enforcement ----
  const minConfig = ordering.minOrderConfig?.[channel] || {};
  const channelMin = minConfig.enabled && (minConfig.applyTo === "both" || minConfig.applyTo === environment)
    ? Number(minConfig.amount || 0)
    : Number(ordering.minOrderValue || 0);

  if (channelMin > 0 && subtotal < channelMin) {
    throw new PricingError(
      `Minimum order value for ${channel} is ${ordering.currencySymbol || "₹"}${channelMin}.`
    );
  }

  // ---- Module 8 §4 & §5: Discounts & Coupon Processing ----
  let computedDiscount = 0;

  // 1. Coupon (Website-only)
  if (couponCode && environment === "website") {
    const cleanCode = String(couponCode).trim().toUpperCase();
    const couponRule = (settings?.couponsConfig || []).find((c) => c.code === cleanCode);
    if (!couponRule) {
      throw new PricingError(`Invalid coupon code "${cleanCode}".`);
    }
    if (!isRuleEligible({ rule: couponRule, channel, environment, subtotal })) {
      throw new PricingError(`Coupon "${cleanCode}" is not applicable to this order.`);
    }
    if (couponRule.quantityTotal > 0 && couponRule.quantityUsed >= couponRule.quantityTotal) {
      throw new PricingError(`Coupon "${cleanCode}" has reached its maximum usage limit.`);
    }

    if (couponRule.type === "percent") {
      computedDiscount = round2((subtotal * couponRule.value) / 100);
    } else {
      computedDiscount = round2(Number(couponRule.value) || 0);
    }
  }
  // 2. Automated Discount Rules
  else {
    const discountRules = settings?.discountsConfig || [];
    const activeRule = discountRules.find((rule) =>
      isRuleEligible({ rule, channel, environment, subtotal })
    );
    if (activeRule) {
      if (activeRule.type === "percent") {
        computedDiscount = round2((subtotal * activeRule.value) / 100);
      } else {
        computedDiscount = round2(Number(activeRule.value) || 0);
      }
    } else if (manualDiscount && typeof manualDiscount === "object") {
      // Manual POS discount fallback
      if (manualDiscount.mode === "percent") {
        computedDiscount = round2((subtotal * (Number(manualDiscount.value) || 0)) / 100);
      } else if (manualDiscount.mode === "fixed") {
        computedDiscount = round2(Number(manualDiscount.value) || 0);
      }
    }
  }

  // Clamp discount so subtotal cannot go negative!
  const discount = Math.min(subtotal, Math.max(0, computedDiscount));

  // ---- Module 8 §2: Delivery Distance Slabs & Maximum Distance ----
  let deliveryFee = 0;
  if (isDelivery) {
    const distanceKm = calculateDistanceKm({ storeAddress, customerAddress });
    try {
      deliveryFee = computeDeliveryFeeFromSlabs({
        distanceKm,
        slabsConfig: ordering.deliverySlabsConfig,
        defaultFee: Number(ordering.deliveryFee) || 0,
      });
    } catch (err) {
      throw new PricingError(err.message);
    }

    const freeAbove = Number(ordering.freeDeliveryAbove) || 0;
    if (freeAbove > 0 && subtotal >= freeAbove) deliveryFee = 0;
  }

  // ---- Module 8 §3: Packaging Fee Applicability ----
  let packagingFee = 0;
  const packingApply = ordering.packingApplyTo || "both";
  if (packingApply === "both" || packingApply === environment) {
    packagingFee = Number(ordering.packagingFee) || 0;
  }

  // ---- Tax / GST Applicability ----
  // One resolver, shared with the table/QR path: a rate is not enough on its
  // own, the store must also carry a GST number.
  let tax = 0;
  const gst = resolveGst({ restaurant, ordering, environment });
  if (gst.applicable) {
    const postDiscount = Math.max(0, round2(subtotal - discount));
    const taxableBase = round2(postDiscount + packagingFee);
    tax = gst.inclusive
      ? round2(taxableBase - taxableBase / (1 + gst.percent / 100))
      : round2((taxableBase * gst.percent) / 100);
  }

  // Module 8 §7: Deterministic Total calculation preventing negative totals
  const postDiscount = Math.max(0, round2(subtotal - discount));
  const totalWithTax = Math.max(
    0,
    // Use the resolved flag, not the raw setting: when GST is not applicable
    // tax is 0 anyway, but reading the same source keeps the two in step.
    round2(postDiscount + packagingFee + deliveryFee + (gst.inclusive ? 0 : tax))
  );

  return {
    items: pricedItems,
    bills: {
      subtotal,
      total: subtotal,
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
