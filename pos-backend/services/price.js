const Menu = require("../models/menuModel");
const { round2 } = require("./money");
const { AUDIENCES, ORDER_TYPES, projectMenu, isVisibleOnPos, allowsOrderType } = require("./menuCache");
const { capFor } = require("./modifierGroups");
const { unitPriceNow, nowInTimezone, isItemAvailableNow } = require("./businessHours");

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

const parseTime = (t) => {
  if (!t) return null;
  const [h, m] = (t || "").split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
};

// On the store clock, like the till's inSchedule: the server process runs on UTC.
const isInSchedule = (schedule, timezone) => {
  if (!schedule || !schedule.enabled) return true;
  const { day: today, minutes: now } = nowInTimezone(timezone || "Asia/Kolkata");
  const start = parseTime(schedule.startTime);
  const end = parseTime(schedule.endTime);
  if (start === null || end === null) return true;

  const days = schedule.daysOfWeek || [];
  if (days.length === 0 || !days.includes(today)) return false;

  if (start <= end) return now >= start && now <= end;
  return now >= start || now <= end;
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

  const Restaurant = require("../models/restaurantModel");
  const [menu, restaurant] = await Promise.all([
    Menu.findOne({
      restaurantId,
      isDeleted: { $ne: true },
      [`${snapshotPath}._id`]: menuItemId,
    }),
    // Schedules and price rules run on the store clock.
    Restaurant.findById(restaurantId).select("timezone").lean(),
  ]);
  const timezone = restaurant?.timezone || "Asia/Kolkata";

  if (!menu) {
    const err = new Error("This menu item is currently unavailable.");
    err.status = 400;
    throw err;
  }

  // N036-N039: what the till and the QR show is what sells: the PUBLISHED category
  // visibility (POS Visibility included) and Dispatch Type, the product's Display
  // Target, Display Status (+ POS Visibility) and schedule. Not the live draft flag.
  const view = projectMenu(menu, audience);
  const item = (view.items || []).find((i) => i._id && i._id.toString() === menuItemId.toString());
  if (!item || !isVisibleOnPos(view)) {
    const err = new Error("This menu item is currently unavailable.");
    err.status = 400;
    throw err;
  }
  if (!allowsOrderType(view, ORDER_TYPES.TABLE, item)) {
    const err = new Error(`${item.name} is not available for table orders.`);
    err.status = 400;
    throw err;
  }
  if (item.isAvailable === false && item.visibleOnPosWhenOff !== true) {
    const err = new Error(`${item.name} is currently out of stock.`);
    err.status = 400;
    throw err;
  }
  // The category's own schedule as well: the till hides "Breakfast" after 11:00, so nobody sells it then.
  if (!isItemAvailableNow(item, timezone, "pos") || !isItemAvailableNow({ isAvailable: true, schedule: view.schedule }, timezone)) {
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

  return { menu, item, timezone };
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
  // Table sessions (POS Table Service and table QR alike) bill the Table
  // channel price and its price rules on the store clock, exactly as the till.
  channel = "table",
  timezone,
} = {}) => {
  if (!item) return 0;

  let price = unitPriceNow(item, channel, timezone);

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

    // Selected entries for this group: { id, name, quantity, named }. `named`
    // is an entry that names this group (by id or name); an entry naming no
    // group is tried against every group.
    const selOptions = [];

    if (Array.isArray(modifierSelections)) {
      // Format: Array of objects [{ groupId, groupName, optionId, optionName, quantity, price }]
      for (const m of modifierSelections) {
        if (!m) continue;
        const named = Boolean(
          (m.groupId && String(m.groupId) === groupObjIdStr) ||
            (m.groupName && String(m.groupName).toLowerCase() === groupNameStr),
        );
        if (!named && (m.groupId || m.groupName || !(m.optionId || m.optionName))) continue;
        selOptions.push({
          id: m.optionId ? String(m.optionId) : null,
          name: m.optionName ? String(m.optionName) : null,
          quantity: m.quantity ?? 1,
          named,
        });
      }
    } else if (modifierSelections && typeof modifierSelections === "object") {
      // Format: Object keyed by group._id or group.name
      const rawVal =
        (groupObjIdStr && modifierSelections[groupObjIdStr]) ||
        (group.name && modifierSelections[group.name]) ||
        [];
      if (Array.isArray(rawVal)) {
        rawVal.forEach((opt) =>
          selOptions.push({
            id: typeof opt === "object" ? String(opt?._id || opt?.id || opt?.optionId) : String(opt),
            name: typeof opt === "object" ? opt?.name || opt?.optionName || null : null,
            quantity: typeof opt === "object" ? opt?.quantity ?? 1 : 1,
            named: true,
          }),
        );
      } else if (rawVal && typeof rawVal === "object") {
        // Map of optionId -> quantity
        Object.entries(rawVal).forEach(([optId, qty]) => selOptions.push({ id: optId, name: null, quantity: qty, named: true }));
      }
    }

    // Each entry is ONE option (by id, else by name) in whole units, and the
    // cap counts those units. Matching each option against every entry by id
    // OR name let one entry (optionId White, optionName Brown) buy two breads
    // while counting once; a quantity of 0.5 or -1 slipped two past a cap of
    // one, and a negative one took money off the bill.
    const options = group.options || [];
    const chosen = [];
    for (const s of selOptions) {
      const qty = Number(s.quantity);
      const opt =
        (s.id && options.find((o) => [o._id, o.id, o.name].some((v) => v != null && String(v) === s.id))) ||
        (s.name && options.find((o) => String(o.name || "").toLowerCase() === s.name.toLowerCase()));
      if (!Number.isInteger(qty) || qty < 1 || (!opt && s.named)) {
        const err = new Error(`Invalid selection for "${group.name}".`);
        err.status = 400;
        throw err;
      }
      if (opt) chosen.push({ opt, qty });
    }

    const totalSelectedQty = chosen.reduce((s, c) => s + c.qty, 0);

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

    for (const opt of options) {
      const qty = chosen.filter((c) => c.opt === opt).reduce((s, c) => s + c.qty, 0);
      if (!qty) continue;
      if (opt.isAvailable === false) {
        const err = new Error(`${opt.name} is currently unavailable.`);
        err.status = 400;
        throw err;
      }
      modifierTotal += (opt.price || 0) * qty;
      // One entry per unit, so "2x Extra Cheese" bills and prints twice.
      for (let q = 0; q < qty; q++) {
        selectedModifiers.push({ name: opt.name, price: opt.price || 0 });
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
 *   taxableBase   (subtotal - discount) + packagingFee
 *                 A packaging charge is part of the supply and is taxed with
 *                 it. A delivery fee is not, and sits outside.
 *   tax           exclusive: taxableBase * rate
 *                 inclusive: the tax already inside taxableBase, extracted
 *   serviceCharge goes on top of the taxed bill and is not itself taxed.
 *                 Given as `serviceChargePercent` of (taxableBase + exclusive
 *                 tax), or as an amount already struck (`serviceCharge`).
 *   totalWithTax  taxableBase + (exclusive ? tax : 0) + serviceCharge + deliveryFee
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
  serviceChargePercent = 0,
  packagingFee = 0,
  deliveryFee = 0,
  taxRate = TAX_RATE,
  taxInclusive = false,
}) => {
  const gross = Math.max(0, Number(subtotal) || 0);
  const off = Math.min(gross, Math.max(0, Number(discount) || 0));
  const servicePct = Math.max(0, Number(serviceChargePercent) || 0);
  const packaging = Math.max(0, Number(packagingFee) || 0);
  const delivery = Math.max(0, Number(deliveryFee) || 0);
  const rate = Math.max(0, Number(taxRate) || 0);
  const inclusive = Boolean(taxInclusive) && rate > 0;

  const taxableBase = round2(gross - off + packaging);
  const tax =
    rate === 0 ? 0 : inclusive ? round2(taxableBase - taxableBase / (1 + rate)) : round2(taxableBase * rate);
  const taxed = taxableBase + (inclusive ? 0 : tax);
  const service = round2(servicePct > 0 ? (taxed * servicePct) / 100 : Math.max(0, Number(serviceCharge) || 0));

  return {
    subtotal: round2(gross),
    discount: round2(off),
    serviceCharge: service,
    packagingFee: round2(packaging),
    deliveryFee: round2(delivery),
    taxableBase,
    taxPercent: Math.round(rate * 10000) / 100,
    taxInclusive: inclusive,
    tax,
    totalWithTax: Math.max(0, round2(taxed + service + delivery)),
  };
};

/**
 * Bill totals for a list of (price, quantity) pairs: the till, table and QR
 * shape. The dine-in service charge comes as `serviceChargePercent`, or as
 * `additionalCharges` when the amount was already struck.
 */
const calculateBill = ({
  items,
  taxRate = TAX_RATE,
  discount = 0,
  additionalCharges = 0,
  serviceChargePercent = 0,
  taxInclusive = false,
}) => {
  const t = computeTotals({
    subtotal: items.reduce((s, i) => s + i.price * i.quantity, 0),
    discount,
    serviceCharge: additionalCharges,
    serviceChargePercent,
    taxRate,
    taxInclusive,
  });
  return {
    subtotal: t.subtotal,
    tax: t.tax,
    discount: t.discount,
    charges: t.serviceCharge,
    serviceCharge: t.serviceCharge,
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
};