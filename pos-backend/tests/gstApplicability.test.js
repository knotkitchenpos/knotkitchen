/**
 * GST is charged only where the business is actually registered for it.
 *
 * services/price carried `TAX_RATE = 0.05` and applied it to every table, QR
 * and POS bill. Every store in production has an empty GST number and
 * `gstRegistered: false`, and all of them were being charged 5% anyway -- money
 * taken from customers that the business never owed and cannot remit.
 *
 * The storefront path had the opposite half of the problem: it read a rate from
 * settings but never checked the store had a GST number, so a rate alone was
 * enough to charge tax.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { resolveGst } = require("../services/gst");
const { calculateBill, TAX_RATE } = require("../services/price");

const REGISTERED = { taxId: "19AAACH7409R1ZZ" };
const UNREGISTERED = { taxId: "" };

test("REGRESSION: no GST number means no GST, whatever the rate says", () => {
  const gst = resolveGst({ restaurant: UNREGISTERED, ordering: { taxPercent: 18 } });
  assert.equal(gst.applicable, false);
  assert.equal(gst.rate, 0);
  assert.match(gst.reason, /no GST number/);
});

test("REGRESSION: a GST number with no rate set charges nothing", () => {
  // Guessing a rate on the operator's behalf is how the 5% got there.
  const gst = resolveGst({ restaurant: REGISTERED, ordering: {} });
  assert.equal(gst.applicable, false);
  assert.equal(gst.rate, 0);
  assert.match(gst.reason, /no GST rate/);
});

test("a registered store with a rate is charged that rate", () => {
  const gst = resolveGst({ restaurant: REGISTERED, ordering: { taxPercent: 5 } });
  assert.equal(gst.applicable, true);
  assert.equal(gst.percent, 5);
  assert.equal(gst.rate, 0.05);
});

test("18% works as readily as 5%", () => {
  const gst = resolveGst({ restaurant: REGISTERED, ordering: { taxPercent: 18 } });
  assert.equal(gst.percent, 18);
  assert.equal(gst.rate, 0.18);
});

test("gstApplyTo can narrow it to one channel", () => {
  const ordering = { taxPercent: 5, gstApplyTo: "website" };
  assert.equal(resolveGst({ restaurant: REGISTERED, ordering, environment: "website" }).applicable, true);
  const system = resolveGst({ restaurant: REGISTERED, ordering, environment: "system" });
  assert.equal(system.applicable, false);
  assert.match(system.reason, /apply to "website"/);
});

test("a blank or whitespace GST number does not count as registered", () => {
  for (const taxId of ["", "   ", null, undefined]) {
    const gst = resolveGst({ restaurant: { taxId }, ordering: { taxPercent: 5 } });
    assert.equal(gst.applicable, false, JSON.stringify(taxId));
  }
});

test("a missing restaurant is never charged", () => {
  assert.equal(resolveGst({}).applicable, false);
  assert.equal(resolveGst().applicable, false);
});

test("a nonsense rate cannot turn GST on", () => {
  for (const taxPercent of [0, -5, "abc", null]) {
    const gst = resolveGst({ restaurant: REGISTERED, ordering: { taxPercent } });
    assert.equal(gst.applicable, false, String(taxPercent));
  }
});

// ---- what actually reaches the bill --------------------------------

test("REGRESSION: the default tax rate is now none, not 5%", () => {
  assert.equal(TAX_RATE, 0, "a default rate is money charged that nobody configured");
});

test("REGRESSION: an unconfigured store's table bill carries no tax", () => {
  const gst = resolveGst({ restaurant: UNREGISTERED, ordering: {} });
  const bill = calculateBill({
    items: [{ price: 100, quantity: 2 }],
    taxRate: gst.rate,
  });
  assert.equal(bill.subtotal, 200);
  assert.equal(bill.tax, 0, "this was 10.00 before");
  assert.equal(bill.totalWithTax, 200);
});

test("a configured store's table bill carries exactly its rate", () => {
  const gst = resolveGst({ restaurant: REGISTERED, ordering: { taxPercent: 18 } });
  const bill = calculateBill({
    items: [{ price: 100, quantity: 2 }],
    taxRate: gst.rate,
  });
  assert.equal(bill.subtotal, 200);
  assert.equal(bill.tax, 36);
  assert.equal(bill.totalWithTax, 236);
});
