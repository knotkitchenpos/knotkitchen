const mongoose = require("mongoose");

const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    permissions: [{ type: String }], // e.g. ["orders.read", "orders.write", "menu.edit"]
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

teamSchema.index({ restaurantId: 1 });
teamSchema.index({ outletId: 1 });

module.exports = mongoose.model("Team", teamSchema);