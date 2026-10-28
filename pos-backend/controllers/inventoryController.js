const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const { Ingredient, Recipe, StockMovement } = require("../models/inventoryModel");
const { logActivity } = require("../services/auditService");
const {
  UNITS,
  UNIT_CODES,
  convertQty,
  stockStatus,
  needsRestock,
  saveRecipe,
} = require("../services/inventory");

/**
 * Inventory: items on the shelf, their stock, the recipes that tie products to
 * them, and the movement log. Every read and write is scoped to the caller's
 * restaurant; nothing here takes a restaurantId from the client.
 */

const scope = (req) => {
  if (!req.user?.restaurantId) throw createHttpError(400, "No restaurant on this account.");
  return { restaurantId: req.user.restaurantId, isDeleted: { $ne: true } };
};
const oid = (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid id!");
  return id;
};
const text = (v, max) => String(v || "").trim().slice(0, max);
const num = (v, { min = 0, max = 1e9 } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
};
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const CATEGORIES = ["produce", "meat", "seafood", "dairy", "dry_goods", "beverage", "other"];

/** An item as the screens read it: with its status worked out by the one rule. */
const view = (doc) => {
  const o = doc?.toObject ? doc.toObject() : doc;
  return { ...o, status: stockStatus(o) };
};
const refreshFlag = (doc) => {
  doc.isLowStock = needsRestock(stockStatus(doc));
};

const ingredientBody = (body = {}) => {
  const name = text(body.name, 120);
  if (!name) throw createHttpError(400, "Name is required.");
  const unit = UNIT_CODES.includes(body.unit) ? body.unit : "pcs";
  const category = CATEGORIES.includes(body.category) ? body.category : "other";
  const reorderLevel = num(body.reorderLevel) ?? 0;
  const maxLevel = num(body.maxLevel) ?? 0;
  if (maxLevel > 0 && maxLevel <= reorderLevel) {
    throw createHttpError(400, "Maximum stock must be more than the minimum stock.");
  }
  const costPerUnit = num(body.costPerUnit) ?? 0;
  return { name, unit, category, reorderLevel, maxLevel, costPerUnit };
};

/* ------------------------------------------------------------------ items */

const listIngredients = async (req, res, next) => {
  try {
    const data = await Ingredient.find(scope(req)).sort({ name: 1 }).lean();
    res.status(200).json({ success: true, data: data.map(view) });
  } catch (e) { next(e); }
};

/** The items that need restocking now: what the POS alert shows on load. */
const listRestockAlerts = async (req, res, next) => {
  try {
    const data = await Ingredient.find({ ...scope(req), isLowStock: true }).sort({ stockQuantity: 1 }).lean();
    const items = data.map(view).filter((i) => needsRestock(i.status))
      .map((i) => ({ ingredientId: String(i._id), name: i.name, status: i.status, stockQuantity: round3(i.stockQuantity), unit: i.unit, reorderLevel: i.reorderLevel || 0 }));
    res.status(200).json({ success: true, data: items });
  } catch (e) { next(e); }
};

const createIngredient = async (req, res, next) => {
  try {
    const s = scope(req);
    const fields = ingredientBody(req.body);
    const stockQuantity = round3(num(req.body?.stockQuantity) ?? 0);
    const doc = new Ingredient({
      ...fields,
      stockQuantity,
      restaurantId: s.restaurantId,
      outletId: req.user.outletId || undefined,
    });
    refreshFlag(doc);
    await doc.save();
    if (stockQuantity > 0) {
      await StockMovement.create({
        restaurantId: s.restaurantId, outletId: req.user.outletId || undefined,
        ingredientId: doc._id, ingredientName: doc.name, type: "adjustment",
        quantity: stockQuantity, unit: doc.unit, reason: "Opening stock", createdBy: req.user._id,
      });
    }
    res.status(201).json({ success: true, data: view(doc) });
  } catch (e) { next(e); }
};

const updateIngredient = async (req, res, next) => {
  try {
    const s = scope(req);
    const doc = await Ingredient.findOne({ _id: oid(req.params.id), ...s });
    if (!doc) throw createHttpError(404, "Ingredient not found!");
    const next_ = ingredientBody({ ...doc.toObject(), ...req.body });

    // A new unit of the same kind re-states every amount in it (2 kg becomes
    // 2000 g), so the shelf does not jump. Another kind of unit would make
    // every recipe that uses the item wrong, so it is refused while one does.
    if (next_.unit !== doc.unit) {
      const factor = convertQty(1, doc.unit, next_.unit);
      if (factor === null) {
        const used = await Recipe.countDocuments({ restaurantId: s.restaurantId, isDeleted: { $ne: true }, "ingredients.ingredientId": doc._id });
        if (used) throw createHttpError(400, `${doc.name} is in ${used} recipe(s). Remove it from them before counting it in ${UNITS[next_.unit].label}.`);
      } else {
        doc.stockQuantity = round3(doc.stockQuantity * factor);
        if (req.body?.reorderLevel === undefined) next_.reorderLevel = round3(doc.reorderLevel * factor);
        if (req.body?.maxLevel === undefined) next_.maxLevel = round3((doc.maxLevel || 0) * factor);
        if (req.body?.costPerUnit === undefined) next_.costPerUnit = round3(doc.costPerUnit / factor);
      }
    }
    Object.assign(doc, next_);
    refreshFlag(doc);
    await doc.save();
    res.status(200).json({ success: true, data: view(doc) });
  } catch (e) { next(e); }
};

const deleteIngredient = async (req, res, next) => {
  try {
    const doc = await Ingredient.findOneAndUpdate({ _id: oid(req.params.id), ...scope(req) }, { isDeleted: true }, { new: true });
    if (!doc) throw createHttpError(404, "Ingredient not found!");
    res.status(200).json({ success: true, message: "Ingredient removed." });
  } catch (e) { next(e); }
};

/* -------------------------------------------------------------- movements */

/**
 * Stock in or out by hand.
 *   purchase    quantity bought, in any unit of the item's kind (100 g for a
 *               kg shelf), and what it cost in total (5 pieces for ₹20). The
 *               item's cost price becomes that cost per unit.
 *   waste       quantity lost, with a reason
 *   adjustment  the actual count; the difference is what is recorded
 */
const recordMovement = async (req, res, next) => {
  try {
    const s = scope(req);
    const { type } = req.body || {};
    if (!["purchase", "waste", "adjustment"].includes(type)) throw createHttpError(400, "Type must be purchase, waste or adjustment.");
    const entered = num(req.body?.quantity, { min: 0, max: 1e7 });
    if (entered === null || (type !== "adjustment" && entered <= 0)) throw createHttpError(400, "Quantity must be more than zero.");
    const ing = await Ingredient.findOne({ _id: oid(req.body?.ingredientId), ...s });
    if (!ing) throw createHttpError(404, "Ingredient not found!");

    const unit = UNIT_CODES.includes(req.body?.unit) ? req.body.unit : ing.unit;
    const quantity = convertQty(entered, unit, ing.unit);
    if (quantity === null) {
      throw createHttpError(400, `${ing.name} is counted in ${UNITS[ing.unit]?.label || ing.unit}; it cannot take ${UNITS[unit]?.label || unit}.`);
    }
    const cost = type === "purchase" ? round3(num(req.body?.totalCost, { min: 0, max: 1e9 }) ?? 0) : 0;

    const before = Number(ing.stockQuantity) || 0;
    const delta = type === "purchase" ? quantity : type === "waste" ? -quantity : quantity - before;
    ing.stockQuantity = round3(before + delta);
    if (type === "purchase" && cost > 0 && quantity > 0) ing.costPerUnit = round3(cost / quantity);
    refreshFlag(ing);
    await ing.save();
    const unitNote = unit !== ing.unit ? `${entered} ${UNITS[unit].label}` : "";
    const movement = await StockMovement.create({
      restaurantId: s.restaurantId, outletId: req.user.outletId || undefined,
      ingredientId: ing._id, ingredientName: ing.name, type, quantity: round3(delta), unit: ing.unit, cost,
      reason: [unitNote, text(req.body?.reason, 200)].filter(Boolean).join(" · "), createdBy: req.user._id,
    });
    if (type === "waste") {
      await logActivity({ req, action: "Stock Wasted", resource: "Inventory", resourceId: ing._id,
        newValue: `${quantity} ${ing.unit} ${ing.name}`, description: `Wastage: ${quantity} ${ing.unit} ${ing.name}${movement.reason ? ` (${movement.reason})` : ""}` });
    }
    res.status(201).json({ success: true, data: { ingredient: view(ing), movement } });
  } catch (e) { next(e); }
};

const listMovements = async (req, res, next) => {
  try {
    const s = scope(req);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const q = { restaurantId: s.restaurantId };
    if (req.query.ingredientId && mongoose.Types.ObjectId.isValid(req.query.ingredientId)) q.ingredientId = req.query.ingredientId;
    const data = await StockMovement.find(q).sort({ createdAt: -1 }).limit(limit).lean();
    res.status(200).json({ success: true, data });
  } catch (e) { next(e); }
};

/* ---------------------------------------------------------------- recipes */

const listRecipes = async (req, res, next) => {
  try {
    const data = await Recipe.find(scope(req)).sort({ menuItemName: 1 }).lean();
    res.status(200).json({ success: true, data });
  } catch (e) { next(e); }
};

const upsertRecipe = async (req, res, next) => {
  try {
    const s = scope(req);
    const doc = await saveRecipe({
      restaurantId: s.restaurantId,
      menuItemId: oid(req.params.menuItemId),
      menuItemName: req.body?.menuItemName,
      enabled: req.body?.enabled !== false,
      ingredients: req.body?.ingredients,
      yieldN: req.body?.yield,
    });
    res.status(200).json({ success: true, data: doc });
  } catch (e) { next(e); }
};

const deleteRecipe = async (req, res, next) => {
  try {
    const doc = await Recipe.findOneAndUpdate({ menuItemId: oid(req.params.menuItemId), ...scope(req) }, { isDeleted: true }, { new: true });
    if (!doc) throw createHttpError(404, "Recipe not found!");
    res.status(200).json({ success: true, message: "Recipe removed." });
  } catch (e) { next(e); }
};

module.exports = {
  listIngredients, listRestockAlerts, createIngredient, updateIngredient, deleteIngredient,
  recordMovement, listMovements, listRecipes, upsertRecipe, deleteRecipe,
};
