/**
 * KK-<storeId>-0001, and never the same number twice.
 *
 * `findOneAndUpdate` with `$inc` and `upsert` is atomic in MongoDB, so two
 * invoices issued in the same instant cannot take the same sequence. The same
 * approach the order numbers use -- see models/orderCounterModel.js for the
 * fuller reasoning.
 *
 * The unique index on `PlatformInvoice.invoiceNumber` is the backstop. It is
 * not expected to fire; if it ever does, something has bypassed this.
 */

const mongoose = require("mongoose");

const invoiceCounterSchema = new mongoose.Schema(
  {
    // One counter per store, so each restaurant's invoices read 0001, 0002 …
    // rather than sharing a platform-wide sequence that tells every customer
    // how many other customers there are.
    key: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const InvoiceCounter =
  mongoose.models.InvoiceCounter || mongoose.model("InvoiceCounter", invoiceCounterSchema);

const PREFIX = "KK";

const format = (storeId, seq) =>
  `${PREFIX}-${String(storeId || "000000")}-${String(seq).padStart(4, "0")}`;

const nextInvoiceNumber = async (storeId) => {
  const key = `invoice:${storeId || "unknown"}`;
  const counter = await InvoiceCounter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return format(storeId, counter.seq);
};

module.exports = { nextInvoiceNumber, format, InvoiceCounter, PREFIX };
