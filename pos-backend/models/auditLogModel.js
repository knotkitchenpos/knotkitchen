const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    action: { type: String, required: true },
    resource: { type: String, required: true },
    resourceId: { type: mongoose.Schema.Types.Mixed },
    description: { type: String, default: "" },
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

// Indexes for fast lookup
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ restaurantId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ resource: 1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);