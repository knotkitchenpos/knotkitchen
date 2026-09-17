const Menu = require("../models/menuModel");
const { round2 } = require("./money");
const { AUDIENCES, menuViewFor } = require("./menuCache");
const { capFor } = require("./modifierGroups");
const { getChannelPrice } = require("./businessHours");

// ============================================================
// Server-side pricing engine
// Prices, taxes and totals are ALWAYS resolved here.
// Never trust browser-supplied prices or totals.
// ============================================================

/**
 * No GST unless the store is actually chargeable.
 *
 * This was 0.05, applied to every table, QR and POS bill regardless of
 * whether the store was GST registered -- and none of them were. The rate now
 * comes from the caller, which resolves it through services/gst from the
 * store's GST number and the rate set under Rules & Charges.
 *
 * Zero is the right default precisely because a wrong default is invisible:
 * charging nothing is a missing line on a bill, charging 5% is money taken
 * from customers that the business never owed.
 */
const TAX_RATE = 0;
const SERVICE_CHARGE_RATE = 0; // configurable per restaurant in future

const currentTimeInMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

const parseTime = (t) => {
  if (!t) return null;
  const [h, m] = (t || "").split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
};

const isInSchedule = (schedule) => {
  if (!schedule || !schedule.enabled) return true;
  const now = currentTimeInMinutes();
  const start = parseTime(schedule.startTime);
  const end = parseTime(schedule.endTime);
  if (start === null || end === null) return true;

  const today = new Date().getDay();
  const days = schedule.daysOfWeek || [];
  if (days.length === 0 || !days.includes(today)) return false;

  if (start <= end) return now >= start && now <= end;
  return now >= start || now <= end;
};

const getActivePrice = (item, { environment, channel } = {}) => {
  const listPrice =
    environment || channel ? getChannelPrice(item, environment, channel) : item?.price;
  if (!item?.priceRules?.length) return listPrice;
  const now = currentTimeInMinutes();
  const today = new Date().getDay();
  const activeRule = item.priceRules.find((r) => {
    if (!r.isActive) return false;
    const days = r.daysOfWeek || [];
    if (days.length === 0 || !days.includes(today)) return false;
    const start = parseTime(r.startTime);
    const end = parseTime(r.endTime);
    if (start === null || end === null) return true;
    if (start <= end) return now >= start && now <= end;
    return now >= start || now <= end;
  });
  return activeRule ? activeRule.price : listPrice;
};

/**
 * Resolve a menu item for ordering.
 * Throws http-errors if the item is unavailable / deleted / not published.
 */
const resolveMenuItem = async ({ menuItemId, restaurantId, outletId, audience = AUDIENCES.SYSTEM }) => {
  // Price against the copy the customer was actually shown.
  //
  // Both callers of this — POS staff adding to a table session, and a diner
  // ordering from a table QR — see the System Published snapshot, so that is
  // what they are billed from. Resolving against the live draft (as this used
  // to) meant an unpublished price edit in Manage Menu was charged against a
  // menu still displaying the old price, and a draft-only item could be
  // ordered before anyone published it.
  const snapshotPath =
    audience === AUDIENCES.WEBSITE
      ? "websiteSnapshot.items"
      : audience === AUDIENCES.SYSTEM
      ? "systemSnapshot.items"
      : "items";

  const menu = await Menu.findOne({
    restaurantId,
    isDeleted: { $ne: true },
    published: { $ne: false },
    [`${snapshotPath}._id`]: menuItemId,
  });

  if (!menu) {
    const err = new Error("This menu item is currently unavailable.");
    err.status = 400;
    throw err;
  }

  const item = (menuViewFor(menu, audience).items || []).find(
    (i) => i._id && i._id.toString() === menuItemId.toString(),
  );
  if (!item) {
    const err = new Error("This menu item is currently unavailable.");
    err.status = 400;
    throw err;
  }
  if (item.isAvailable === false) {
    const err = new Error(`${item.name} is currently out of stock.`);
    err.status = 400;
    throw err;
  }
  if (!isInSchedule(item.schedule)) {
    const err = new Error(`${item.name} is not available at this time.`);
    err.status = 400;
    throw err;
  }
  // Outlet scoping: if menu has outletId, it must match
  if (menu.outletId && outletId && menu.outletId.toString() !== outletId.toString()) {
    const err = new Error("This menu item is not available at this outlet.");
    err.status = 400;
    throw err;
  }

  return {
    menu,
    item,
    basePrice: getActivePrice(item, { environment: "system", channel: "table" }),
  };
};

/**
 * Calculate the server-side unit price for an item including
 * variants, add-ons and modifiers.
 */
const calculateUnitPrice = ({
  item,
  variantId,
  addonIds = [],
  modifierSelections = {},
  // Table sessions — POS tills and table QR alike — are "system" + "table".
  // Passing them makes "Same price for all channels = off" actually bill the
  // table price; before this every channel was charged item.price.
  environment = "system",
  channel = "table",
} = {}) => {
  if (!item) return 0;

  let price = getActivePrice(item, { environment, channel });

  // Variant
  let variant = null;
  if (item.variants?.length > 0) {
    variant = item.variants.find((v) => v._id.toString() === variantId?.toString());
    if (!variant) {
      const err = new Error("Please select a valid variant.");
      err.status = 400;
      throw err;
    }
    if (variant.isAvailable === false) {
      const err = new Error(`${variant.name} is currently unavailable.`);
      err.status = 400;
      throw err;
    }
    price = variant.price;
  }

  // Add-ons
  const selectedAddons = (item.addons || []).filter((a) =>
    addonIds.map(String).includes(a._id.toString())
  );
  for (const a of selectedAddons) {
    if (a.isAvailable === false) {
      const err = new Error(`${a.name} is currently unavailable.`);
      err.status = 400;
      throw err;
    }
    price += a.price || 0;
  }

  // Modifiers.
  //
  // Shaped as { name, price } objects, NOT bare strings: every schema that
  // stores this -- TableSession.items.modifiers and Order.items.modifiers --
  // declares [{ name: String, price: Number }]. Returning strings made
  // Mongoose throw "Cast to embedded failed" on save, so ANY table or QR
  // order for a product with a selected modifier group failed outright.
  const selectedModifiers = [];
  let modifierTotal = 0;
  for (const group of item.modifierGroups || []) {
    // A group switched OFF is not sold: it is hidden from the customer, so
    // validating it would demand a choice they were never shown, and
    // pricing it would charge for an option that is not on offer. Only an
    // EXPLICIT false counts -- groups predating the flag have it undefined.
    if (group.isActive === false) continue;
    const groupObjIdStr = group._id ? String(group._id) : "";
    const groupNameStr = group.name ? String(group.name).toLowerCase() : "";

    // Extract selected option entries for this group
    let selOptions = []; // Array of { id, name, quantity }

    if (Array.isArray(modifierSelections)) {
      // Format: Array of objects [{ groupId, groupName, optionId, optionName, quantity, price }]
      selOptions = modifierSelections
        .filter((m) => {
          if (!m) return false;
          const gIdMatch = m.groupId && String(m.groupId) === groupObjIdStr;
          const gNameMatch = m.groupName && String(m.groupName).toLowerCase() === groupNameStr;
          if (gIdMatch || gNameMatch) return true;
          if (!m.groupId && !m.groupName && (m.optionId || m.optionName)) return true;
          return false;
        })
        .map((m) => ({
          id: m.optionId ? String(m.optionId) : typeof m === "string" ? m : null,
          name: m.optionName ? String(m.optionName) : typeof m === "string" ? m : null,
          quantity: Number(m.quantity) || 1,
        }));
    } else if (modifierSelections && typeof modifierSelections === "object") {
      // Format: Object keyed by group._id or group.name
      const rawVal =
        (groupObjIdStr && modifierSelections[groupObjIdStr]) ||
        (group.name && modifierSelections[group.name]) ||
        [];
      if (Array.isArray(rawVal)) {
        selOptions = rawVal.map((opt) => ({
          id: typeof opt === "object" ? String(opt._id || opt.id || opt.optionId) : String(opt),
          name: typeof opt === "object" ? opt.name || opt.optionName : null,
          quantity: typeof opt === "object" ? Number(opt.quantity) || 1 : 1,
        }));
      } else if (rawVal && typeof rawVal === "object") {
        // Map of optionId -> quantity
        selOptions = Object.entries(rawVal).map(([optId, qty]) => ({
          id: optId,
          name: null,
          quantity: Number(qty) || 1,
        }));
      }
    }

    const totalSelectedQty = selOptions.reduce((s, o) => s + (Number(o.quantity) || 1), 0);

    // Required group validation
    if (group.required && totalSelectedQty === 0) {
      const err = new Error(`Please select "${group.name}".`);
      err.status = 400;
      throw err;
    }

    // One rule, shared with every other consumer (services/modifierGroups).
    const cap = capFor(group);
    if (totalSelectedQty > cap) {
      const err = new Error(`Maximum ${cap} selection(s) for "${group.name}".`);
      err.status = 400;
      throw err;
    }

    for (const opt of group.options || []) {
      const optIdStr = String(opt._id || opt.id || opt.name || "");
      const optNameStr = String(opt.name || "").toLowerCase();

      const matchedSel = selOptions.find((s) => {
        if (s.id && String(s.id) === optIdStr) return true;
        if (s.name && String(s.name).toLowerCase() === optNameStr) return true;
        return false;
      });

      if (matchedSel) {
        if (opt.isAvailable === false) {
          const err = new Error(`${opt.name} is currently unavailable.`);
          err.status = 400;
          throw err;
        }
        const qty = Number(matchedSel.quantity) || 1;
        modifierTotal += (opt.price || 0) * qty;
        // One entry per unit, so "2x Extra Cheese" bills and prints twice.
        for (let q = 0; q < qty; q++) {
          selectedModifiers.push({ name: opt.name, price: opt.price || 0 });
        }
      }
    }
  }

  price += modifierTotal;

  return {
    unitPrice: price,
    variant: variant ? { name: variant.name, price: variant.price } : null,
    addons: selectedAddons.map((a) => ({ name: a.name, price: a.price || 0 })),
    modifiers: selectedModifiers,
  };
};

/**
 * The one order-total rule, for every channel (till, table, QR, website).
 *
 *   subtotal      the lines as sold
 *   discount      clamped to [0, subtotal]
 *   taxableBase   (subtotal - discount) + serviceCharge + packagingFee
 *                 A service or packaging charge is part of the supply and is
 *                 taxed with it. A delivery fee is not, and sits outside.
 *   tax           exclusive: taxableBase * rate
 *                 inclusive: the tax already inside taxableBase, extracted
 *   totalWithTax  taxableBase + deliveryFee + (exclusive ? tax : 0)
 *
 * `taxRate` is a FRACTION (0.05 for 5%); callers get it, and `taxInclusive`,
 * from services/gst. Every figure is rounded once, with round2, at the end.
 *
 * Before this the table bill taxed the pre-discount subtotal and ignored
 * the inclusive flag, while the website taxed post-discount and honoured
 * it; editing an order dropped its discount and fees. One rule now.
 */
const computeTotals = ({
  subtotal = 0,
  discount = 0,
  serviceCharge = 0,
  packagingFee = 0,
  deliveryFee = 0,
  taxRate = TAX_RATE,
  taxInclusive = false,
}) => {
  const gross = Math.max(0, Number(subtotal) || 0);
  const off = Math.min(gross, Math.max(0, Number(discount) || 0));
  const service = Math.max(0, Number(serviceCharge) || 0);
  const packaging = Math.max(0, Number(packagingFee) || 0);
  const delivery = Math.max(0, Number(deliveryFee) || 0);
  const rate = Math.max(0, Number(taxRate) || 0);
  const inclusive = Boolean(taxInclusive) && rate > 0;

  const taxableBase = round2(gross - off + service + packaging);
  const tax =
    rate === 0 ? 0 : inclusive ? round2(taxableBase - taxableBase / (1 + rate)) : round2(taxableBase * rate);

  return {
    subtotal: round2(gross),
    discount: round2(off),
    serviceCharge: round2(service),
    packagingFee: round2(packaging),
    deliveryFee: round2(delivery),
    taxableBase,
    taxPercent: Math.round(rate * 10000) / 100,
    taxInclusive: inclusive,
    tax,
    totalWithTax: Math.max(0, round2(taxableBase + delivery + (inclusive ? 0 : tax))),
  };
};

/**
 * Bill totals for a list of (price, quantity) pairs: the till, table and QR
 * shape. `additionalCharges` is the dine-in service charge.
 */
const calculateBill = ({ items, taxRate = TAX_RATE, discount = 0, additionalCharges = 0, taxInclusive = false }) => {
  const t = computeTotals({
    subtotal: items.reduce((s, i) => s + i.price * i.quantity, 0),
    discount,
    serviceCharge: additionalCharges,
    taxRate,
    taxInclusive,
  });
  return {
    subtotal: t.subtotal,
    tax: t.tax,
    discount: t.discount,
    charges: t.serviceCharge,
    totalWithTax: t.totalWithTax,
    taxPercent: t.taxPercent,
    taxInclusive: t.taxInclusive,
  };
};

module.exports = {
  computeTotals,
  TAX_RATE,
  resolveMenuItem,
  calculateUnitPrice,
  calculateBill,
  isInSchedule,
  getActivePrice,
};