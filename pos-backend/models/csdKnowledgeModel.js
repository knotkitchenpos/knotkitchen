const mongoose = require("mongoose");

/**
 * CSD knowledge base: internal how-to articles. An article can also carry a
 * ready answer for customers (`quickReply`, inserted in the WhatsApp composer
 * with /shortcut), and articles are what AI reply suggestions draw on.
 * Archived rather than deleted, so an answer someone relied on can be found.
 */
const articleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, default: "General", trim: true, maxlength: 60 },
    body: { type: String, default: "", maxlength: 20000 },
    quickReply: { type: String, default: "", maxlength: 4000 },
    shortcut: { type: String, default: "", lowercase: true, trim: true, maxlength: 40 },
    archived: { type: Boolean, default: false, index: true },
    createdById: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff" },
    createdByName: { type: String, default: "" },
    updatedByName: { type: String, default: "" },
  },
  { timestamps: true }
);
articleSchema.index({ title: "text", body: "text", quickReply: "text" });
articleSchema.index(
  { shortcut: 1 },
  { unique: true, partialFilterExpression: { shortcut: { $gt: "" }, archived: false } }
);

module.exports = mongoose.model("CsdKbArticle", articleSchema);
