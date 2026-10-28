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
const depletionPlan = (items = [], recipes = []) => {
  const byItem = new Map();
  for (const r of recipes) if (r?.menuItemId) byItem.set(String(r.menuItemId), r);
  const lines = [];
  const take = [];
  items.forEach((it, itemIndex) => {
    if (!it || it.stockDepleted || it.status === "cancelled") return;
    const recipe = byItem.get(String(it.menuItemId || "")) || byItem.get(String(it.itemId || ""));
    lines.push({ itemIndex });
    if (!recipe) return;
    const servings = Number(it.quantity) || 1;
    const per = Math.max(1, Number(recipe.yield) || 1);
    for (const ing of recipe.ingredients || []) {
      const qty = round3((Number(ing.quantity) || 0) * servings / per);
      if (qty > 0) take.push({ ingredientId: String(ing.ingredientId), quantity: qty, unit: ing.unit || "", itemName: it.name || "" });
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
  const recipes = await Recipe.find({ restaurantId: order.restaurantId, isActive: { $ne: false }, isDeleted: { $ne: true } }).lean();
  const { lines, take } = depletionPlan(items, recipes);
  if (!lines.length) return;

  const units = new Map(
    (await Ingredient.find({ _id: { $in: [...new Set(take.map((t) => t.ingredientId))] }, restaurantId: order.restaurantId }).select("_id unit").lean())
      .map((i) => [String(i._id), i.unit]),
  );
  const alerts = [];
  for (const t of take) {
    const unit = units.get(t.ingredientId);
    if (!unit) continue;
    // 20 g from a shelf counted in kg takes 0.02. A recipe saved before units
    // could differ has the item's own unit, so nothing changes for it.
    const quantity = convertQty(t.quantity, t.unit || unit, unit);
    if (!quantity) continue;
    const ing = await Ingredient.findOneAndUpdate(
      { _id: t.ingredientId, restaurantId: order.restaurantId, isDeleted: { $ne: true } },
      { $inc: { stockQuantity: -quantity } },
      { new: true },
    );
    if (!ing) continue;
    const status = stockStatus(ing);
    const before = stockStatus({ ...ing.toObject(), stockQuantity: ing.stockQuantity + quantity });
    if (ing.isLowStock !== needsRestock(status)) {
      await Ingredient.updateOne({ _id: ing._id }, { $set: { isLowStock: needsRestock(status) } });
    }
    // Only the sale that crosses the line raises the alert, not every one after it.
    if (needsRestock(status) && status !== before) {
      alerts.push({ ingredientId: String(ing._id), name: ing.name, status, stockQuantity: round3(ing.stockQuantity), unit: ing.unit, reorderLevel: ing.reorderLevel || 0 });
    }
    await StockMovement.create({
      restaurantId: order.restaurantId,
      outletId: order.outletId || undefined,
      ingredientId: ing._id,
      ingredientName: ing.name,
      type: "sale",
      quantity: -quantity,
      unit,
      reason: t.itemName,
      referenceId: String(order._id),
    });
  }
  if (alerts.length) {
    try {
      require("./socket").emitToRestaurant(String(order.restaurantId), "inventory:restock", { items: alerts });
    } catch {
      /* no socket in this process: the POS still finds them on its next load */
    }
  }

  // Mark the lines so a later save (a new round, a status change) skips them.
  const set = {};
  for (const { itemIndex } of lines) set[`items.${itemIndex}.stockDepleted`] = true;
  await Order.updateOne({ _id: order._id }, { $set: set });
};

module.exports = {
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
