/**
 * Order history as CSV, for the owner to keep their own copy (any period: a
 * month, a financial year, ten years). One row per order.
 *
 * Phones are masked exactly as on the reports screen. Every cell is quoted,
 * and a cell that a spreadsheet would run as a formula (=, +, -, @, tab, CR)
 * is prefixed with an apostrophe, so a dish or customer name can never
 * execute when the file is opened.
 */
const HEADER = [
  "Date", "Time", "Order no", "Bill no", "Source", "Order type", "Status",
  "Customer", "Phone", "Company", "GSTIN", "Items",
  "Subtotal", "Discount", "Tax", "Tax %", "Service charge", "Delivery fee", "Packaging fee",
  "Total", "Tip", "Payment", "Payment status", "Refunded", "Net",
];

const cell = (v) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

const money = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "");

const itemsText = (items) =>
  (items || [])
    .filter((i) => i && i.name)
    .map((i) => `${i.name}${i.variant?.name ? ` (${i.variant.name})` : ""} x${i.quantity || 1}`)
    .join("; ");

/**
 * @param {object} o        an order already passed through reportOrderView
 * @param {object} helpers  { localDate, localTime, orderTotal, refundedTotal, netAmount }
 */
const orderRow = (o, h) => {
  const placed = o.createdAt ? new Date(o.createdAt) : null;
  const b = o.bills || {};
  const c = o.customerDetails || {};
  return [
    placed ? h.localDate(placed) : "",
    placed ? h.localTime(placed) : "",
    o.orderNumber || String(o._id || ""),
    // The GST bill serial (services/billNumber); blank on bills from before it.
    o.billNumber || "",
    o.source || "",
    o.orderType || "",
    o.orderStatus || "",
    c.name || "",
    c.phone || "",
    c.company || "",
    c.gstin || "",
    itemsText(o.items),
    money(b.subtotal),
    money(b.discount),
    money(b.tax),
    b.taxPercent ? String(b.taxPercent) : "",
    money(b.serviceCharge),
    money(b.deliveryFee),
    money(b.packagingFee),
    money(h.orderTotal(o)),
    money(b.tip),
    o.paymentLabel || "",
    o.paymentStatus || "",
    money(h.refundedTotal(o)),
    money(h.netAmount(o)),
  ].map(cell).join(",");
};

const headerLine = () => HEADER.map(cell).join(",");

module.exports = { headerLine, orderRow, cell, HEADER };
