/**
 * A table bill paid through the gateway is charged ONCE, on the session's
 * earliest order, whatever mix of POS and QR rounds it holds -- and the debit
 * is exactly the platform fee the diner paid, stored on the session when the
 * payment was opened. A table settled in cash or at the counter is never
 * charged, and a cancelled order holding the fee gives it back.
 *
 * The real services/orderCharge over an in-memory Order store and ledger.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const RID = "64b000000000000000000001";
const SID = "64c000000000000000000001";
// ₹1 + 18% GST, as quoted when the diner opened the payment.
const QR_FEE = { amountPaise: 100, taxPaise: 18, totalPaise: 118, taxPercent: 18 };

const state = {};
const doc = (o) => ({ ...o, save: async () => { state.saves += 1; } });
const paidOnline = { payments: [{ status: "paid", method: "online" }], paymentData: { gatewayOrderId: "KK-T-1" } };
const reset = ({ balance = 100000, fee = QR_FEE, orders } = {}) => Object.assign(state, {
  balance,
  entries: [],
  saves: 0,
  session: { _id: SID, payment: { platformFee: fee } },
  orders: (orders || [
    // Deliberately out of order: the earliest is picked by createdAt, not position.
    { _id: "o2", source: "QR", createdAt: new Date("2026-09-20T10:10:00Z") },
    { _id: "o1", source: "POS", createdAt: new Date("2026-09-20T10:00:00Z"),
      platformCharge: { status: "NOT_APPLICABLE", reason: "Order source POS is not chargeable." } },
    { _id: "o3", source: "QR", createdAt: new Date("2026-09-20T10:20:00Z") },
  ]).map((o) => doc({ restaurantId: RID, tableSessionId: SID, orderStatus: "Paid", orderNumber: o._id, ...paidOnline, ...o })),
});

class InsufficientBalanceError extends Error {
  constructor(required) { super("short"); this.requiredPaise = required; }
}
const move = async (a, direction) => {
  const dup = state.entries.find((e) => e.idempotencyKey === a.idempotencyKey);
  if (dup) return { entry: dup, duplicate: true };
  if (direction === "DEBIT" && state.balance < a.amountPaise) throw new InsufficientBalanceError(a.amountPaise);
  state.balance += direction === "CREDIT" ? a.amountPaise : -a.amountPaise;
  const entry = { _id: `le${state.entries.length + 1}`, direction, ...a };
  state.entries.push(entry);
  return { entry, duplicate: false };
};
const ledger = {
  debit: (a) => move(a, "DEBIT"),
  credit: (a) => move(a, "CREDIT"),
  findByIdempotencyKey: async (key) => state.entries.find((e) => e.idempotencyKey === key) || null,
  InsufficientBalanceError,
};

const byCreated = (a, b) => a.createdAt - b.createdAt || String(a._id).localeCompare(String(b._id));
/** A chainable, awaitable query over the in-memory orders. */
const query = (rows) => {
  const q = { select: () => q, sort: () => q, lean: () => q, then: (res, rej) => Promise.resolve(rows()).then(res, rej) };
  return q;
};
const fakes = {
  "../models/orderModel": {
    find: (f) => query(() => state.orders
      .filter((o) => (f.tableSessionId
        ? String(o.tableSessionId) === String(f.tableSessionId) && !o.isDeleted
        : o.platformCharge?.status === f["platformCharge.status"]))
      .sort(byCreated)),
    findById: async (id) => state.orders.find((o) => o._id === id) || null,
  },
  "../models/tableSessionModel": { findById: () => query(() => state.session) },
  "../models/restaurantModel": { findById: () => query(() => ({ address: { state: "West Bengal" } })) },
  "./ledger": ledger,
  "./accountLock": { fireEvaluateLock: () => {} },
  // A debit reads the stored snapshot; looking the rate up again is the bug.
  "./pricing": {
    getPlatformConfig: async () => { throw new Error("rate re-read at debit time"); },
    resolveOrderCharge: async () => { throw new Error("rate re-resolved at debit time"); },
  },
};
const realLoad = Module._load;
Module._load = function load(request) {
  if (Object.prototype.hasOwnProperty.call(fakes, request)) return fakes[request];
  return realLoad.apply(this, arguments);
};
const { chargeTableSession, chargeOrder, tableChargeReason, reverseOrderCharge } = require("../services/orderCharge");
Module._load = realLoad;

const byId = (id) => state.orders.find((o) => o._id === id);

test("a mixed POS/QR table bill paid through the gateway is charged once, on its earliest order", async () => {
  reset();
  const r = await chargeTableSession(SID);
  assert.equal(r.charged, true);
  assert.equal(state.entries.length, 1, "one fee for the whole bill");
  assert.equal(state.entries[0].amountPaise, 118, "exactly the fee stored on the session");
  assert.equal(state.entries[0].description, "Platform fee — #o1");
  assert.equal(state.entries[0].idempotencyKey, "order-charge-o1", "on the earliest order, though it was a POS round");
  assert.equal(byId("o1").platformCharge.status, "PAID", "an earlier per-order stamp is replaced");
  assert.deepEqual(
    [byId("o1").platformCharge.amountPaise, byId("o1").platformCharge.taxPaise, byId("o1").platformCharge.totalPaise],
    [100, 18, 118],
    "the snapshot is kept on the order it was debited against",
  );
  for (const id of ["o2", "o3"]) {
    assert.equal(byId(id).platformCharge.status, "NOT_APPLICABLE");
    assert.equal(byId(id).platformCharge.reason, "Table bill charged once (order o1)");
  }
  assert.equal(tableChargeReason("o1"), "Table bill charged once (order o1)");
});

test("a retry, or a browser and a webhook settling at once, does not charge twice", async () => {
  reset();
  await Promise.all([chargeTableSession(SID), chargeTableSession(SID)]);
  await chargeTableSession(SID);
  assert.equal(state.entries.length, 1);
  assert.equal(state.balance, 100000 - 118);
  // Nor does a per-order charge fired later on any of the rounds.
  for (const id of ["o1", "o2", "o3"]) await chargeOrder(id);
  assert.equal(state.entries.length, 1);
});

test("a charge already on a later round is honoured, not added to", async () => {
  reset();
  const { entry } = await ledger.debit({ restaurantId: RID, kind: "ORDER_CHARGE", amountPaise: 118, idempotencyKey: "order-charge-o3" });
  byId("o3").platformCharge = { status: "PAID", totalPaise: 118, ledgerEntryId: entry._id };
  const r = await chargeTableSession(SID);
  assert.equal(r.already, true);
  assert.equal(state.entries.length, 1, "nothing added to the one debit");
  assert.equal(byId("o1").platformCharge.reason, "Table bill charged once (order o3)");
});

test("a short balance leaves the one charge PENDING, still once", async () => {
  reset({ balance: 0 });
  const r = await chargeTableSession(SID);
  assert.equal(r.pending, true);
  assert.equal(byId("o1").platformCharge.status, "PENDING");
  assert.equal(byId("o1").platformCharge.totalPaise, 118, "owed: what the diner paid");
  assert.equal(byId("o2").platformCharge.reason, "Table bill charged once (order o1)");
  await chargeTableSession(SID);
  assert.equal(state.orders.filter((o) => o.platformCharge?.status === "PENDING").length, 1);
});

test("a cancelled first round does not carry the charge", async () => {
  reset();
  byId("o1").orderStatus = "Cancelled";
  await chargeTableSession(SID);
  assert.equal(state.entries[0].idempotencyKey, "order-charge-o2");
  assert.equal(byId("o1").platformCharge.reason, "Table bill charged once (order o2)");
});

test("a table paid online with no fee (off when the diner paid) debits nothing, and every order says why", async () => {
  for (const fee of [{}, null, { totalPaise: 0 }]) {
    reset({ fee });
    const r = await chargeTableSession(SID);
    assert.equal(r.charged, false);
    assert.equal(state.entries.length, 0);
    for (const o of state.orders) {
      assert.equal(o.platformCharge.status, "NOT_APPLICABLE");
      assert.equal(o.platformCharge.reason, "No platform fee was collected.");
    }
  }
});

test("a table settled in cash is never charged, even with a stale gateway id on its orders", async () => {
  // recordSessionPayment never fires the charge (SOURCE-checked in
  // csdWalletAdjust.test.js); the per-order path must not bill these either.
  reset({ orders: [
    { _id: "c1", source: "QR", createdAt: new Date("2026-09-20T10:00:00Z") },
    { _id: "c2", source: "POS", createdAt: new Date("2026-09-20T10:05:00Z") },
  ] });
  for (const o of state.orders) {
    o.payments = [{ status: "paid", method: "cash" }];
    // Copied from an abandoned online checkout.
    o.paymentData = { gatewayOrderId: "KK-T-ABANDONED" };
  }
  for (const id of ["c1", "c2"]) {
    const r = await chargeOrder(id);
    assert.equal(r.charged, false);
    assert.match(r.reason, /once per bill/);
  }
  assert.equal(state.entries.length, 0);
  assert.ok(state.orders.every((o) => !o.platformCharge), "left unstamped: only the gateway settle decides");
});

// --- Reversal: a cancelled order holding the fee gives it back ---------------

test("voiding the order that holds a debited fee credits it back once, and waives it", async () => {
  reset();
  await chargeTableSession(SID);
  byId("o1").orderStatus = "Cancelled";
  const first = await reverseOrderCharge("o1");
  assert.deepEqual(first, { reversed: true, credited: true });
  await reverseOrderCharge("o1");
  await Promise.all([reverseOrderCharge("o1"), reverseOrderCharge("o1")]);

  const credits = state.entries.filter((e) => e.direction === "CREDIT");
  assert.equal(credits.length, 1, "credited once, however often the cancel fires");
  assert.deepEqual(
    [credits[0].kind, credits[0].amountPaise, credits[0].idempotencyKey, credits[0].description],
    ["REFUND", 118, "order-charge-reversal-o1", "Platform fee returned — #o1"],
  );
  assert.equal(state.balance, 100000, "the wallet is whole again");
  assert.equal(byId("o1").platformCharge.status, "WAIVED");
});

test("a fee still owed is waived, never collected later; an order with no fee is left alone", async () => {
  reset({ balance: 0 });
  await chargeTableSession(SID);
  assert.equal(byId("o1").platformCharge.status, "PENDING");
  const r = await reverseOrderCharge("o1");
  assert.deepEqual(r, { reversed: true, credited: false });
  assert.equal(byId("o1").platformCharge.status, "WAIVED");
  assert.equal(state.entries.length, 0, "nothing was debited, so nothing is credited");

  // A top-up later collects nothing for it.
  state.balance = 100000;
  const { settlePendingCharges } = require("../services/orderCharge");
  await settlePendingCharges(RID);
  assert.equal(state.entries.length, 0);

  // A round that never held the fee reverses nothing.
  assert.deepEqual(await reverseOrderCharge("o2"), { reversed: false });
});

test("SECURITY: a PAID stamp with no ledger debit behind it is never credited, nor trusted as the table's charge", async () => {
  // A stamp a client wrote (the old manual-order mass-assignment): huge, with no debit.
  reset();
  byId("o3").platformCharge = { status: "PAID", totalPaise: 10000000 };
  await chargeTableSession(SID);
  assert.deepEqual(state.entries.map((e) => [e.direction, e.idempotencyKey, e.amountPaise]), [["DEBIT", "order-charge-o1", 118]], "the real fee is still debited");
  assert.equal(byId("o3").platformCharge.status, "NOT_APPLICABLE");

  reset();
  byId("o2").platformCharge = { status: "PAID", totalPaise: 10000000 };
  byId("o2").orderStatus = "Cancelled";
  assert.deepEqual(await reverseOrderCharge("o2"), { reversed: true, credited: false });
  assert.equal(state.entries.length, 0, "no debit, no credit");
  assert.equal(byId("o2").platformCharge.status, "WAIVED");

  // A real debit is credited for what the ledger took, not what the order claims.
  reset();
  await chargeTableSession(SID);
  byId("o1").platformCharge.totalPaise = 10000000;
  byId("o1").orderStatus = "Cancelled";
  await reverseOrderCharge("o1");
  assert.equal(state.entries.find((e) => e.direction === "CREDIT").amountPaise, 118);
  assert.equal(state.balance, 100000);
});

test("a PENDING fee on an order cancelled without its reversal is waived at the next top-up, never collected", async () => {
  reset({ balance: 0 });
  await chargeTableSession(SID);
  byId("o1").orderStatus = "Cancelled";
  state.balance = 100000;
  const { settlePendingCharges } = require("../services/orderCharge");
  const r = await settlePendingCharges(RID);
  assert.equal(state.entries.length, 0);
  assert.equal(byId("o1").platformCharge.status, "WAIVED");
  assert.equal(r.remaining, 0);
});
