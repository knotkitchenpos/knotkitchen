/**
 * KnotKitchen's invoice as a PDF file, for "Download PDF" (owner, 2026-10-31).
 *
 * The same document as services/invoiceDocument.js, drawn for A4 with pdfkit:
 * a phone app's WebView cannot print a page to PDF, so the file is made here.
 * Like the page, it renders the stored invoice only: nothing is recomputed.
 *
 * Noto Sans (assets/fonts, SIL Open Font License) is embedded: PDF's built-in
 * fonts have no ₹.
 */

const path = require("path");
const PDFDocument = require("pdfkit");
const { formatAmount, formatINR } = require("./money");
const { taxColumns } = require("./invoiceDocument");

const FONT = path.join(__dirname, "..", "assets", "fonts");
const C = {
  ink: "#0F172A",
  navy: "#C2410C",
  blue: "#9A3412",
  tint: "#FFE8D9",
  tint2: "#FFF5EE",
  tintLine: "#FDBA8C",
  line: "#E2E8F0",
  dash: "#CBD5E1",
  red: "#B91C1C",
  redTint: "#FEE2E2",
};

const dateOnly = (d) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

const partyLines = (party = {}) =>
  [
    ...(party.addressLines || []),
    party.state,
    party.gstin ? { text: `GSTIN: ${party.gstin}`, bold: true } : null,
    party.phone,
    party.email,
  ]
    .filter(Boolean)
    .map((l) => (typeof l === "string" ? { text: l } : l));

/** The invoice as a PDF, as a Buffer. */
const renderInvoicePdf = (invoice) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      info: { Title: `${invoice.invoiceNumber} — Invoice`, Author: invoice.seller?.name || "KnotKitchen" },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("r", path.join(FONT, "NotoSans-Regular.ttf"));
    doc.registerFont("b", path.join(FONT, "NotoSans-Bold.ttf"));

    const L = doc.page.margins.left;
    const R = doc.page.width - doc.page.margins.right;
    const W = R - L;
    const registered = Boolean(invoice.seller?.gstin);
    const hasTax = invoice.totalTaxPaise > 0;
    const columns = taxColumns(invoice);
    const text = (str, x, y, { font = "r", size = 10.5, color = C.ink, ...opts } = {}) =>
      doc.font(font).fontSize(size).fillColor(color).text(String(str ?? ""), x, y, { lineGap: 1.5, ...opts });

    // Header: brand on the left, document type and numbers on the right.
    let y = doc.page.margins.top;
    text(invoice.seller?.name || "KnotKitchen", L, y, { font: "b", size: 24 });
    text("Restaurant Technology", L, y + 32, { font: "b", size: 12.5, color: C.blue });

    const docType = registered ? "TAX INVOICE" : "COMMERCIAL INVOICE";
    doc.font("b").fontSize(14);
    const pillW = doc.widthOfString(docType, { characterSpacing: 0.5 }) + 26;
    doc.roundedRect(R - pillW, y - 2, pillW, 28, 6).fill(C.tint);
    text(docType, R - pillW, y + 3, { font: "b", size: 14, color: C.navy, width: pillW, align: "center", characterSpacing: 0.5 });
    let my = y + 36;
    const metaRow = (label, value, boldValue = false) => {
      doc.font(boldValue ? "b" : "r").fontSize(10.5);
      const vw = doc.widthOfString(value);
      text(value, R - vw, my, { font: boldValue ? "b" : "r", lineBreak: false });
      doc.font("r");
      const lw = doc.widthOfString(label);
      text(label, R - vw - lw, my, { lineBreak: false });
      my += 16;
    };
    metaRow("Invoice No. ", invoice.invoiceNumber, true);
    metaRow("Date: ", dateOnly(invoice.invoiceDate));
    if (invoice.periodStart && invoice.periodEnd) {
      metaRow("Period: ", `${dateOnly(invoice.periodStart)} – ${dateOnly(invoice.periodEnd)}`);
    }

    // From / Bill to.
    y = Math.max(my, y + 60) + 18;
    const colW = (W - 30) / 2;
    const party = (title, p, x) => {
      text(title, x, y, { font: "b", size: 10.5, color: C.blue, characterSpacing: 0.4 });
      text(p?.name || "", x, y + 17, { font: "b", size: 13.5, width: colW });
      let py = doc.y + 1;
      for (const line of partyLines(p)) {
        text(line.text, x, py, { font: line.bold ? "b" : "r", size: 10.5, width: colW });
        py = doc.y;
      }
      return py;
    };
    y = Math.max(party("FROM", invoice.seller, L), party("BILL TO", invoice.buyer, L + colW + 30)) + 14;

    if (invoice.placeOfSupply) {
      doc.font("b").fontSize(10.5);
      const lw = doc.widthOfString("Place of supply: ");
      text("Place of supply: ", L, y, { font: "b", lineBreak: false });
      text(invoice.placeOfSupply, L + lw, y, { lineBreak: false });
      y += 24;
    }

    // Lines table.
    const cols = [
      // Narrower number columns on a GST invoice, so the description keeps room.
      { head: "#", w: hasTax ? 24 : 30, align: "center", cell: (l) => l.serial },
      { head: "DESCRIPTION", w: 0, align: "left", cell: (l) => l.description },
      { head: "VALUE (₹)", w: hasTax ? 66 : 78, align: "right", cell: (l) => formatAmount(l.taxableValuePaise) },
      ...(hasTax
        ? columns.flatMap(([label, rateKey, amountKey]) => [
            { head: `${label}%`, w: 46, align: "right", cell: (l) => `${Number(l[rateKey] || 0)}%` },
            { head: label, w: 56, align: "right", cell: (l) => formatAmount(l[amountKey]) },
          ])
        : []),
      { head: "TOTAL (₹)", w: hasTax ? 74 : 82, align: "right", cell: (l) => formatAmount(l.totalPaise) },
    ];
    const fixed = cols.reduce((n, c) => n + c.w, 0);
    cols[1].w = W - fixed;
    const pad = 8;
    doc.roundedRect(L, y, W, 26, 4).fill(C.tint);
    let x = L;
    for (const c of cols) {
      // Placed by measured width, never wrapped: "CGST%" in its narrow column broke in two.
      doc.font("b").fontSize(9.5);
      const tw = doc.widthOfString(c.head);
      const hx = c.align === "right" ? x + c.w - pad - tw : c.align === "center" ? x + (c.w - tw) / 2 : x + pad;
      text(c.head, hx, y + 7.5, { font: "b", size: 9.5, lineBreak: false });
      x += c.w;
    }
    y += 26;
    for (const line of invoice.lines || []) {
      doc.font("r").fontSize(10.5);
      const h = Math.max(...cols.map((c) => doc.heightOfString(String(c.cell(line) ?? ""), { width: c.w - pad * 2, lineGap: 1.5 }))) + 18;
      x = L;
      for (const c of cols) {
        text(c.cell(line), x + pad, y + 8, { width: c.w - pad * 2, align: c.align });
        x += c.w;
      }
      y += h;
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.8).strokeColor(C.line).stroke();
    }

    // Totals, right-aligned.
    const tW = Math.min(250, W);
    const tL = R - tW;
    y += 14;
    const totalRow = (label, value, { italic = false } = {}) => {
      text(label, tL + 10, y, { font: "b", size: 11, lineBreak: false });
      doc.font(italic ? "r" : "r").fontSize(11);
      const vw = doc.widthOfString(value);
      text(value, R - 10 - vw, y, { size: 11, lineBreak: false, oblique: italic });
      y += 22;
    };
    totalRow("Subtotal", formatINR(invoice.subtotalPaise));
    if (hasTax) {
      for (const [label, , amountKey] of columns) totalRow(label, formatINR(invoice[amountKey] ?? 0));
    } else {
      totalRow("GST", registered ? formatINR(0) : "Not Applicable", { italic: !registered });
    }
    y += 2;
    doc.moveTo(tL, y).lineTo(R, y).lineWidth(1.6).strokeColor(C.ink).stroke();
    y += 8;
    doc.roundedRect(tL, y, tW, 38, 6).fill(C.tint);
    text("Total", tL + 12, y + 8, { font: "b", size: 16, lineBreak: false });
    doc.font("b").fontSize(16);
    const total = formatINR(invoice.totalPaise);
    text(total, R - 12 - doc.widthOfString(total), y + 8, { font: "b", size: 16, lineBreak: false });
    y += 56;

    // In words, notes, void, footer.
    doc.font("b").fontSize(10.5);
    const iw = doc.widthOfString("In words: ");
    text("In words: ", L, y, { font: "b", lineBreak: false });
    text(invoice.totalInWords, L + iw, y, { width: W - iw });
    y = doc.y + 14;

    const notes = [
      registered ? "" : "KnotKitchen is not registered under GST. No GST has been charged.",
      invoice.kind === "HARDWARE" && hasTax ? "The price includes GST; the GST shown is contained in it." : "",
    ].filter(Boolean);
    for (const note of notes) {
      doc.font("b").fontSize(10.5);
      const nh = doc.heightOfString(note, { width: W - 64 }) + 22;
      doc.roundedRect(L, y, W, nh, 8).lineWidth(1).fillAndStroke(C.tint2, C.tintLine);
      doc.circle(L + 24, y + nh / 2, 8.5).lineWidth(1.6).strokeColor(C.navy).stroke();
      text("i", L + 16, y + nh / 2 - 7.5, { font: "b", size: 10.5, color: C.navy, width: 16, align: "center", lineBreak: false });
      text(note, L + 44, y + 11, { font: "b", size: 10.5, width: W - 64 });
      y += nh + 10;
    }

    if (invoice.status === "VOID") {
      doc.roundedRect(L, y, W, 26, 6).fill(C.redTint);
      text("VOID — this invoice has been cancelled", L, y + 6.5, { font: "b", size: 10.5, color: C.red, width: W, align: "center" });
      y += 36;
    }

    y += 12;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(1).dash(3, { space: 3 }).strokeColor(C.dash).stroke().undash();
    text("This is a computer generated invoice, no signature required.", L, y + 12, { size: 9.5, color: C.blue, width: W, align: "center" });

    doc.end();
  });

module.exports = { renderInvoicePdf };
