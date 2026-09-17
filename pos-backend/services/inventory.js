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

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

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

  for (const t of take) {
    const ing = await Ingredient.findOneAndUpdate(
      { _id: t.ingredientId, restaurantId: order.restaurantId, isDeleted: { $ne: true } },
      { $inc: { stockQuantity: -t.quantity } },
      { new: true },
    );
    if (!ing) continue;
    if (ing.isLowStock !== ing.stockQuantity <= (ing.reorderLevel || 0)) {
      await Ingredient.updateOne({ _id: ing._id }, { $set: { isLowStock: ing.stockQuantity <= (ing.reorderLevel || 0) } });
    }
    await StockMovement.create({
      restaurantId: order.restaurantId,
      outletId: order.outletId || undefined,
      ingredientId: ing._id,
      ingredientName: ing.name,
      type: "sale",
      quantity: -t.quantity,
      unit: t.unit || ing.unit,
      reason: t.itemName,
      referenceId: String(order._id),
    });
  }

  // Mark the lines so a later save (a new round, a status change) skips them.
  const set = {};
  for (const { itemIndex } of lines) set[`items.${itemIndex}.stockDepleted`] = true;
  await Order.updateOne({ _id: order._id }, { $set: set });
};

module.exports = { depletionPlan, depleteOrder };
