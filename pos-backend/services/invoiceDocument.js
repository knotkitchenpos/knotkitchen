/**
 * KnotKitchen's invoice, as a page: a TAX INVOICE once KnotKitchen is
 * registered under GST, a COMMERCIAL INVOICE saying so before that.
 *
 * HTML rather than a generated PDF: the browser's own print-to-PDF produces a
 * better document than a PDF library would, on every platform, with no
 * dependency and no font packaging. "Download PDF" is Ctrl+P, and the print
 * stylesheet below is what makes that come out right.
 *
 * Everything rendered comes off the stored invoice. Nothing is recomputed and
 * nothing is looked up, because the invoice is a snapshot -- that is what makes
 * an old bill still say 1299 after the price becomes 999.
 */

const { formatAmount, formatINR } = require("./money");

const esc = (value) =>
  String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const dateOnly = (d) =>
  new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

const partyBlock = (party) =>
  [
    party.name ? `<div class="pname">${esc(party.name)}</div>` : "",
    ...(party.addressLines || []).map((l) => `<div>${esc(l)}</div>`),
    party.state ? `<div>${esc(party.state)}</div>` : "",
    party.gstin ? `<div class="gstin">GSTIN: ${esc(party.gstin)}</div>` : "",
    party.phone ? `<div>${esc(party.phone)}</div>` : "",
    party.email ? `<div>${esc(party.email)}</div>` : "",
  ]
    .filter(Boolean)
    .join("");

/**
 * Tax columns follow the supply, not the schema.
 *
 * An intra-state invoice must not print an empty IGST column and an
 * inter-state one must not print empty CGST/SGST columns -- a nil column on a
 * tax invoice reads as a claim that the tax was zero.
 */
const taxColumns = (invoice) =>
  invoice.interState
    ? [["IGST", "igstRate", "igstPaise"]]
    : [
        ["CGST", "cgstRate", "cgstPaise"],
        ["SGST", "sgstRate", "sgstPaise"],
      ];

const renderInvoice = (invoice) => {
  const columns = taxColumns(invoice);
  const hasTax = invoice.totalTaxPaise > 0;
  // Only a GST-registered seller issues a tax invoice. Before registration
  // it is a plain invoice that says why there is no GST on it.
  const registered = Boolean(invoice.seller?.gstin);
  const docType = registered ? "TAX INVOICE" : "COMMERCIAL INVOICE";
  const notes = [
    registered ? "" : "KnotKitchen is not registered under GST. No GST has been charged.",
    // A printer's price already includes GST: the GST shown is contained in it, not added.
    invoice.kind === "HARDWARE" && hasTax ? "The price includes GST; the GST shown is contained in it." : "",
  ].filter(Boolean);

  const head = [
    "<th>#</th>",
    "<th>Description</th>",
    '<th class="r">Value (₹)</th>',
    ...(hasTax
      ? columns.flatMap(([label]) => [`<th class="r">${label} %</th>`, `<th class="r">${label}</th>`])
      : []),
    '<th class="r">Total (₹)</th>',
  ].join("");

  const rows = (invoice.lines || [])
    .map((line) =>
      [
        "<tr>",
        `<td>${esc(line.serial)}</td>`,
        `<td>${esc(line.description)}</td>`,
        `<td class="r">${formatAmount(line.taxableValuePaise)}</td>`,
        ...(hasTax
          ? columns.flatMap(([, rateKey, amountKey]) => [
              `<td class="r">${Number(line[rateKey] || 0)}%</td>`,
              `<td class="r">${formatAmount(line[amountKey])}</td>`,
            ])
          : []),
        `<td class="r">${formatAmount(line.totalPaise)}</td>`,
        "</tr>",
      ].join(""),
    )
    .join("");

  const totalRow = (label, value, cls = "") =>
    `<div class="trow ${cls}"><span>${esc(label)}</span><span>${value}</span></div>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(invoice.invoiceNumber)} — ${registered ? "Tax Invoice" : "Commercial Invoice"}</title>
<style>
  /* Laid out after the owner's reference invoice (2026-10-31). */
  :root { color-scheme: light; --ink:#0F172A; --navy:#0B3A82; --blue:#1E5A8A;
          --tint:#DCE9FA; --tint-2:#EEF5FD; --line:#E2E8F0; --muted:#475569; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px 16px 48px; background:#EEF3F9; color:var(--ink);
         font:14.5px/1.55 "Segoe UI",-apple-system,BlinkMacSystemFont,Roboto,"Noto Sans",sans-serif; }
  .sheet { max-width:800px; margin:0 auto; background:#fff; padding:36px 40px 30px;
           border-radius:16px; box-shadow:0 2px 10px rgba(15,23,42,.08); }
  .top { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; flex-wrap:wrap; }
  .brand { font-size:32px; font-weight:800; line-height:1.1; letter-spacing:-.3px; }
  .brand .sub { font-size:17px; font-weight:600; color:var(--blue); margin-top:6px; letter-spacing:0; }
  .doctype { text-align:right; margin-left:auto; }
  .doctype h1 { display:inline-block; margin:0; padding:7px 18px; border-radius:8px; background:var(--tint);
                color:var(--navy); font-size:20px; letter-spacing:.6px; font-weight:800; }
  .doctype .meta { font-size:14.5px; margin-top:10px; line-height:1.7; }
  .doctype .meta b { font-weight:700; }
  .parties { display:flex; gap:32px; margin:30px 0 18px; flex-wrap:wrap; }
  .party { flex:1; min-width:240px; font-size:14.5px; }
  .party h2 { margin:0 0 6px; font-size:14px; letter-spacing:.4px; text-transform:uppercase; color:var(--blue); font-weight:700; }
  .party .pname { font-size:19px; font-weight:800; margin-bottom:2px; }
  .party .gstin { margin-top:2px; font-weight:700; }
  .supply { margin:4px 0 18px; font-size:14.5px; }
  /* A GST invoice has seven columns: on a phone they scroll here, not the page. */
  .lines { overflow-x:auto; }
  table { width:100%; border-collapse:separate; border-spacing:0; font-size:14.5px; }
  th { text-align:left; font-size:13.5px; letter-spacing:.4px; text-transform:uppercase; font-weight:700;
       background:var(--tint); padding:10px 14px; }
  th:first-child { border-radius:6px 0 0 6px; width:56px; text-align:center; }
  th:last-child { border-radius:0 6px 6px 0; }
  td { padding:13px 14px; border-bottom:1px solid var(--line); }
  td:first-child { text-align:center; }
  .r { text-align:right; white-space:nowrap; }
  .totals { margin-top:20px; margin-left:auto; width:min(380px,100%); font-size:15px; }
  .trow { display:flex; justify-content:space-between; padding:6px 14px; }
  .trow span:first-child { font-weight:600; }
  .trow .na { font-style:italic; }
  .totals .rule { margin:8px 0 10px; border-top:2px solid var(--ink); }
  .trow.grand { padding:12px 14px; border-radius:8px;
                background:var(--tint); font-size:24px; font-weight:800; }
  .trow.grand span:first-child { font-weight:800; }
  .words { margin-top:22px; font-size:14.5px; }
  .words b { font-weight:700; }
  .note { margin-top:20px; display:flex; align-items:center; gap:14px; padding:14px 22px; border-radius:12px;
          border:1.5px solid #9DBDE6; background:var(--tint-2); font-weight:700; font-size:14.5px; }
  .note .i { flex:none; width:26px; height:26px; border-radius:50%; border:2.5px solid var(--navy); color:var(--navy);
             display:flex; align-items:center; justify-content:center; font:800 15px/1 Georgia,serif; }
  .foot { margin-top:28px; padding-top:16px; border-top:1.5px dashed #CBD5E1;
          text-align:center; font-size:13.5px; color:var(--blue); }
  .void { margin-top:14px; padding:8px 12px; border-radius:8px; background:#FEE2E2;
          color:#B91C1C; font-weight:700; font-size:13px; text-align:center; }
  @media (max-width:560px) {
    .sheet { padding:24px 18px; }
    .brand { font-size:26px; }
    .doctype { text-align:left; margin-left:0; }
    th, td { padding:9px 8px; }
  }
  @media print {
    body { background:#fff; padding:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .sheet { box-shadow:none; border-radius:0; max-width:none; padding:0; }
  }
</style>
</head><body>
<div class="sheet">
  <div class="top">
    <div class="brand">${esc(invoice.seller?.name || "KnotKitchen")}
      <div class="sub">Restaurant Technology</div>
    </div>
    <div class="doctype">
      <h1>${docType}</h1>
      <div class="meta">
        <div>Invoice No. <b>${esc(invoice.invoiceNumber)}</b></div>
        <div>Date: ${esc(dateOnly(invoice.invoiceDate))}</div>
        ${invoice.periodStart && invoice.periodEnd
          ? `<div>Period: ${esc(dateOnly(invoice.periodStart))} – ${esc(dateOnly(invoice.periodEnd))}</div>`
          : ""}
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="party"><h2>From</h2>${partyBlock(invoice.seller || {})}</div>
    <div class="party"><h2>Bill to</h2>${partyBlock(invoice.buyer || {})}</div>
  </div>

  ${invoice.placeOfSupply
    ? `<div class="supply"><b>Place of supply:</b> ${esc(invoice.placeOfSupply)}</div>`
    : ""}

  <div class="lines"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>

  <div class="totals">
    ${totalRow("Subtotal", formatINR(invoice.subtotalPaise))}
    ${
      hasTax
        ? columns
            .map(([label, , amountKey]) =>
              totalRow(label, formatINR(invoice[amountKey] ?? 0)),
            )
            .join("")
        : totalRow("GST", registered ? formatINR(0) : '<span class="na">Not Applicable</span>')
    }
    <div class="rule"></div>
    ${totalRow("Total", formatINR(invoice.totalPaise), "grand")}
  </div>

  <div class="words"><b>In words:</b> ${esc(invoice.totalInWords)}</div>
  ${notes.map((n) => `<div class="note"><span class="i" aria-hidden="true">i</span><span>${esc(n)}</span></div>`).join("")}

  ${invoice.status === "VOID" ? '<div class="void">VOID — this invoice has been cancelled</div>' : ""}

  <div class="foot">
    This is a computer generated invoice, no signature required.
  </div>
</div>
</body></html>`;
};

module.exports = { renderInvoice, esc, taxColumns };
