const mongoose = require("mongoose");

const pluginConfigSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    category: {
      type: String,
      enum: ["pos", "delivery", "payment", "sms", "email", "accounting", "erp", "marketing"],
      required: true,
    },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    provider: { type: String, default: "" },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    credentials: { type: mongoose.Schema.Types.Mixed, default: {} }, // encrypted at app level
    enabled: { type: Boolean, default: false },
    status: { type: String, enum: ["connected", "disconnected", "error"], default: "disconnected" },
    webhookUrl: { type: String, default: "" },
    lastSyncAt: Date,
    syncStatus: { type: String, enum: ["idle", "syncing", "success", "failed"], default: "idle" },
    isDeleted: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

pluginConfigSchema.index({ restaurantId: 1, category: 1 });
module.exports = mongoose.model("PluginConfig", pluginConfigSchema);