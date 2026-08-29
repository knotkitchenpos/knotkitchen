const mongoose = require("mongoose");

/**
 * A compliance/KYC document held against one store (§30).
 *
 * Deletion is a soft delete even though only an admin can do it. These are the
 * records that answer "was this restaurant licensed when we onboarded them?",
 * so the fact that a GST certificate once existed and was removed is itself
 * worth keeping. The bytes ARE destroyed on delete — only the metadata and the
 * audit trail survive.
 */

const CATEGORIES = [
  "Signed Agreement",
  "GST Certificate",
  "FSSAI License",
  "PAN / KYC",
  "Business License",
  "Bank Statement",
  "Restaurant Photo",
  "Other Document",
];

/**
 * Maps the onboarding portal's file keys onto categories. The portal names
 * its uploads by purpose (`doc_pan`, `doc_gst`), so the category is derived
 * rather than guessed from a filename a sales agent chose.
 */
const categoryForFileKey = (key = "", fileName = "") => {
  const k = `${key} ${fileName}`.toLowerCase();
  if (/agreement|signed|contract/.test(k)) return "Signed Agreement";
  if (/gst/.test(k)) return "GST Certificate";
  if (/fssai|food.?licen/.test(k)) return "FSSAI License";
  if (/pan|aadhaar|aadhar|kyc|identity/.test(k)) return "PAN / KYC";
  if (/bank|statement|cheque|passbook/.test(k)) return "Bank Statement";
  if (/licen/.test(k)) return "Business License";
  if (/logo|photo|image|storefront/.test(k)) return "Restaurant Photo";
  return "Other Document";
};

const csdStoreDocumentSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true, index: true },

    category: { type: String, enum: CATEGORIES, default: "Other Document", index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    originalName: { type: String, default: "" },

    // Path within the private documents root. Never sent to the browser —
    // the client addresses documents by their id, not their storage key.
    //
    // Required only while the document is live: deleting destroys the bytes
    // and clears the key, so a blanket `required: true` would make the
    // soft-delete save fail validation.
    storageKey: {
      type: String,
      required: function required() {
        return !this.isDeleted;
      },
      default: "",
    },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    checksum: { type: String, default: "" },

    // "agreement" — imported when the store was created from a signed
    // agreement; "upload" — added later by CSD.
    source: { type: String, enum: ["agreement", "upload"], default: "upload" },
    sourceAgreementId: { type: String, default: "" },
    sourceFileKey: { type: String, default: "" },

    uploadedById: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff" },
    uploadedByStaffId: { type: String, default: "" },
    uploadedByName: { type: String, default: "" },

    // Set when this document replaced an earlier version of itself, so
    // "Last updated" in the UI is meaningful rather than just createdAt.
    replacedAt: { type: Date, default: null },
    replacedByName: { type: String, default: "" },

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedByName: { type: String, default: "" },
  },
  { timestamps: true }
);

csdStoreDocumentSchema.index({ storeId: 1, isDeleted: 1, createdAt: -1 });
// One import per agreement file, so re-running an import cannot duplicate.
csdStoreDocumentSchema.index(
  { sourceAgreementId: 1, sourceFileKey: 1 },
  { unique: true, partialFilterExpression: { source: "agreement", isDeleted: false } }
);

module.exports = mongoose.model("CsdStoreDocument", csdStoreDocumentSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.categoryForFileKey = categoryForFileKey;
