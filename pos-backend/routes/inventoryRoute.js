const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { Ingredient, Recipe, Vendor, PurchaseOrder, StockMovement } = require("../models/inventoryModel");
const router = express.Router();

// ===== Ingredients =====
router.route("/ingredients").post(isVerifiedUser, async (req, res, next) => {
  try {
    const { name, unit, category, stockQuantity, reorderLevel, costPerUnit, restaurantId, batch, shelfLifeDays } = req.body;
    if (!name || !unit || !restaurantId) return res.status(400).json({ success: false, message: "Name, unit and restaurantId are required!" });
    const ingredient = await Ingredient.create({ name, unit, category, stockQuantity: stockQuantity || 0, reorderLevel: reorderLevel || 0, costPerUnit: costPerUnit || 0, restaurantId, batch, shelfLifeDays });
    res.status(201).json({ success: true, data: ingredient });
  } catch (error) { next(error); }
});

router.route("/ingredients/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const { lowStock } = req.query;
    const query = { restaurantId: req.params.restaurantId, isDeleted: false };
    if (lowStock === "true") query.isLowStock = true;
    const data = await Ingredient.find(query).sort({ name: 1 });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

router.route("/ingredients/:ingredientId").put(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await Ingredient.findByIdAndUpdate(req.params.ingredientId, req.body, { new: true });
    if (!data) return res.status(404).json({ success: false, message: "Ingredient not found!" });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

router.route("/ingredients/:ingredientId").delete(isVerifiedUser, async (req, res, next) => {
  try {
    await Ingredient.findByIdAndUpdate(req.params.ingredientId, { isDeleted: true });
    res.status(200).json({ success: true, message: "Ingredient deleted!" });
  } catch (error) { next(error); }
});

// ===== Stock Movement =====
router.route("/movements").post(isVerifiedUser, async (req, res, next) => {
  try {
    const { ingredientId, type, quantity, unit, reason, restaurantId } = req.body;
    if (!ingredientId || !type || !quantity || !unit || !restaurantId) return res.status(400).json({ success: false, message: "Missing required fields!" });
    const movement = await StockMovement.create({ ingredientId, type, quantity, unit, reason, restaurantId, createdBy: req.user._id });
    // Update ingredient stock
    const ingredient = await Ingredient.findById(ingredientId);
    if (ingredient) {
      ingredient.stockQuantity += quantity;
      ingredient.isLowStock = ingredient.stockQuantity <= ingredient.reorderLevel;
      await ingredient.save();
    }
    res.status(201).json({ success: true, data: movement });
  } catch (error) { next(error); }
});

router.route("/movements/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await StockMovement.find({ restaurantId: req.params.restaurantId }).sort({ createdAt: -1 }).limit(200);
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

// ===== Recipes =====
router.route("/recipes").post(isVerifiedUser, async (req, res, next) => {
  try {
    const recipe = await Recipe.create(req.body);
    res.status(201).json({ success: true, data: recipe });
  } catch (error) { next(error); }
});

router.route("/recipes/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await Recipe.find({ restaurantId: req.params.restaurantId, isDeleted: false }).populate("ingredients.ingredientId");
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

router.route("/recipes/:recipeId").put(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await Recipe.findByIdAndUpdate(req.params.recipeId, req.body, { new: true });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

// ===== Vendors =====
router.route("/vendors").post(isVerifiedUser, async (req, res, next) => {
  try {
    const vendor = await Vendor.create(req.body);
    res.status(201).json({ success: true, data: vendor });
  } catch (error) { next(error); }
});

router.route("/vendors/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await Vendor.find({ restaurantId: req.params.restaurantId, isDeleted: false });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

// ===== Purchase Orders =====
router.route("/purchase-orders").post(isVerifiedUser, async (req, res, next) => {
  try {
    const { items, restaurantId, vendorId, vendorName, expectedDeliveryDate } = req.body;
    if (!items || !items.length || !restaurantId) return res.status(400).json({ success: false, message: "Items and restaurantId are required!" });
    const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;
    const totalAmount = items.reduce((sum, i) => sum + (i.totalCost || i.quantity * i.unitCost), 0);
    const po = await PurchaseOrder.create({ poNumber, items, restaurantId, vendorId, vendorName, expectedDeliveryDate, totalAmount, createdBy: req.user._id });
    res.status(201).json({ success: true, data: po });
  } catch (error) { next(error); }
});

router.route("/purchase-orders/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await PurchaseOrder.find({ restaurantId: req.params.restaurantId, isDeleted: false }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

router.route("/purchase-orders/:poId/status").patch(isVerifiedUser, async (req, res, next) => {
  try {
    const { status } = req.body;
    const update = { status };
    if (status === "received") update.receivedAt = new Date();
    const po = await PurchaseOrder.findByIdAndUpdate(req.params.poId, update, { new: true });
    // Update stock when received
    if (status === "received" && po) {
      for (const item of po.items) {
        if (item.ingredientId) {
          const ingredient = await Ingredient.findById(item.ingredientId);
          if (ingredient) {
            ingredient.stockQuantity += item.quantity;
            ingredient.batch = { batchNumber: `B-${Date.now().toString(36)}`, receivedDate: new Date(), expiryDate: new Date(Date.now() + 30*24*60*60*1000) };
            ingredient.isLowStock = false;
            await ingredient.save();
            await StockMovement.create({ ingredientId: item.ingredientId, ingredientName: item.ingredientName, type: "purchase", quantity: item.quantity, unit: item.unit, restaurantId: po.restaurantId, createdBy: req.user._id });
          }
        }
      }
    }
    res.status(200).json({ success: true, data: po });
  } catch (error) { next(error); }
});

router.route("/analytics/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const ingredients = await Ingredient.find({ restaurantId: req.params.restaurantId });
    const movements = await StockMovement.find({ restaurantId: req.params.restaurantId, type: "waste" }).sort({ createdAt: -1 }).limit(100);
    const lowStock = ingredients.filter(i => i.isLowStock);
    const totalStockValue = ingredients.reduce((sum, i) => sum + (i.stockQuantity * i.costPerUnit), 0);
    const totalWaste = movements.reduce((sum, m) => sum + Math.abs(m.quantity), 0);
    res.status(200).json({ success: true, data: { totalStockValue, lowStockCount: lowStock.length, lowStock, totalWaste, wasteCount: movements.length } });
  } catch (error) { next(error); }
});

module.exports = router;