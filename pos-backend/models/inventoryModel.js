const mongoose = require("mongoose");

// ===== Ingredient / Raw Material =====
const ingredientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    category: {
      type: String,
      enum: ["produce", "meat", "seafood", "dairy", "dry_goods", "beverage", "other"],
      default: "other",
    },
    unit: { type: String, required: true }, // kg, g, L, ml, pcs
    stockQuantity: { type: Number, default: 0 },
    reorderLevel: { type: Number, default: 0 },
    costPerUnit: { type: Number, default: 0 },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
    batch: {
      batchNumber: String,
      expiryDate: Date,
      receivedDate: Date,
    },
    shelfLifeDays: { type: Number, default: 0 },
    isLowStock: { type: Boolean, default: false },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ingredientSchema.index({ restaurantId: 1, name: 1 });
ingredientSchema.index({ restaurantId: 1, isLowStock: 1 });
ingredientSchema.index({ "batch.expiryDate": 1 });

// ===== Recipe =====
const recipeIngredientSchema = new mongoose.Schema(
  {
    ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient", required: true },
    quantity: { type: Number, required: true },
    unit: { type: String, required: true },
  },
  { _id: false }
);

const recipeSchema = new mongoose.Schema(
  {
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: "Menu" },
    menuItemName: { type: String, required: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    yield: { type: Number, default: 1 }, // How many servings this recipe produces
    ingredients: [recipeIngredientSchema],
    instructions: { type: String, default: "" },
    prepTimeMin: { type: Number, default: 0 },
    costPerServing: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

recipeSchema.index({ restaurantId: 1 });
recipeSchema.index({ menuItemId: 1 });

// ===== Vendor =====
const vendorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    contactPerson: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    address: { type: String, default: "" },
    itemsSupplied: [{ type: String }],
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ===== Purchase Order =====
const purchaseOrderItemSchema = new mongoose.Schema(
  {
    ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient" },
    ingredientName: { type: String, required: true },
    quantity: { type: Number, required: true },
    unit: { type: String, required: true },
    unitCost: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
  },
  { _id: false }
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
    vendorName: { type: String, default: "" },
    poNumber: { type: String, required: true },
    items: [purchaseOrderItemSchema],
    status: {
      type: String,
      enum: ["draft", "sent", "received", "cancelled", "partially_received"],
      default: "draft",
    },
    totalAmount: { type: Number, default: 0 },
    expectedDeliveryDate: Date,
    receivedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

purchaseOrderSchema.index({ restaurantId: 1, status: 1 });
purchaseOrderSchema.index({ poNumber: 1 }, { unique: true });

// ===== Stock Movement / Waste =====
const stockMovementSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient", required: true },
    ingredientName: { type: String, required: true },
    type: {
      type: String,
      enum: ["purchase", "sale", "waste", "adjustment", "transfer"],
      required: true,
    },
    quantity: { type: Number, required: true }, // positive for in, negative for out
    unit: { type: String, required: true },
    reason: { type: String, default: "" },
    referenceId: { type: String, default: "" }, // order ID, PO ID, etc.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

stockMovementSchema.index({ restaurantId: 1, createdAt: -1 });
stockMovementSchema.index({ ingredientId: 1 });
stockMovementSchema.index({ type: 1 });

module.exports = {
  Ingredient: mongoose.model("Ingredient", ingredientSchema),
  Recipe: mongoose.model("Recipe", recipeSchema),
  Vendor: mongoose.model("Vendor", vendorSchema),
  PurchaseOrder: mongoose.model("PurchaseOrder", purchaseOrderSchema),
  StockMovement: mongoose.model("StockMovement", stockMovementSchema),
};