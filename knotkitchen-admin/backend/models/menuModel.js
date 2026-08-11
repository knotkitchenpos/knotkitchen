const mongoose = require("mongoose");

const modifierOptionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, default: 0 },
  isAvailable: { type: Boolean, default: true },
});

const modifierGroupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  required: { type: Boolean, default: false },
  maxSelections: { type: Number, default: 1 },
  options: [modifierOptionSchema],
});

const variantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  isAvailable: { type: Boolean, default: true },
});

const addonSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, default: 0 },
  isAvailable: { type: Boolean, default: true },
});

const priceRuleSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  startTime: { type: String, default: "00:00" },
  endTime: { type: String, default: "23:59" },
  daysOfWeek: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
  isActive: { type: Boolean, default: true },
});

const scheduleSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  startTime: { type: String, default: "09:00" },
  endTime: { type: String, default: "23:00" },
  daysOfWeek: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
});

const menuItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, required: true },
  isAvailable: { type: Boolean, default: true },
  description: { type: String, default: "" },
  image: { type: String, default: "" },
  variants: { type: [variantSchema], default: [] },
  addons: { type: [addonSchema], default: [] },
  modifierGroups: { type: [modifierGroupSchema], default: [] },
  isCombo: { type: Boolean, default: false },
  comboDescription: { type: String, default: "" },
  comboItems: { type: [String], default: [] },
  priceRules: { type: [priceRuleSchema], default: [] },
  schedule: { type: scheduleSchema, default: () => ({}) },
  nutrition: { type: mongoose.Schema.Types.Mixed, default: {} },
  allergens: { type: [String], default: [] },
  isVegetarian: { type: Boolean, default: false },
});

const versionSnapshotSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    publishedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const menuSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    bgColor: { type: String, default: "#5b45b0" },
    icon: { type: String, default: "🍽️" },
    items: [menuItemSchema],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    isDeleted: { type: Boolean, default: false },
    schedule: { type: scheduleSchema, default: () => ({}) },
    version: { type: Number, default: 1 },
    published: { type: Boolean, default: true },
    isPublished: { type: Boolean, default: true },
    publishedAt: { type: Date, default: null },
    versionHistory: { type: [versionSnapshotSchema], default: [] },
  },
  { timestamps: true }
);

menuSchema.index({ restaurantId: 1, isDeleted: 1 });
menuSchema.index({ restaurantId: 1, published: 1 });

module.exports = mongoose.models.Menu || mongoose.model("Menu", menuSchema);