const mongoose = require("mongoose");

/**
 * MediaAsset — a store-isolated media library record (§6).
 *
 * Binary data is NEVER stored in MongoDB. The bytes live in the configured
 * object/file storage provider (see services/storage/) and this document only
 * holds metadata + the resolved public URL(s).
 *
 * Every record is bound to BOTH storeId and restaurantId so that a query can
 * be scoped by whichever identifier the caller was authenticated with. Store A
 * can never read Store B's assets because every controller filters on the
 * tenant resolved from the session — never from the request body.
 */
const mediaAssetSchema = new mongoose.Schema(
  {
    // --- Tenancy (required, always enforced) ---
    storeId: { type: String, required: true, index: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", index: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet", default: null },

    // --- File identity ---
    fileName: { type: String, required: true },       // sanitized original name
    storageKey: { type: String, required: true },     // provider-side key/path
    provider: { type: String, default: "local" },     // local | cloudinary | s3 | r2 | supabase
    mimeType: { type: String, required: true },
    size: { type: Number, default: 0 },               // bytes
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },

    // --- Public URLs ---
    url: { type: String, required: true },
    thumbnailUrl: { type: String, default: "" },

    // --- Library metadata ---
    altText: { type: String, default: "", maxlength: 200 },
    folder: {
      type: String,
      enum: ["general", "products", "categories", "logo", "cover", "offers", "gallery"],
      default: "general",
    },
    tags: { type: [String], default: [] },

    /**
     * Usage tracking (§6 "Usage/reference information").
     * Lets the UI warn before deleting an image that a product still uses,
     * and powers the "reuse existing image" flow (§7).
     */
    usage: {
      type: [
        {
          type: { type: String, enum: ["product", "category", "logo", "favicon", "cover", "offer", "gallery"] },
          refId: { type: String, default: "" },
          label: { type: String, default: "" },
          _id: false,
        },
      ],
      default: [],
    },

    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Primary library listing query: newest-first within a store.
mediaAssetSchema.index({ storeId: 1, isDeleted: 1, createdAt: -1 });
mediaAssetSchema.index({ restaurantId: 1, isDeleted: 1, createdAt: -1 });
// Search by file name / alt text within a store.
mediaAssetSchema.index({ storeId: 1, fileName: "text", altText: "text" });
mediaAssetSchema.index({ storageKey: 1 });

module.exports = mongoose.model("MediaAsset", mediaAssetSchema);
