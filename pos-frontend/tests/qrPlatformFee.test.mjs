import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/**
 * Table QR: paying from the phone adds KnotKitchen's platform fee. Pay opens
 * the gateway on the same tap, so the diner must see the fee (and the total
 * with it) on the order card BEFORE tapping. It is never part of the table's
 * bill, so a party that pays at the counter never pays it, and the POS's own
 * order screens and receipts never show it.
 */
test("the QR diner sees the platform fee and the total with it before tapping Pay", () => {
  const page = SRC("src/pages/OrderOnline.jsx");
  assert.match(page, /const platformFee = Number\(charges\.onlinePlatformFee\) \|\| 0;/);
  // The fee line and the Pay label sit in the card shown before any payment intent.
  const beforePay = page.slice(page.indexOf("{!paymentInfo ? ("), page.indexOf(") : (", page.indexOf("{!paymentInfo ? (")));
  assert.match(beforePay, /<span>Platform fee \(online payment\)<\/span>\s*<span className="font-semibold">\{money\(platformFee\)\}<\/span>/);
  assert.match(beforePay, /`Pay \$\{money\(round2\(sessionTotal \+ platformFee\)\)\}`/);
  assert.match(beforePay, /onClick=\{preparePayment\}/);
});

test("the payment summary breaks the amount into Bill, Platform fee and Payable", () => {
  const page = SRC("src/pages/OrderOnline.jsx");
  assert.match(
    page,
    /<span>Bill<\/span>\s*<span>\{money\(paymentInfo\.billAmount\)\}<\/span>[\s\S]{0,200}<span>Platform fee<\/span>\s*<span>\{money\(paymentInfo\.platformFee\)\}<\/span>[\s\S]{0,300}<span>Payable<\/span>\s*<span>\{money\(paymentInfo\.amount\)\}<\/span>/,
  );
});

test("the fee stays out of the table bill and off the POS order screens", () => {
  const page = SRC("src/pages/OrderOnline.jsx");
  // The table total and bill lines are the restaurant's bill only.
  assert.match(page, /const sessionTotal = session\?\.bills\?\.totalWithTax \|\| 0;/);
  assert.doesNotMatch(page, /sessionTotal = [^;]*platformFee/);
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
