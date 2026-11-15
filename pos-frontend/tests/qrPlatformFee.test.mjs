import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/**
 * Table QR carries no platform fee (removed by the owner on 2026-11-15): the
 * diner pays the table's bill and nothing else, so the QR page neither shows
 * a fee nor adds one to the Pay amount.
 */
test("the QR diner pays the bill alone: no platform fee shown or added", () => {
  const page = SRC("src/pages/OrderOnline.jsx");
  assert.doesNotMatch(page, /platformFee|onlinePlatformFee|Platform fee/);
  const beforePay = page.slice(page.indexOf("{!paymentInfo ? ("), page.indexOf(") : (", page.indexOf("{!paymentInfo ? (")));
  assert.match(beforePay, /\{loadingPayment \? "Opening payment…" : "Pay"\}/);
  assert.match(beforePay, /onClick=\{preparePayment\}/);
  assert.match(page, /<span>Payable<\/span>\s*<span>\{money\(paymentInfo\.amount\)\}<\/span>/);
});

test("the table bill and the POS order screens never carry a platform fee", () => {
  const page = SRC("src/pages/OrderOnline.jsx");
  assert.match(page, /const sessionTotal = session\?\.bills\?\.totalWithTax \|\| 0;/);
  for (const f of [
    "src/components/invoice/Invoice.jsx",
    "src/pages/Orders.jsx",
    "src/pages/Reports.jsx",
    "src/utils/receiptLayout.js",
    "src/components/tables/TableSettleModal.jsx",
  ]) {
    assert.doesNotMatch(SRC(f), /platformFee|platform fee/i, f);
  }
});
