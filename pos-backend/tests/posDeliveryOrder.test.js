const { test } = require("node:test");
const assert = require("node:assert/strict");

const S = require("../constants/orderStatus");
const { runAddOrder, runUpdateOrder, settingsWith, OWNER } = require("./addOrderHarness");

const SLABS = {
  deliveryFee: 0,
  deliverySlabsConfig: { maxDistanceKm: 7, slabs: [{ minKm: 0, maxKm: 3, fee: 30 }, { minKm: 3, maxKm: 7, fee: 60 }] },
};

const delivery = ({ postalCode = "700001", distanceKm = 5, deliveryFee = 60, paymentMethod } = {}) => ({
  orderType: "delivery",
  ...(paymentMethod ? { paymentMethod } : {}),
  customerDetails: { name: "Ravi", phone: "9876543210" },
  deliveryAddress: { line1: "12 MG Road", postalCode, distanceKm },
  bills: { subtotal: 200, total: 200, tax: 0, deliveryFee, totalWithTax: 200 + deliveryFee },
});

const run = (body, extra = {}) => runAddOrder({ body, mocks: { "../models/websiteSettingsModel": settingsWith(SLABS) }, ...extra });

test("REGRESSION: a delivery pincode must be an Indian 6-digit PIN", async () => {
  // A UK-postcode pattern let 'SA4 8DE', 'abc' or '12' through.
  for (const bad of ["SA4 8DE", "abc", "12", "012345"]) {
    const out = await run(delivery({ postalCode: bad }));
    assert.equal(out.error?.status, 400, bad);
    assert.equal(out.saved.length, 0);
  }
  const ok = await run(delivery({ postalCode: "700 001" }));
  assert.equal(ok.status, 201, ok.error?.message);
  assert.equal(ok.saved[0].deliveryAddress.postalCode, "700001");
  assert.equal(ok.saved[0].customerDetails.pinCode, "700001");
});

test("REGRESSION: delivery is priced by the store's distance slabs, not the till's flat fee", async () => {
  // The till charged the flat fee (0, 'Free') and the server stored it.
  const free = await run(delivery({ deliveryFee: 0 }));
  assert.equal(free.error?.status, 409, "5 km is the 60 slab");

  const ok = await run(delivery({ deliveryFee: 60 }));
  assert.equal(ok.status, 201, ok.error?.message);
  assert.equal(ok.saved[0].bills.deliveryFee, 60);
  assert.equal(ok.saved[0].bills.totalWithTax, 260);
  assert.equal(ok.saved[0].deliveryAddress.distanceKm, 5);
  assert.equal(ok.saved[0].deliveryAddress.distanceSource, "staff");

  // Slabs exist, so the distance is required, and beyond the limit is refused.
  assert.equal((await run(delivery({ distanceKm: "" }))).error?.status, 400);
  assert.equal((await run(delivery({ distanceKm: 9 }))).error?.status, 400);

  // Synced from offline: re-priced, never refused.
  const synced = await run(delivery({ deliveryFee: 0 }), { idempotencyKey: "offline:d1" });
  assert.equal(synced.status, 201, synced.error?.message);
  assert.equal(synced.saved[0].bills.deliveryFee, 60);
  assert.equal(synced.saved[0].bills.totalWithTax, 260);
});

test("REGRESSION: a delivery paid at the till starts in the kitchen, paid", async () => {
  // It was created Completed, so it could never go out for delivery.
  const out = await run(delivery({ paymentMethod: "cash" }));
  assert.equal(out.status, 201, out.error?.message);
  assert.equal(out.saved[0].orderStatus, "Preparing");
  assert.deepEqual(out.saved[0].payments.map((p) => [p.method, p.amount, p.status]), [["cash", 260, "paid"]]);
});

test("a paid order still in the kitchen is cancelled only through the reasoned route, by a manager", async () => {
  const order = { orderType: "delivery", orderStatus: "Preparing", payments: [{ method: "cash", amount: 260, status: "paid" }] };
  const plain = await runUpdateOrder({ order, body: { orderStatus: "Cancelled" }, user: { ...OWNER, role: "Staff" } });
  assert.equal(plain.error?.status, 409);
  const staff = await runUpdateOrder({ order, handler: "cancelOrder", body: { reason: "Customer left" }, user: { ...OWNER, role: "Staff" } });
  assert.equal(staff.error?.status, 403);
  assert.equal(staff.saves, 0);
});

const noVocab = !S.OUT_FOR_DELIVERY && "needs OUT_FOR_DELIVERY in constants/orderStatus.js (BE-A)";

test("only a delivery order can go out for delivery", { skip: noVocab }, async () => {
  const collection = await runUpdateOrder({ order: { orderType: "collection", orderStatus: "Ready" }, body: { orderStatus: S.OUT_FOR_DELIVERY } });
  assert.equal(collection.error?.status, 400);
  assert.match(collection.error.message, /Only delivery orders/);
  const out = await runUpdateOrder({ order: { orderType: "delivery", orderStatus: "Ready" }, body: { orderStatus: S.OUT_FOR_DELIVERY } });
  assert.equal(out.status, 200, out.error?.message);
  assert.equal(out.doc.orderStatus, S.OUT_FOR_DELIVERY);
});

test("Knot Eats tracking shows an order out for delivery as on the way, not back to accepted", { skip: noVocab }, () => {
  const { stageOf } = require("../controllers/knotEatsController");
  assert.equal(stageOf(S.OUT_FOR_DELIVERY), "on_the_way");
  assert.equal(stageOf("Ready"), "ready");
});

test("REGRESSION: cancelling a table's ticket through the generic route needs the Security PIN from staff", async () => {
  const order = { orderType: "dine-in", orderStatus: "Preparing", tableSessionId: "s1", payments: [] };
  const staff = await runUpdateOrder({ order, body: { orderStatus: "Cancelled" }, user: { ...OWNER, role: "Staff" } });
  assert.equal(staff.error?.status, 403);
  assert.equal(staff.error?.code, "PIN_REQUIRED");
  assert.equal(staff.saves, 0);
});

test("REGRESSION: the kitchen's Ready on a takeaway paid at the till stamps it ready and keeps the sale Completed", async () => {
  // A paid takeaway is created Completed, so Ready used to be refused (409)
  // and the kitchen screen never listed it.
  const mocks = { "../services/readyNotificationService": { notifyOrderReady: async () => ({ sent: false }) } };
  const takeaway = { source: "POS", orderType: "collection", orderStatus: "Completed", readyAt: null };
  const out = await runUpdateOrder({ order: takeaway, handler: "markOrderReady", mocks });
  assert.equal(out.status, 200, out.error?.message);
  assert.equal(out.doc.orderStatus, "Completed");
  assert.ok(out.doc.readyAt instanceof Date);
  assert.equal(out.saves, 1);

  // Once ready, or for any other finished order, it is still refused.
  const again = await runUpdateOrder({ order: { ...takeaway, readyAt: new Date() }, handler: "markOrderReady", mocks });
  assert.equal(again.error?.status, 409);
  const delivered = await runUpdateOrder({ order: { ...takeaway, orderType: "delivery", orderStatus: "Delivered" }, handler: "markOrderReady", mocks });
  assert.equal(delivered.error?.status, 409);
});
