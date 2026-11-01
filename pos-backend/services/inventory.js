/**
 * Stock depletion: every sold line takes its recipe's ingredients off the
 * shelf, once.
 *
 * Orders are created in four places (till, table session, website, QR), so
 * the hook sits on the Order model's post-save rather than in any one of
 * them. A line is depleted the first time it is seen (items[].stockDepleted),
 * so a round added to a table later only depletes the new lines, and a
 * re-save never depletes twice.
 */
const mongoose = require("mongoose");
const createHttpError = require("http-errors");

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/* ------------------------------------------------------------------ units */

/**
 * The units an item is counted in, and what each is worth in its family's
 * base unit. A recipe or a purchase may use another unit of the SAME family
 * (20 g of a cheese counted in kg; 100 g of flour bought for a kg shelf);
 * it is converted to the item's own unit. Across families (g of something
 * counted in pieces) there is no conversion, and it is refused.
 */
const UNITS = {
  pcs: { family: "count", factor: 1, label: "Piece" },
  dozen: { family: "count", factor: 12, label: "Dozen" },
  g: { family: "mass", factor: 1, label: "Gram" },
  kg: { family: "mass", factor: 1000, label: "KG" },
  ml: { family: "volume", factor: 1, label: "ML" },
  L: { family: "volume", factor: 1000, label: "Litre" },
  pack: { family: "pack", factor: 1, label: "Pack" },
};
const UNIT_CODES = Object.keys(UNITS);

/** `quantity` in `from`, expressed in `to`; null when they are not the same kind of measure. */
const convertQty = (quantity, from, to) => {
  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b || a.family !== b.family) return null;
  return round3((Number(quantity) || 0) * a.factor / b.factor);
};

/* ----------------------------------------------------------------- status */

/**
 * The one rule for an item's status:
 *   out  nothing left
 *   low  at or below its minimum: time to restock
 *   max  at or above its maximum
 *   in   otherwise
 * A minimum or maximum of 0 means none was set.
 */
const STOCK_STATUS = { in: "In Stock", low: "Low Stock", out: "Out of Stock", max: "Maximum Stock Reached" };
const stockStatus = ({ stockQuantity, reorderLevel, maxLevel } = {}) => {
  const stock = Number(stockQuantity) || 0;
  const min = Number(reorderLevel) || 0;
  const max = Number(maxLevel) || 0;
  if (stock <= 0) return "out";
  if (min > 0 && stock <= min) return "low";
  if (max > 0 && stock >= max) return "max";
  return "in";
};
/** Needs restocking: what isLowStock (indexed) records and the POS alerts on. */
const needsRestock = (status) => status === "low" || status === "out";

/* ---------------------------------------------------------------- batches */

/**
 * Pure: the batches left once the shelf holds `stock`. Whatever came off the
 * shelf came out of the batch that expires first (owner, 2026-11-01: oldest
 * stock used first), so the dated batches never add up to more than the
 * shelf. Stock bought without a date has no batch and is not tracked here.
 */
const trimBatches = (batches = [], stock = 0) => {
  const dated = (batches || [])
    .filter((b) => Number(b?.quantity) > 0 && b?.expiryDate)
    .map((b) => ({ quantity: round3(b.quantity), expiryDate: new Date(b.expiryDate), receivedAt: b.receivedAt ? new Date(b.receivedAt) : new Date() }))
    .sort((a, b) => a.expiryDate - b.expiryDate);
  let excess = round3(dated.reduce((n, b) => n + b.quantity, 0) - Math.max(0, Number(stock) || 0));
  while (excess > 0 && dated.length) {
    const take = Math.min(excess, dated[0].quantity);
    dated[0].quantity = round3(dated[0].quantity - take);
    excess = round3(excess - take);
    if (dated[0].quantity <= 0) dated.shift();
  }
  return dated;
};

/** Pure: an item's dated batches by when they run out: expired, expiring within `days`, or later. */
const expiryOf = (batches = [], { days = 2, now = new Date() } = {}) => {
  const soon = new Date(now.getTime() + days * 86400000);
  return (batches || [])
    .filter((b) => Number(b?.quantity) > 0 && b?.expiryDate)
    .map((b) => {
      const at = new Date(b.expiryDate);
      return { quantity: round3(b.quantity), expiryDate: at, state: at <= now ? "expired" : at <= soon ? "soon" : "ok" };
    })
    .sort((a, b) => a.expiryDate - b.expiryDate);
};

/* ---------------------------------------------------------------- costing */

/**
 * Pure: what recipe lines cost at the items' cost prices, each line converted
 * to its item's unit (20 g of a cheese at ₹400 per kg is ₹8). An item with no
 * cost price is named in `missing`, so a dish's cost is never shown as
 * complete when it is not.
 * @param {Array} lines   [{ ingredientId, quantity, unit }]
 * @param {Map} items     ingredientId -> { name, unit, costPerUnit }
 */
const linesCost = (lines = [], items = new Map()) => {
  let cost = 0;
  const missing = [];
  for (const l of lines || []) {
    const ing = items.get(String(l.ingredientId));
    // A removed item still in a recipe: named, so the cost is not shown as complete.
    if (!ing) {
      if (!missing.includes("a removed item")) missing.push("a removed item");
      continue;
    }
    const qtyInUnit = convertQty(l.quantity, l.unit || ing.unit, ing.unit);
    if (qtyInUnit === null) continue;
    if (!(Number(ing.costPerUnit) > 0)) {
      missing.push(ing.name);
      continue;
    }
    cost += qtyInUnit * Number(ing.costPerUnit);
  }
  return { cost: Math.round(cost * 100) / 100, missing };
};

/**
 * Pure: one dish's cost per serving, profit and food-cost % at `price`.
 * `flag` is set when the food cost is above the store's target.
 */
const dishCost = ({ recipe, price, items, targetPct = 35 }) => {
  const per = Math.max(1, Number(recipe?.yield) || 1);
  const { cost, missing } = linesCost(recipe?.ingredients || [], items);
  const serving = Math.round((cost / per) * 100) / 100;
  const p = Number(price) || 0;
  const pct = p > 0 ? Math.round((serving / p) * 1000) / 10 : null;
  return {
    cost: serving,
    price: p,
    profit: Math.round((p - serving) * 100) / 100,
    foodCostPct: pct,
    missing,
    flag: pct !== null && pct > targetPct,
  };
};

/* ---------------------------------------------------------------- recipes */

/**
 * A recipe's lines as sent (Manage Menu or Inventory), checked against this
 * restaurant's own items. Each line keeps the unit it was entered in; one in a
 * unit that cannot become the item's unit is refused, naming the item, rather
 * than silently taking the wrong amount on every sale.
 */
const cleanRecipeLines = async (restaurantId, lines = []) => {
  const { Ingredient } = require("../models/inventoryModel");
  const list = (Array.isArray(lines) ? lines : []).slice(0, 50);
  const ids = list.map((r) => r?.ingredientId).filter((id) => mongoose.Types.ObjectId.isValid(id));
  const owned = await Ingredient.find({ _id: { $in: ids }, restaurantId, isDeleted: { $ne: true } }).select("_id name unit").lean();
  const byId = new Map(owned.map((i) => [String(i._id), i]));
  const out = [];
  for (const r of list) {
    const ing = byId.get(String(r?.ingredientId));
    const quantity = round3(Math.min(1e6, Math.max(0, Number(r?.quantity) || 0)));
    if (!ing || quantity <= 0) continue;
    const unit = UNITS[r?.unit] ? r.unit : ing.unit;
    if (convertQty(1, unit, ing.unit) === null) {
      throw createHttpError(400, `${ing.name} is counted in ${UNITS[ing.unit]?.label || ing.unit}; a recipe cannot use ${UNITS[unit]?.label || unit} for it.`);
    }
    out.push({ ingredientId: ing._id, quantity, unit });
  }
  return out;
};

/**
 * Save the recipe of one product. `enabled: false` keeps the lines but stops
 * sales taking stock for it (the Recipe switch in Manage Menu).
 */
const saveRecipe = async ({ restaurantId, menuItemId, menuItemName, enabled = true, ingredients = [], yieldN }) => {
  const { Recipe } = require("../models/inventoryModel");
  const lines = await cleanRecipeLines(restaurantId, ingredients);
  const set = {
    menuItemName: String(menuItemName || "").trim().slice(0, 160) || "Dish",
    ingredients: lines,
    isActive: Boolean(enabled) && lines.length > 0,
    isDeleted: false,
  };
  if (yieldN !== undefined) set.yield = Math.max(1, Math.min(1000, Number(yieldN) || 1));
  return Recipe.findOneAndUpdate(
    { restaurantId, menuItemId },
    { $set: set, $setOnInsert: { restaurantId } },
    { new: true, upsert: true },
  );
};

/**
 * Pure: which ingredients an order's undepleted lines consume.
 * @param {Array} items    order lines
 * @param {Array} recipes  the tenant's recipes ({ menuItemId, yield, ingredients[] })
 * @returns {{ lines: Array<{itemIndex:number}>, take: Array<{ingredientId:string, quantity:number, unit:string, itemName:string}> }}
 */
const lower = (v) => String(v || "").trim().toLowerCase();
const optionKey = (group, option) => `${lower(group)}\u0000${lower(option)}`;
const variantKey = (menuItemId, variant) => `${String(menuItemId || "")}\u0000${lower(variant)}`;

/**
 * The add-ons and size a line was sold with, as recipe keys. Till and website
 * lines both record each choice's group and option names (modifierSelections);
 * the option's own count, where the till kept one, is on the matching
 * modifiers entry.
 */
const lineAddons = (it, dishGroups = new Map()) => {
  const counts = new Map();
  for (const m of it.modifiers || []) if (m?.name) counts.set(lower(m.name), Math.max(1, Math.floor(Number(m.quantity) || 1)));
  const options = (it.modifierSelections || [])
    .filter((m) => m?.optionName)
    .map((m) => ({ key: optionKey(m.groupName, m.optionName), times: counts.get(lower(m.optionName)) || 1, label: m.optionName }));
  // Table and table-QR lines keep only each choice's name (modifiers[]): its
  // group comes from the dish's own groups (`dishGroups`, dish id -> option
  // name -> group name). Without this, add-ons on dine-in orders took no stock.
  const seen = new Set(options.map((o) => lower(o.label)));
  const groups = dishGroups.get(String(it.menuItemId || it.itemId || "")) || new Map();
  for (const m of it.modifiers || []) {
    const name = lower(m?.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    options.push({ key: groups.has(name) ? optionKey(groups.get(name), m.name) : null, name, times: counts.get(name) || 1, label: m.name });
  }
  const variant = it.variant?.name ? variantKey(it.menuItemId || it.itemId, it.variant.name) : null;
  return { options, variant };
};

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sameName = (s) => new RegExp(`^${escapeRx(String(s || "").trim())}$`, "i");

/**
 * A group or component renamed in Manage Menu takes its add-on recipes with
 * it (owner, 2026-11-01). Add-on recipes are found by the names order lines
 * record, so a rename used to leave the recipe behind and sales quietly took
 * no stock for it.
 *
 * `options` are the components as the editor sent them; one carrying `oldName`
 * was renamed from it. A recipe already under the new name wins: the old one
 * is left, never merged.
 */
const carryAddonRecipes = async ({ restaurantId, oldGroup, newGroup, options = [] }) => {
  if (!restaurantId || !newGroup || mongoose.connection?.readyState !== 1) return;
  try {
    await carryAddonRecipesNow({ restaurantId, oldGroup, newGroup, options });
  } catch (e) {
    // The group is saved either way; a recipe left behind can be set again in Inventory › Add-ons.
    console.error("[inventory] add-on recipes not carried over:", e?.message || e);
  }
};

const carryAddonRecipesNow = async ({ restaurantId, oldGroup, newGroup, options = [] }) => {
  const { AddonRecipe } = require("../models/inventoryModel");
  const move = async (from, to) => {
    try {
      await AddonRecipe.updateOne({ restaurantId, kind: "option", ...from }, { $set: to });
    } catch (e) {
      if (e?.code !== 11000) throw e; // the new name has its own recipe already
    }
  };
  const group = String(newGroup).trim();
  if (oldGroup && String(oldGroup).trim() && String(oldGroup).trim().toLowerCase() !== group.toLowerCase()) {
    const rows = await AddonRecipe.find({ restaurantId, kind: "option", groupName: sameName(oldGroup) }).select("optionName").lean();
    for (const r of rows) await move({ groupName: sameName(oldGroup), optionName: r.optionName }, { groupName: group });
  }
  for (const o of Array.isArray(options) ? options : []) {
    const was = String(o?.oldName || "").trim();
    const now = String(o?.name || "").trim();
    if (!was || !now || was.toLowerCase() === now.toLowerCase()) continue;
    await move({ groupName: sameName(group), optionName: sameName(was) }, { optionName: now });
  }
};

/** Pure: dish id -> (option name -> group name), from the store's menu documents. */
const dishGroupsOf = (menus = []) => {
  const out = new Map();
  for (const m of menus) {
    for (const item of m.items || []) {
      const byOption = new Map();
      for (const g of item.modifierGroups || []) for (const o of g.options || []) if (o?.name && !byOption.has(lower(o.name))) byOption.set(lower(o.name), g.name);
      out.set(String(item._id), byOption);
    }
  }
  return out;
};

/**
 * Pure: which ingredients an order's undepleted lines consume: each dish's
 * recipe, plus the recipe of every add-on and the size it was sold with
 * (owner, 2026-11-01: Extra Cheese used no cheese before).
 * @param {Array} addonRecipes  [{ kind: "option"|"variant", groupName, optionName, menuItemId, variantName, ingredients[] }]
 */
const depletionPlan = (items = [], recipes = [], addonRecipes = [], dishGroups = new Map()) => {
  const byItem = new Map();
  for (const r of recipes) if (r?.menuItemId) byItem.set(String(r.menuItemId), r);
  const byOption = new Map();
  const byVariant = new Map();
  // An option name used in only one group with a recipe: a choice whose group
  // is not known (the dish's group was since removed) still finds it.
  const byOptionName = new Map();
  for (const a of addonRecipes || []) {
    if (a?.kind === "option") {
      byOption.set(optionKey(a.groupName, a.optionName), a);
      const n = lower(a.optionName);
      byOptionName.set(n, byOptionName.has(n) ? null : a);
    } else if (a?.kind === "variant") byVariant.set(variantKey(a.menuItemId, a.variantName), a);
  }
  const lines = [];
  const take = [];
  items.forEach((it, itemIndex) => {
    if (!it || it.stockDepleted || it.status === "cancelled") return;
    lines.push({ itemIndex });
    const servings = Number(it.quantity) || 1;
    const add = (ingredients, times, label) => {
      for (const ing of ingredients || []) {
        const qty = round3((Number(ing.quantity) || 0) * times);
        if (qty > 0) take.push({ ingredientId: String(ing.ingredientId), quantity: qty, unit: ing.unit || "", itemName: label, itemIndex });
      }
    };
    const recipe = byItem.get(String(it.menuItemId || "")) || byItem.get(String(it.itemId || ""));
    if (recipe) add(recipe.ingredients, servings / Math.max(1, Number(recipe.yield) || 1), it.name || "");
    const { options, variant } = lineAddons(it, dishGroups);
    if (variant && byVariant.has(variant)) add(byVariant.get(variant).ingredients, servings, `${it.name || ""} · ${it.variant.name}`);
    for (const o of options) {
      const a = (o.key && byOption.get(o.key)) || (!o.key && o.name ? byOptionName.get(o.name) : null);
      if (a) add(a.ingredients, servings * o.times, `${it.name || ""} · ${o.label}`);
    }
  });
  return { lines, take };
};

/** Apply the plan: decrement stock, log a "sale" movement, mark the lines. */
const depleteOrder = async (order) => {
  if (!order || !order.restaurantId || mongoose.connection?.readyState !== 1) return;
  const items = order.items || [];
  if (!items.some((it) => it && !it.stockDepleted && it.status !== "cancelled")) return;

  const { Ingredient, Recipe, StockMovement } = require("../models/inventoryModel");
  const Order = require("../models/orderModel");
  const { AddonRecipe } = require("../models/inventoryModel");
  const [recipes, addonRecipes] = await Promise.all([
    Recipe.find({ restaurantId: order.restaurantId, isActive: { $ne: false }, isDeleted: { $ne: true } }).lean(),
    AddonRecipe ? AddonRecipe.find({ restaurantId: order.restaurantId }).lean() : [],
  ]);
  // Lines that kept only their choices' names need each dish's groups to find their recipes.
  let dishGroups = new Map();
  const needGroups = addonRecipes.length && items.some((it) => it && !it.stockDepleted && (it.modifiers || []).length > (it.modifierSelections || []).length);
  if (needGroups) {
    try {
      const Menu = require("../models/menuModel");
      dishGroups = dishGroupsOf(await Menu.find({ restaurantId: order.restaurantId, isDeleted: { $ne: true } }).select("items._id items.modifierGroups.name items.modifierGroups.options.name").lean());
    } catch {
      dishGroups = new Map();
    }
  }
  const { lines, take } = depletionPlan(items, recipes, addonRecipes, dishGroups);
  if (!lines.length) return;

  // Claim each line before taking its stock, one atomic update apiece. Two
  // saves close together (a till order, then the platform-fee stamp on it)
  // each ran this with the line still unmarked, and the recipe came off
  // twice. Only the run whose update flips the flag takes that line. Matched
  // by the line's own _id where it has one, never a bare position (N014: a
  // write to an index that is not there adds a nameless line).
  const claimed = new Set();
  for (const { itemIndex } of lines) {
    const it = items[itemIndex];
    const claim = it._id
      ? Order.updateOne(
          { _id: order._id, items: { $elemMatch: { _id: it._id, stockDepleted: { $ne: true } } } },
          { $set: { "items.$.stockDepleted": true } },
        )
      : Order.updateOne(
          { _id: order._id, [`items.${itemIndex}.name`]: it.name, [`items.${itemIndex}.stockDepleted`]: { $ne: true } },
          { $set: { [`items.${itemIndex}.stockDepleted`]: true } },
        );
    if ((await claim)?.modifiedCount) claimed.add(itemIndex);
  }
  const mine = take.filter((t) => claimed.has(t.itemIndex));
  if (!mine.length) return;

  const units = new Map(
    (await Ingredient.find({ _id: { $in: [...new Set(mine.map((t) => t.ingredientId))] }, restaurantId: order.restaurantId }).select("_id unit").lean())
      .map((i) => [String(i._id), i.unit]),
  );
  const alerts = [];
  for (const t of mine) {
    const unit = units.get(t.ingredientId);
    if (!unit) continue;
    // 20 g from a shelf counted in kg takes 0.02. A recipe saved before units
    // could differ has the item's own unit, so nothing changes for it.
    const quantity = convertQty(t.quantity, t.unit || unit, unit);
    if (!quantity) continue;
    // Subtracted, rounded and floored at 0 in one atomic update. A plain $inc
    // left 1 kg less 30 g twice as 0.9099999999999999 (drift that tips the
    // minimum check), and sold past nothing into negative stock. The sale
    // still stands (the POS warned before it was rung up); the shelf just
    // cannot hold less than nothing. The old value says what really came off.
    const prev = await Ingredient.findOneAndUpdate(
      { _id: t.ingredientId, restaurantId: order.restaurantId, isDeleted: { $ne: true } },
      [{ $set: { stockQuantity: { $max: [0, { $round: [{ $subtract: [{ $ifNull: ["$stockQuantity", 0] }, quantity] }, 3] }] } } }],
      { new: false },
    );
    if (!prev) continue;
    const had = Number(prev.stockQuantity) || 0;
    const left = Math.max(0, round3(had - quantity));
    const taken = round3(had - left);
    const ing = { ...(prev.toObject ? prev.toObject() : prev), stockQuantity: left };
    const status = stockStatus(ing);
    const before = stockStatus({ ...ing, stockQuantity: had });
    const patch = {};
    if (ing.isLowStock !== needsRestock(status)) patch.isLowStock = needsRestock(status);
    // What was sold came out of the batch that expires first.
    if ((ing.batches || []).length) patch.batches = trimBatches(ing.batches, left);
    if (Object.keys(patch).length) await Ingredient.updateOne({ _id: ing._id }, { $set: patch });
    // Only the sale that crosses the line raises the alert, not every one after it.
    if (needsRestock(status) && status !== before) {
      alerts.push({ ingredientId: String(ing._id), name: ing.name, status, stockQuantity: left, unit: ing.unit, reorderLevel: ing.reorderLevel || 0 });
    }
    if (taken <= 0) continue;
    const short = round3(quantity - taken);
    await StockMovement.create({
      restaurantId: order.restaurantId,
      outletId: order.outletId || undefined,
      ingredientId: ing._id,
      ingredientName: ing.name,
      type: "sale",
      quantity: -taken,
      value: -Math.round(taken * (Number(ing.costPerUnit) || 0) * 100) / 100,
      unit,
      reason: short > 0 ? `${t.itemName} (short by ${short} ${UNITS[unit]?.label || unit})` : t.itemName,
      referenceId: String(order._id),
    });
  }
  // The out-of-stock alert asks whether to turn off the products that use
  // the item, so it says how many are still on sale.
  for (const a of alerts.filter((x) => x.status === "out")) {
    try {
      a.productsOn = await require("./stockProducts").countOnSale(order.restaurantId, a.ingredientId);
    } catch {
      a.productsOn = 0;
    }
  }
  try {
    const { emitToRestaurant } = require("./socket");
    if (alerts.length) emitToRestaurant(String(order.restaurantId), "inventory:restock", { items: alerts });
    // Tills check what is left before ringing a dish up (the POS stock warning).
    emitToRestaurant(String(order.restaurantId), "inventory:stock", {});
  } catch {
    /* no socket in this process: the POS still finds them on its next load */
  }
};

module.exports = {
  trimBatches,
  expiryOf,
  linesCost,
  dishCost,
  optionKey,
  variantKey,
  lineAddons,
  dishGroupsOf,
  carryAddonRecipes,
  UNITS,
  UNIT_CODES,
  STOCK_STATUS,
  convertQty,
  stockStatus,
  needsRestock,
  cleanRecipeLines,
  saveRecipe,
  depletionPlan,
  depleteOrder,
};
