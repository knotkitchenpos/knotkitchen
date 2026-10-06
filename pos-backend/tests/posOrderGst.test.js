const { test } = require("node:test");
const assert = require("node:assert/strict");

const { runAddOrder, gstWith } = require("./addOrderHarness");

const NO_GST = gstWith({ applicable: false, rate: 0, percent: 0, inclusive: false });
const GST_5 = gstWith({ applicable: true, rate: 0.05, percent: 5, inclusive: false });
const GST_5_INCL = gstWith({ applicable: true, rate: 0.05, percent: 5, inclusive: true });

const order = (bills) => ({ orderType: "collection", paymentMethod: "cash", bills });

test("REGRESSION: a till order is priced by the store's GST rule, not the till's copy of it", async () => {
  // No GST number on the store: 5% sent by the till used to be stored and charged.
  const taxed = await runAddOrder({ body: order({ subtotal: 100, total: 100, tax: 5, taxPercent: 5, totalWithTax: 105 }), mocks: { "../services/gst": NO_GST } });
  assert.equal(taxed.error?.status, 409);
  assert.equal(taxed.saved.length, 0);

  const plain = await runAddOrder({ body: order({ subtotal: 100, total: 100, tax: 0, totalWithTax: 100 }), mocks: { "../services/gst": NO_GST } });
  assert.equal(plain.status, 201, plain.error?.message);
  assert.equal(plain.saved[0].bills.tax, 0);
  assert.equal(plain.saved[0].bills.totalWithTax, 100);
});

test("REGRESSION: a till whose settings never loaded cannot sell without the store's GST", async () => {
  // Settings fetch failed, so the till priced with 0%; the store charges 5%.
  const out = await runAddOrder({ body: order({ subtotal: 100, total: 100, tax: 0, totalWithTax: 100 }), mocks: { "../services/gst": GST_5 } });
  assert.equal(out.error?.status, 409);

  const right = await runAddOrder({ body: order({ subtotal: 100, total: 100, tax: 5, taxPercent: 5, totalWithTax: 105 }), mocks: { "../services/gst": GST_5 } });
  assert.equal(right.status, 201, right.error?.message);
  assert.equal(right.saved[0].payments[0].amount, 105);
});

test("an order synced from offline is re-priced, never refused, for GST", async () => {
  // It was already paid for; refusing it would lose the sale.
  const out = await runAddOrder({
    body: order({ subtotal: 100, total: 100, tax: 0, totalWithTax: 100 }),
    mocks: { "../services/gst": GST_5 },
    idempotencyKey: "offline:abc",
  });
  assert.equal(out.status, 201, out.error?.message);
  assert.equal(out.saved[0].bills.tax, 5);
  assert.equal(out.saved[0].bills.totalWithTax, 105);
  assert.equal(out.saved[0].payments[0].amount, 100, "what the till actually took");
});

test("REGRESSION: a split rung up offline on old GST settings syncs, with the parts the till took", async () => {
  // The parts were checked against the re-priced total and the sale was stuck on the device.
  const out = await runAddOrder({
    body: {
      orderType: "collection",
      paymentMethod: "split",
      splits: [{ method: "cash", amount: 60 }, { method: "upi", amount: 40 }],
      bills: { subtotal: 100, total: 100, tax: 0, totalWithTax: 100 },
    },
    mocks: { "../services/gst": GST_5 },
    idempotencyKey: "offline:split",
  });
  assert.equal(out.status, 201, out.error?.message);
  assert.equal(out.saved[0].bills.totalWithTax, 105);
  assert.deepEqual(out.saved[0].payments.map((p) => p.amount), [60, 40]);
});

test("REGRESSION: an inclusive-GST bill is stored as inclusive", async () => {
  // sanitizeBills dropped the flag, so every receipt printed included GST as extra.
  const out = await runAddOrder({
    body: order({ subtotal: 100, total: 100, tax: 4.76, taxPercent: 5, totalWithTax: 100 }),
    mocks: { "../services/gst": GST_5_INCL },
  });
  assert.equal(out.status, 201, out.error?.message);
  assert.equal(out.saved[0].bills.taxInclusive, true);
  assert.equal(out.saved[0].bills.tax, 4.76);
  assert.equal(out.saved[0].bills.totalWithTax, 100);
});
