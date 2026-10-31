const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const money = require("../services/money");
const { renderInvoicePdf } = require("../services/invoicePdf");

/** Download PDF on an invoice (owner, 2026-10-31). */

const P = money.toPaise;
const base = {
  invoiceNumber: "KK-686659-0002",
  invoiceDate: new Date("2026-10-30"),
  seller: { name: "KnotKitchen", addressLines: ["Kolkata – 700094"], state: "West Bengal" },
  buyer: { name: "The Coffee Carousel", addressLines: ["Bapai Rd"], state: "West Bengal" },
  lines: [{ serial: 1, description: "Upgrade to POS plan", taxableValuePaise: P(176.37), totalPaise: P(176.37) }],
  subtotalPaise: P(176.37),
  totalTaxPaise: 0,
  totalPaise: P(176.37),
  totalInWords: money.amountInWords(P(176.37)),
  placeOfSupply: "West Bengal",
  status: "PAID",
};

test("an invoice comes out as a PDF, with or without GST, and when void", async () => {
  for (const invoice of [
    base,
    { ...base, seller: { ...base.seller, gstin: "19AAAAA0000A1Z5" }, totalTaxPaise: P(31.75), cgstPaise: P(15.87), sgstPaise: P(15.88),
      lines: [{ ...base.lines[0], cgstRate: 9, cgstPaise: P(15.87), sgstRate: 9, sgstPaise: P(15.88) }] },
    { ...base, interState: true, status: "VOID" },
  ]) {
    const pdf = await renderInvoicePdf(invoice);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 5000);
  }
});

test("it embeds a font with ₹ (PDF's own fonts have none), shipped with its licence", () => {
  const dir = path.join(__dirname, "../assets/fonts");
  for (const f of ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf", "OFL.txt"]) assert.ok(fs.existsSync(path.join(dir, f)), f);
  const fontkit = require("fontkit");
  assert.ok(fontkit.openSync(path.join(dir, "NotoSans-Regular.ttf")).hasGlyphForCodePoint(0x20b9));
});

test("the invoice link gives the PDF for ?format=pdf, and the page links to it", () => {
  const ctrl = fs.readFileSync(path.join(__dirname, "../controllers/publicReceiptController.js"), "utf8");
  assert.match(ctrl, /if \(req\.query\.format === "pdf"\) \{/);
  assert.match(ctrl, /res\.set\("Content-Disposition", `attachment; filename="\$\{name\}\.pdf"`\);/);
  const page = require("../services/invoiceDocument").renderInvoice(base);
  assert.match(page, /<a class="dl" href="\?format=pdf" download>Download PDF<\/a>/);
  assert.match(page, /@media print \{[^}]*\{[^}]*\}\s*\.bar \{ display:none; \}/, "not on the printed page");
});
