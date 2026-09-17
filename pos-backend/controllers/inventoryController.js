const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const { Ingredient, Recipe, StockMovement } = require("../models/inventoryModel");
const { logActivity } = require("../services/auditService");

/**
 * Inventory: ingredients, their stock, recipes that tie dishes to them, and
 * the movement log. Every read and write is scoped to the caller's
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
const UNITS = ["kg", "g", "L", "ml", "pcs", "pack", "dozen"];
const CATEGORIES = ["produce", "meat", "seafood", "dairy", "dry_goods", "beverage", "other"];

const lowFlag = (doc) => Number(doc.stockQuantity) <= Number(doc.reorderLevel || 0);

const ingredientBody = (body = {}) => {
  const name = text(body.name, 120);
  if (!name) throw createHttpError(400, "Name is required.");
  const unit = UNITS.includes(body.unit) ? body.unit : "pcs";
  const category = CATEGORIES.includes(body.category) ? body.category : "other";
  const reorderLevel = num(body.reorderLevel) ?? 0;
  const costPerUnit = num(body.costPerUnit) ?? 0;
  return { name, unit, category, reorderLevel, costPerUnit };
};

/* ------------------------------------------------------------ ingredients */

const listIngredients = async (req, res, next) => {
  try {
    const data = await Ingredient.find(scope(req)).sort({ name: 1 }).lean();
    res.status(200).json({ success: true, data });
  } catch (e) { next(e); }
};

const createIngredient = async (req, res, next) => {
  try {
    const s = scope(req);
    const fields = ingredientBody(req.body);
    const stockQuantity = num(req.body?.stockQuantity) ?? 0;
    const doc = await Ingredient.create({
      ...fields,
      stockQuantity,
      isLowStock: stockQuantity <= fields.reorderLevel,
      restaurantId: s.restaurantId,
      outletId: req.user.outletId || undefined,
    });
    if (stockQuantity > 0) {
      await StockMovement.create({
        restaurantId: s.restaurantId, outletId: req.user.outletId || undefined,
        ingredientId: doc._id, ingredientName: doc.name, type: "adjustment",
        quantity: stockQuantity, unit: doc.unit, reason: "Opening stock", createdBy: req.user._id,
      });
    }
    res.status(201).json({ success: true, data: doc });
  } catch (e) { next(e); }
};

const updateIngredient = async (req, res, next) => {
  try {
    const doc = await Ingredient.findOne({ _id: oid(req.params.id), ...scope(req) });
    if (!doc) throw createHttpError(404, "Ingredient not found!");
    Object.assign(doc, ingredientBody({ ...doc.toObject(), ...req.body }));
    doc.isLowStock = lowFlag(doc);
    await doc.save();
    res.status(200).json({ success: true, data: doc });
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
 * POST /movements { ingredientId, type: purchase|waste|adjustment, quantity, reason }
 * purchase adds, waste removes, adjustment sets the count to `quantity`.
 */
const recordMovement = async (req, res, next) => {
  try {
    const s = scope(req);
    const { type } = req.body || {};
    if (!["purchase", "waste", "adjustment"].includes(type)) throw createHttpError(400, "Type must be purchase, waste or adjustment.");
    const quantity = num(req.body?.quantity, { min: 0, max: 1e7 });
    if (quantity === null || (type !== "adjustment" && quantity <= 0)) throw createHttpError(400, "Quantity must be more than zero.");
    const ing = await Ingredient.findOne({ _id: oid(req.body?.ingredientId), ...s });
    if (!ing) throw createHttpError(404, "Ingredient not found!");

    const before = Number(ing.stockQuantity) || 0;
    const delta = type === "purchase" ? quantity : type === "waste" ? -quantity : quantity - before;
    ing.stockQuantity = Math.round((before + delta) * 1000) / 1000;
    ing.isLowStock = lowFlag(ing);
    if (type === "purchase" && req.body?.costPerUnit !== undefined) ing.costPerUnit = num(req.body.costPerUnit) ?? ing.costPerUnit;
    await ing.save();
    const movement = await StockMovement.create({
      restaurantId: s.restaurantId, outletId: req.user.outletId || undefined,
      ingredientId: ing._id, ingredientName: ing.name, type, quantity: delta, unit: ing.unit,
      reason: text(req.body?.reason, 200), createdBy: req.user._id,
    });
    if (type === "waste") {
      await logActivity({ req, action: "Stock Wasted", resource: "Inventory", resourceId: ing._id,
        newValue: `${quantity} ${ing.unit} ${ing.name}`, description: `Wastage: ${quantity} ${ing.unit} ${ing.name}${movement.reason ? ` (${movement.reason})` : ""}` });
    }
    res.status(201).json({ success: true, data: { ingredient: ing, movement } });
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

/** PUT /recipes/:menuItemId { menuItemName, yield, ingredients: [{ingredientId, quantity, unit}] } */
const upsertRecipe = async (req, res, next) => {
  try {
    const s = scope(req);
    const menuItemId = oid(req.params.menuItemId);
    const ids = (req.body?.ingredients || []).map((r) => r?.ingredientId).filter((id) => mongoose.Types.ObjectId.isValid(id));
    const owned = await Ingredient.find({ _id: { $in: ids }, ...s }).select("_id unit").lean();
    const unitOf = new Map(owned.map((i) => [String(i._id), i.unit]));
    const ingredients = (req.body?.ingredients || [])
      .filter((r) => unitOf.has(String(r?.ingredientId)))
      .map((r) => ({ ingredientId: r.ingredientId, quantity: num(r.quantity, { min: 0, max: 1e6 }) || 0, unit: unitOf.get(String(r.ingredientId)) }))
      .filter((r) => r.quantity > 0)
      .slice(0, 50);
    const doc = await Recipe.findOneAndUpdate(
      { restaurantId: s.restaurantId, menuItemId },
      {
        $set: {
          menuItemName: text(req.body?.menuItemName, 160) || "Dish",
          yield: Math.max(1, num(req.body?.yield, { min: 1, max: 1000 }) || 1),
          ingredients,
          isActive: true,
          isDeleted: false,
        },
        $setOnInsert: { restaurantId: s.restaurantId },
      },
      { new: true, upsert: true },
    );
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
  listIngredients, createIngredient, updateIngredient, deleteIngredient,
  recordMovement, listMovements, listRecipes, upsertRecipe, deleteRecipe,
};
