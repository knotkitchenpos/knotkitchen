const mongoose = require("mongoose");

/**
 * A store's list of modifier groups, on the server.
 *
 * A group attached to products also lives on each product
 * (Menu.items[].modifierGroups) -- that is what the tills, QR and website
 * sell from. This list is what Manage Menu shows, including groups not yet
 * attached to anything. It used to be kept in each device's browser, so a
 * group deleted on the laptop stayed listed on the tablet (and one created
 * with no products never reached the other devices at all).
 *
 * Scoped like the menu (services/tenantContext userScope): restaurantId, or
 * createdBy for a user with no restaurant.
 */
const optionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const menuGroupSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    name: { type: String, required: true, trim: true },
    required: { type: Boolean, default: false },
    maxSelectionEnabled: { type: Boolean, default: false },
    maxSelections: { type: Number, default: 1, min: 1 },
    options: { type: [optionSchema], default: [] },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// One group per name per store: the name is how products refer to it.
menuGroupSchema.index({ restaurantId: 1, createdBy: 1, name: 1 }, { unique: true });

module.exports = mongoose.models.MenuGroup || mongoose.model("MenuGroup", menuGroupSchema);
