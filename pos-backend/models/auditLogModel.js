const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    storeId: { type: String, default: "", index: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    phone: { type: String, default: "" },
    role: { type: String, default: "" },
    action: { type: String, required: true },
    resource: { type: String, required: true },
    entityType: { type: String, default: "" },
    entityId: { type: mongoose.Schema.Types.Mixed, default: null },
    resourceId: { type: mongoose.Schema.Types.Mixed, default: null },
    description: { type: String, default: "" },
    previousValue: { type: mongoose.Schema.Types.Mixed, default: "" },
    newValue: { type: mongoose.Schema.Types.Mixed, default: "" },
    dateFormatted: { type: String, default: "" },
    timeFormatted: { type: String, default: "" },
    timestamp: { type: Date, default: Date.now },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    severity: {
      type: String,
      enum: ["INFO", "WARNING", "ERROR", "CRITICAL"],
      default: "INFO",
    },
  },
  { timestamps: true }
);

// Indexes for fast lookup and filtering
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ storeId: 1, createdAt: -1 });
auditLogSchema.index({ restaurantId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ phone: 1, createdAt: -1 });
auditLogSchema.index({ resource: 1 });

module.exports = mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);
