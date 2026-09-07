/**
 * The TAX INVOICE, as a page.
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

  const head = [
    "<th>#</th>",
    "<th>Description</th>",
    '<th class="r">Value</th>',
    ...(hasTax
      ? columns.flatMap(([label]) => [`<th class="r">${label} %</th>`, `<th class="r">${label}</th>`])
      : []),
    '<th class="r">Total</th>',
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
<title>${esc(invoice.invoiceNumber)} — Tax Invoice</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px 16px 48px; background:#F1F5F9; color:#0F172A;
         font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .sheet { max-width:760px; margin:0 auto; background:#fff; padding:32px 34px 28px;
           border-radius:12px; box-shadow:0 1px 3px rgba(15,23,42,.12); }
  .top { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; }
  .brand { font-size:20px; font-weight:800; letter-spacing:.2px; }
  .brand .sub { font-size:12px; font-weight:600; color:#64748B; margin-top:2px; }
  .doctype { text-align:right; }
  .doctype h1 { margin:0; font-size:16px; letter-spacing:1.5px; font-weight:800; }
  .doctype .meta { font-size:12.5px; color:#475569; margin-top:6px; }
  .doctype .meta b { color:#0F172A; }
  .parties { display:flex; gap:28px; margin:26px 0 20px; }
  .party { flex:1; font-size:12.5px; color:#475569; }
  .party h2 { margin:0 0 6px; font-size:10.5px; letter-spacing:1px; text-transform:uppercase; color:#94A3B8; }
  .party .pname { font-size:14px; font-weight:700; color:#0F172A; }
  .party .gstin { margin-top:4px; font-weight:600; color:#0F172A; }
  table { width:100%; border-collapse:collapse; margin-top:6px; font-size:12.5px; }
  th { text-align:left; font-size:10.5px; letter-spacing:.6px; text-transform:uppercase;
       color:#64748B; border-bottom:1.5px solid #0F172A; padding:0 6px 7px; }
  td { padding:9px 6px; border-bottom:1px solid #E2E8F0; }
  .r { text-align:right; white-space:nowrap; }
  .totals { margin-top:16px; margin-left:auto; width:min(320px,100%); font-size:13px; }
  .trow { display:flex; justify-content:space-between; padding:5px 0; }
  .trow.grand { border-top:2px solid #0F172A; margin-top:6px; padding-top:10px;
                font-size:15.5px; font-weight:800; }
  .words { margin-top:16px; font-size:12.5px; color:#334155; }
  .words b { color:#0F172A; }
  .foot { margin-top:26px; padding-top:14px; border-top:1px dashed #CBD5E1;
          text-align:center; font-size:11px; color:#94A3B8; }
  .void { margin-top:14px; padding:8px 12px; border-radius:8px; background:#FEE2E2;
          color:#B91C1C; font-weight:700; font-size:12.5px; text-align:center; }
  @media print {
    body { background:#fff; padding:0; }
    .sheet { box-shadow:none; border-radius:0; max-width:none; padding:0; }
  }
</style>
</head><body>
<div class="sheet">
  <div class="top">
    <div>
      <div class="brand">${esc(invoice.seller?.name || "KnotKitchen")}
        <div class="sub">Restaurant technology</div>
      </div>
    </div>
    <div class="doctype">
      <h1>TAX INVOICE</h1>
      <div class="meta">
        <div>Invoice No. <b>${esc(invoice.invoiceNumber)}</b></div>
        <div>Date <b>${esc(dateOnly(invoice.invoiceDate))}</b></div>
        ${invoice.periodStart && invoice.periodEnd
          ? `<div>Period ${esc(dateOnly(invoice.periodStart))} – ${esc(dateOnly(invoice.periodEnd))}</div>`
          : ""}
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="party"><h2>From</h2>${partyBlock(invoice.seller || {})}</div>
    <div class="party"><h2>Bill to</h2>${partyBlock(invoice.buyer || {})}</div>
  </div>

  ${invoice.placeOfSupply
    ? `<div class="party" style="margin-bottom:10px"><b>Place of supply:</b> ${esc(invoice.placeOfSupply)}</div>`
    : ""}

  <table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>

  <div class="totals">
    ${totalRow("Taxable value", formatINR(invoice.subtotalPaise))}
    ${
      hasTax
        ? columns
            .map(([label, , amountKey]) =>
              totalRow(label, formatINR(invoice[amountKey] ?? 0)),
            )
            .join("")
        : totalRow("GST", formatINR(0))
    }
    ${totalRow("Total", formatINR(invoice.totalPaise), "grand")}
  </div>

  <div class="words"><b>In words:</b> ${esc(invoice.totalInWords)}</div>

  ${invoice.status === "VOID" ? '<div class="void">VOID — this invoice has been cancelled</div>' : ""}

  <div class="foot">
    This is a computer generated digital invoice, no signature required.
  </div>
</div>
</body></html>`;
};

module.exports = { renderInvoice, esc, taxColumns };
