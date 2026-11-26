// Invoice PDF, made on the phone. jsPDF's built-in fonts have no ₹ sign, so amounts print as "Rs.".
import { jsPDF } from "jspdf";
import { rs, num, amountInWords } from "./money.js";
import { lineAmount } from "./tax.js";
import { dateLabel } from "./fy.js";

const latin1 = (s) =>
  String(s ?? "")
    .replace(/\u20B9/g, "Rs.")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\t\n\x20-\x7E\xA0-\xFF]/g, "?");

export const invoicePdf = (inv, firm) => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const L = 15;
  const R = W - 15;
  const t = inv.totals || {};
  const registered = t.type && t.type !== "unregistered";
  let y = 18;

  const text = (s, x, yy, o = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(o.size || 9.5);
    doc.text(latin1(s), x, yy, { align: o.align || "left", maxWidth: o.max });
  };
  const wrap = (s, x, yy, max, o = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(o.size || 9.5);
    const lines = doc.splitTextToSize(latin1(s), max);
    doc.text(lines, x, yy);
    return yy + lines.length * (o.size || 9.5) * 0.42;
  };

  // Header: firm on the left, title on the right.
  text(firm.name, L, y, { bold: true, size: 16 });
  text(registered ? "TAX INVOICE" : "INVOICE", R, y, { bold: true, size: 14, align: "right" });
  y += 6;
  let fy = wrap(firm.address, L, y, 105);
  const ids = [firm.state && `State: ${firm.state}`, registered && firm.gstin && `GSTIN: ${firm.gstin}`, firm.pan && `PAN: ${firm.pan}`, firm.phone && `Phone: ${firm.phone}`, firm.email && `Email: ${firm.email}`].filter(Boolean);
  for (const line of ids) fy = wrap(line, L, fy, 105);
  let ry = y;
  for (const [k, v] of [["Invoice no.", inv.no], ["Date", dateLabel(inv.date)], ["Place of supply", inv.pos || firm.state]]) {
    text(k, 140, ry, { size: 9 });
    text(v, R, ry, { bold: true, size: 9, align: "right" });
    ry += 5;
  }
  y = Math.max(fy, ry) + 4;
  if (!registered) {
    text("Supplier not registered under GST", L, y, { bold: true, size: 9 });
    y += 6;
  }
  doc.setDrawColor(200);
  doc.line(L, y, R, y);
  y += 6;

  // Bill to
  text("BILL TO", L, y, { bold: true, size: 8.5 });
  y += 5;
  text(inv.client, L, y, { bold: true, size: 11 });
  y += 5;
  if (inv.clientAddress) y = wrap(inv.clientAddress, L, y, 120);
  if (inv.clientGstin) y = wrap(`GSTIN: ${inv.clientGstin}`, L, y, 120);
  y += 4;

  // Items
  const cols = registered
    ? [["#", L, "left"], ["Description", L + 8, "left"], ["SAC", 112, "left"], ["Qty", 135, "right"], ["Rate", 158, "right"], ["GST %", 172, "right"], ["Amount", R, "right"]]
    : [["#", L, "left"], ["Description", L + 8, "left"], ["SAC", 120, "left"], ["Qty", 145, "right"], ["Rate", 168, "right"], ["Amount", R, "right"]];
  doc.setFillColor(16, 20, 24);
  doc.rect(L, y - 4.5, R - L, 7, "F");
  doc.setTextColor(255);
  for (const [h, x, a] of cols) text(h, a === "right" ? x - 1 : x + 1, y, { bold: true, size: 8.5, align: a });
  doc.setTextColor(0);
  y += 8;
  (inv.items || []).forEach((it, i) => {
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
    const descEnd = wrap(it.desc, L + 9, y, registered ? 84 : 92);
    const cells = registered
      ? [String(i + 1), null, it.sac, num(it.qty).replace(/\.00$/, ""), num(it.rate), `${Number(it.gst) || 0}%`, num(lineAmount(it))]
      : [String(i + 1), null, it.sac, num(it.qty).replace(/\.00$/, ""), num(it.rate), num(lineAmount(it))];
    cells.forEach((c, j) => {
      if (c === null) return;
      const [, x, a] = cols[j];
      text(c, a === "right" ? x - 1 : x + 1, y, { align: a });
    });
    y = Math.max(descEnd, y + 4) + 2;
    doc.setDrawColor(230);
    doc.line(L, y - 2, R, y - 2);
  });

  // Totals
  y += 3;
  const totalRow = (k, v, bold) => {
    text(k, 150, y, { bold, size: bold ? 10.5 : 9.5, align: "right" });
    text(v, R - 1, y, { bold, size: bold ? 10.5 : 9.5, align: "right" });
    y += bold ? 7 : 5.5;
  };
  totalRow("Taxable value", rs(t.taxable));
  if (t.type === "intra") {
    totalRow("CGST", rs(t.cgst));
    totalRow("SGST", rs(t.sgst));
  }
  if (t.type === "inter") totalRow("IGST", rs(t.igst));
  doc.setDrawColor(16, 20, 24);
  doc.line(110, y - 3.5, R, y - 3.5);
  y += 1.5;
  totalRow("Total", rs(t.total), true);
  y = wrap(`Amount in words: ${amountInWords(t.total)}`, L, y + 2, R - L, { bold: true, size: 9 }) + 3;

  if (inv.notes) y = wrap(`Notes: ${inv.notes}`, L, y, R - L, { size: 9 }) + 3;

  // Bank details and signatory
  if (y > 245) {
    doc.addPage();
    y = 20;
  }
  const bank = [["Bank", firm.bankName], ["A/c no.", firm.bankAccount], ["IFSC", firm.bankIfsc], ["Branch", firm.bankBranch]].filter(([, v]) => v);
  const top = y + 4;
  if (bank.length) {
    text("BANK DETAILS", L, top, { bold: true, size: 8.5 });
    bank.forEach(([k, v], i) => text(`${k}: ${v}`, L, top + 5 + i * 4.6, { size: 9 }));
  }
  text(`For ${firm.name}`, R, top, { bold: true, size: 9.5, align: "right" });
  text("Authorised Signatory", R, top + 22, { size: 9, align: "right" });
  doc.setDrawColor(150);
  doc.line(R - 50, top + 18, R, top + 18);

  return doc.output("blob");
};

export const invoiceFileName = (inv) => `Invoice-${String(inv.no || "draft").replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;
