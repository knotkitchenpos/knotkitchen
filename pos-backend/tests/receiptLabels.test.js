const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildReceipt, formatPaymentMethod } = require("../services/receiptService");
const { render } = require("../controllers/publicReceiptController");

const order = (paymentMethod, bills = { subtotal: 100, tax: 5, totalWithTax: 105 }) => ({
  _id: "64b000000000000000000001",
  orderStatus: "Completed",
  paymentMethod,
  bills,
  items: [{ name: "Dosa", quantity: 1, price: 100, total: 100 }],
});

test("REGRESSION: counter card and UPI payments are not printed as online", () => {
  assert.equal(buildReceipt({ order: order("Card") }).paymentMethod, "Paid by Card");
  assert.equal(buildReceipt({ order: order("UPI") }).paymentMethod, "Paid by UPI");
  assert.equal(formatPaymentMethod("ONLINE"), "Paid Online");
  assert.equal(formatPaymentMethod("NETBANKING"), "Paid Online");
});

test("REGRESSION: GST included in the prices is labelled as included on the e-bill", () => {
  const inclusive = buildReceipt({ order: order("Cash", { subtotal: 100, tax: 4.76, taxPercent: 5, taxInclusive: true, totalWithTax: 100 }) });
  assert.equal(inclusive.taxInclusive, true);
  assert.match(render(inclusive), /Tax \(included\)/);

  const exclusive = buildReceipt({ order: order("Cash") });
  assert.equal(exclusive.taxInclusive, false);
  assert.doesNotMatch(render(exclusive), /Tax \(included\)/);
});
