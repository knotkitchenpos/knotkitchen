// Invoice and expense tax rules. All amounts in rupees.
import { r2 } from "./money.js";

export const FOOD = "Food & entertainment";
export const STOCK = "Devices for resale (stock)";

// Registered on a date = GSTIN entered AND that date is on/after the registration date.
export const isRegistered = (firm, date) => !!(firm?.gstin && firm?.gstFrom && date && date >= firm.gstFrom);

export const lineAmount = (it) => r2((Number(it.qty) || 0) * (Number(it.rate) || 0));

/**
 * Totals for an invoice.
 * type: "unregistered" (no GST), "intra" (CGST + SGST, place of supply = firm state) or "inter" (IGST).
 */
export const invoiceTotals = (inv, firm) => {
  const items = inv.items || [];
  const taxable = r2(items.reduce((s, it) => s + lineAmount(it), 0));
  const registered = isRegistered(firm, inv.date);
  if (!registered) return { taxable, cgst: 0, sgst: 0, igst: 0, total: taxable, type: "unregistered" };

  const tax = items.reduce((s, it) => s + (lineAmount(it) * (Number(it.gst) || 0)) / 100, 0);
  if ((inv.pos || firm.state) === firm.state) {
    const half = r2(tax / 2);
    return { taxable, cgst: half, sgst: half, igst: 0, total: r2(taxable + 2 * half), type: "intra" };
  }
  const igst = r2(tax);
  return { taxable, cgst: 0, sgst: 0, igst, total: r2(taxable + igst), type: "inter" };
};

export const paidOf = (inv) => r2((inv.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
export const balanceOf = (inv) => r2((inv.totals?.total || 0) - paidOf(inv));
export const statusOf = (inv) => {
  const paid = paidOf(inv);
  if (paid <= 0) return "Unpaid";
  return balanceOf(inv) <= 0.004 ? "Paid" : "Part paid";
};

// Next number in the series PREFIX/FY/###, after the highest one already used.
export const nextInvoiceNo = (prefix, fy, invoices) => {
  const head = `${prefix}/${fy}/`;
  const max = invoices
    .map((i) => i.no || "")
    .filter((n) => n.startsWith(head))
    .map((n) => Number(n.slice(head.length)) || 0)
    .reduce((a, b) => Math.max(a, b), 0);
  return head + String(max + 1).padStart(3, "0");
};

/**
 * One expense's GST and what it costs the business.
 * ITC is claimable only if: registered on the bill date, vendor GSTIN present,
 * bill in the firm's name, business use, and not food & entertainment.
 */
export const expenseTax = (e, firm) => {
  const amount = r2(e.amount);
  const gst = e.taxType === "none" ? 0 : r2((amount * (Number(e.gstRate) || 0)) / 100);
  const igst = e.taxType === "igst" ? gst : 0;
  const cgst = e.taxType === "cgst_sgst" ? r2(gst / 2) : 0;
  const sgst = e.taxType === "cgst_sgst" ? r2(gst - cgst) : 0;
  const registered = isRegistered(firm, e.date);
  const hasGstin = !!(e.vendorGstin || "").trim();
  const inFirmName = e.inFirmName !== false;
  const businessUse = e.businessUse !== false;
  const claimable = gst > 0 && registered && hasGstin && inFirmName && businessUse && e.category !== FOOD;
  return {
    amount,
    gst,
    cgst,
    sgst,
    igst,
    claimable,
    itc: claimable ? { cgst, sgst, igst } : { cgst: 0, sgst: 0, igst: 0 },
    maybeAtRegistration: !registered && e.category === STOCK && hasGstin && gst > 0,
    notInFirmName: !inFirmName,
    cost: claimable ? amount : r2(amount + gst),
  };
};
