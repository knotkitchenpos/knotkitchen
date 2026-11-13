/**
 * GST bill numbers: one consecutive series per store and financial year
 * (CGST Rule 46: a consecutive serial number of at most 16 characters, unique
 * for the financial year). "2627/000123" is the 123rd bill of the store's
 * financial year 2026-27 (1 April 2026 to 31 March 2027, IST).
 *
 * The random `orderNumber` (services/orderNumberService) stays as the order
 * and ticket reference staff and customers already use; `billNumber` is the
 * invoice serial the bill carries for GST. It is issued once, when the order
 * is first saved (models/orderModel), so every channel is covered: till,
 * website, QR, table, Swiggy/Zomato and offline sales when they sync. A
 * cancelled bill keeps its number: GSTR-1 counts it as cancelled.
 *
 * Bills issued before this existed keep the numbers they were printed with;
 * nothing is renumbered after the fact.
 */
const mongoose = require("mongoose");

const billCounterSchema = new mongoose.Schema(
  {
    // `bill:<restaurantId>:<FY>`, e.g. bill:65f...:2627
    key: { type: String, required: true, unique: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    fy: { type: String, default: "" },
    seq: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const BillCounter = mongoose.models.BillCounter || mongoose.model("BillCounter", billCounterSchema);

/** "2627" for any moment from 1 April 2026 to 31 March 2027, in India's time. */
const financialYearOf = (date = new Date()) => {
  const d = new Date(date);
  const ist = new Date((Number.isNaN(d.getTime()) ? Date.now() : d.getTime()) + 5.5 * 3600 * 1000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1; // April is month 3
  const yy = (n) => String(n % 100).padStart(2, "0");
  return `${yy(start)}${yy(start + 1)}`;
};

const formatBillNumber = (fy, seq) => `${fy}/${String(seq).padStart(6, "0")}`;

/** "2627/000123" -> { fy: "2627", seq: 123 }, or null. */
const parseBillNumber = (value) => {
  const m = /^(\d{4})\/(\d{6,})$/.exec(String(value || ""));
  return m ? { fy: m[1], seq: Number(m[2]) } : null;
};

/** The store's next bill number for the financial year `date` falls in. Atomic. */
const nextBillNumber = async (restaurantId, date = new Date()) => {
  const fy = financialYearOf(date);
  const counter = await BillCounter.findOneAndUpdate(
    { key: `bill:${restaurantId}:${fy}` },
    { $inc: { seq: 1 }, $setOnInsert: { restaurantId, fy } },
    { upsert: true, new: true },
  );
  return formatBillNumber(fy, counter.seq);
};

/**
 * A number issued to an order whose save then failed (a double tap the
 * idempotency index refused, a validation error). The series must not just
 * skip it: the accountant exports report a void number as a cancelled
 * document, unless an order did end up with it (a retry that saved the same
 * order again).
 */
const billVoidSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    billNumber: { type: String, required: true },
    reason: { type: String, default: "" },
  },
  { timestamps: true },
);
billVoidSchema.index({ restaurantId: 1, billNumber: 1 }, { unique: true });
const BillVoid = mongoose.models.BillVoid || mongoose.model("BillVoid", billVoidSchema);

const voidBillNumber = (restaurantId, billNumber, reason = "") =>
  BillVoid.updateOne(
    { restaurantId, billNumber },
    { $setOnInsert: { restaurantId, billNumber, reason: String(reason).slice(0, 200) } },
    { upsert: true },
  ).catch(() => {});

module.exports = { BillCounter, BillVoid, financialYearOf, formatBillNumber, parseBillNumber, nextBillNumber, voidBillNumber };
