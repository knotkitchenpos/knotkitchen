const mongoose = require("mongoose");

// KnotKitchen Books (the partners' own accounting app, books/). Nothing here
// belongs to a restaurant. One collection of synced records: invoices,
// expenses, partner entries and the firm's settings, each a client-made id.
const booksRecordSchema = new mongoose.Schema(
  {
    _id: { type: String },
    kind: { type: String, enum: ["invoice", "expense", "capital", "settings"], required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    deleted: { type: Boolean, default: false },
    by: { type: String, default: "" },
    updatedAt: { type: Date, default: Date.now, index: true },
  },
  { collection: "books_records", versionKey: false, minimize: false }
);
// Invoice numbers are unique among live invoices.
booksRecordSchema.index(
  { "data.no": 1 },
  { unique: true, partialFilterExpression: { kind: "invoice", deleted: false } }
);

// Who may use the app: { _id: "access", allowedUsers: [emails] }.
const booksConfigSchema = new mongoose.Schema(
  { _id: { type: String }, allowedUsers: { type: [String], default: [] } },
  { collection: "books_config", versionKey: false }
);

module.exports = {
  BooksRecord: mongoose.model("BooksRecord", booksRecordSchema),
  BooksConfig: mongoose.model("BooksConfig", booksConfigSchema),
};
