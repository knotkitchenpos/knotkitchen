const mongoose = require("mongoose");

/**
 * TableQR — dedicated secure QR entity per table.
 *
 * Each active QR contains a single non-guessable token. The token is the
 * ONLY thing a customer presents; restaurantId/outletId/tableId are never
 * accepted from the client. The backend resolves the token to the exact
 * table record bound to that QR.
 */
const tableQRSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true,
    },
    outletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Outlet",
      // Optional: single-outlet installs (and legacy users created before
      // multi-outlet was introduced) don't carry an outletId on the user
      // document, and tables inherit the same behaviour. Requiring it
      // caused `TableQR validation failed: Path 'outletId' is required.`
      // on every getOrCreateQr call for those tenants. Tenant isolation
      // stays intact via `restaurantId` (which IS required).
      default: null,
    },
    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Table",
      required: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "REVOKED"],
      default: "ACTIVE",
    },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    revokedReason: { type: String, default: "" },
    qrUrl: { type: String, default: "" },
    label: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastDownloadedAt: { type: Date, default: null },
    lastPrintedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Only one ACTIVE QR per table at a time — regeneration revokes the previous
// one. `isDeleted: false` (the default on every document), never `$ne`: a
// partial index filter cannot use $ne (see orderModel).
tableQRSchema.index(
  { tableId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "ACTIVE", isDeleted: false } }
);

// Fast tenant + outlet lookups for admin queries
tableQRSchema.index({ restaurantId: 1, outletId: 1, status: 1, createdAt: -1 });
tableQRSchema.index({ tableId: 1, createdAt: -1 });

module.exports = mongoose.model("TableQR", tableQRSchema);
