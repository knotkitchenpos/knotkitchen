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
    // Maximum stock: 0 means none set. Status: services/inventory.js#stockStatus.
    maxLevel: { type: Number, default: 0 },
    costPerUnit: { type: Number, default: 0 },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
    batch: {
      batchNumber: String,
      expiryDate: Date,
      receivedDate: Date,
    },
    shelfLifeDays: { type: Number, default: 0 },
    isLowStock: { type: Boolean, default: false },

    // Bought in packs, used in the item's own unit (owner, 2026-11-01): a
    // tray of 30 eggs, a box of 12 L milk. size is in the item's unit.
    packs: {
      type: [{ name: { type: String, trim: true }, size: { type: Number, min: 0 }, _id: false }],
      default: [],
    },

    // A prepared item (gravy, dough, sauce) is made in batches from other
    // items: making one takes these off the shelf and puts `makes` of this
    // item on it. Dishes then use it like any other item.
    isPrepared: { type: Boolean, default: false },
    prep: {
      makes: { type: Number, default: 1 }, // in this item's unit
      ingredients: {
        type: [{ ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient" }, quantity: Number, unit: String, _id: false }],
        default: [],
      },
    },

    // What is on the shelf with a use-by date, oldest first. Stock taken off
    // the shelf comes out of the oldest batch first (services/inventory
    // trimBatches), so their total never exceeds stockQuantity; stock bought
    // without a date simply has no batch.
    batches: {
      type: [{ quantity: Number, expiryDate: Date, receivedAt: { type: Date, default: Date.now }, _id: false }],
      default: [],
    },
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
      // production: a prepared item made (in) or the items it used (out).
      // count: a stock count's correction.
      // return: a sale's stock put back, its order cancelled soon after it was placed.
      enum: ["purchase", "sale", "waste", "adjustment", "transfer", "production", "count", "return"],
      required: true,
    },
    quantity: { type: Number, required: true }, // positive for in, negative for out
    unit: { type: String, required: true },
    reason: { type: String, default: "" },
    referenceId: { type: String, default: "" }, // order ID, PO ID, etc.
    // What a purchase cost in total (₹); 0 for everything else.
    cost: { type: Number, default: 0 },
    // What the quantity was worth at the item's cost price then (₹, signed
    // like quantity): the inventory reports add these, so a later price
    // change never rewrites last month's wastage.
    value: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

stockMovementSchema.index({ restaurantId: 1, createdAt: -1 });
stockMovementSchema.index({ ingredientId: 1 });
stockMovementSchema.index({ type: 1 });

// ===== Add-on recipe =====
// What one portion of an add-on option or a size uses on top of the dish's
// own recipe (owner, 2026-11-01): Extra Cheese takes 30 g of cheese.
//   option   a modifier group's option, by its names (group names are unique
//            per store, and order lines record both names)
//   variant  a product's size or variant, by the product and the variant name
const addonRecipeSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    kind: { type: String, enum: ["option", "variant"], required: true },
    groupName: { type: String, default: "" },
    optionName: { type: String, default: "" },
    menuItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
    variantName: { type: String, default: "" },
    ingredients: { type: [recipeIngredientSchema], default: [] },
  },
  { timestamps: true }
);
addonRecipeSchema.index({ restaurantId: 1, kind: 1, groupName: 1, optionName: 1, menuItemId: 1, variantName: 1 }, { unique: true });

// ===== Stock count =====
// Staff count the shelf; on finishing, each counted item is set to what was
// counted and the difference is kept, in quantity and ₹ (owner, 2026-11-01).
const stockCountSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    number: { type: Number, required: true },
    status: { type: String, enum: ["open", "done", "cancelled"], default: "open" },
    lines: {
      type: [{
        ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient" },
        name: String,
        unit: String,
        category: String,
        counted: { type: Number, default: null }, // null: not counted, left as it is
        expected: { type: Number, default: 0 },   // the stock when the count was finished
        costPerUnit: { type: Number, default: 0 },
        _id: false,
      }],
      default: [],
    },
    note: { type: String, default: "" },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    finishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    finishedAt: Date,
  },
  { timestamps: true }
);
stockCountSchema.index({ restaurantId: 1, number: -1 });

module.exports = {
  AddonRecipe: mongoose.model("AddonRecipe", addonRecipeSchema),
  StockCount: mongoose.model("StockCount", stockCountSchema),
  Ingredient: mongoose.model("Ingredient", ingredientSchema),
  Recipe: mongoose.model("Recipe", recipeSchema),
  Vendor: mongoose.model("Vendor", vendorSchema),
  PurchaseOrder: mongoose.model("PurchaseOrder", purchaseOrderSchema),
  StockMovement: mongoose.model("StockMovement", stockMovementSchema),
};