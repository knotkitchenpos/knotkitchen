/**
 * A table bill paid through the gateway is charged ONCE, on the session's
 * earliest order, whatever mix of POS and QR rounds it holds. A table settled
 * in cash or at the counter is never charged.
 *
 * The real services/orderCharge over an in-memory Order store and ledger.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const RID = "64b000000000000000000001";
const SID = "64c000000000000000000001";

const state = {};
const doc = (o) => ({ ...o, save: async () => { state.saves += 1; } });
const paidOnline = { payments: [{ status: "paid", method: "online" }], paymentData: { gatewayOrderId: "KK-T-1" } };
const reset = ({ balance = 100000, enabled = true, orders } = {}) => Object.assign(state, {
  balance,
  entries: [],
  saves: 0,
  charge: { enabled, started: enabled, amountPaise: 900, chargeableSources: ["WEBSITE", "QR"], taxable: false },
  orders: (orders || [
    // Deliberately out of order: the earliest is picked by createdAt, not position.
    { _id: "o2", source: "QR", createdAt: new Date("2026-09-20T10:10:00Z") },
    { _id: "o1", source: "POS", createdAt: new Date("2026-09-20T10:00:00Z"),
      platformCharge: { status: "NOT_APPLICABLE", reason: "Order source POS is not chargeable." } },
    { _id: "o3", source: "QR", createdAt: new Date("2026-09-20T10:20:00Z") },
  ]).map((o) => doc({ restaurantId: RID, tableSessionId: SID, orderStatus: "Paid", ...paidOnline, ...o })),
});

class InsufficientBalanceError extends Error {
  constructor(required) { super("short"); this.requiredPaise = required; }
}
const ledger = {
  debit: async (a) => {
    const dup = state.entries.find((e) => e.idempotencyKey === a.idempotencyKey);
    if (dup) return { entry: dup, duplicate: true };
    if (state.balance < a.amountPaise) throw new InsufficientBalanceError(a.amountPaise);
    state.balance -= a.amountPaise;
    const entry = { _id: `le${state.entries.length + 1}`, ...a };
    state.entries.push(entry);
    return { entry, duplicate: false };
  },
  InsufficientBalanceError,
};
const byCreated = (a, b) => a.createdAt - b.createdAt || String(a._id).localeCompare(String(b._id));
const fakes = {
  "../models/orderModel": {
    find: (f) => ({
      sort: async () => state.orders
        .filter((o) => String(o.tableSessionId) === String(f.tableSessionId) && !o.isDeleted)
        .sort(byCreated),
    }),
    findById: async (id) => state.orders.find((o) => o._id === id) || null,
  },
  "../models/restaurantModel": { findById: () => ({ select: () => ({ lean: async () => ({ address: { state: "West Bengal" } }) }) }) },
  "./ledger": ledger,
  "./accountLock": { fireEvaluateLock: () => {} },
  "./pricing": { getPlatformConfig: async () => ({ gst: {} }), resolveOrderCharge: async () => state.charge },
};
const realLoad = Module._load;
Module._load = function load(request) {
  if (Object.prototype.hasOwnProperty.call(fakes, request)) return fakes[request];
  return realLoad.apply(this, arguments);
};
const { chargeTableSession, chargeOrder, tableChargeReason } = require("../services/orderCharge");
Module._load = realLoad;

const byId = (id) => state.orders.find((o) => o._id === id);

test("a mixed POS/QR table bill paid through the gateway is charged once, on its earliest order", async () => {
  reset();
  const r = await chargeTableSession(SID);
  assert.equal(r.charged, true);
  assert.equal(state.entries.length, 1, "one ₹9 for the whole bill");
  assert.equal(state.entries[0].amountPaise, 900);
  assert.equal(state.entries[0].idempotencyKey, "order-charge-o1", "on the earliest order, though it was a POS round");
  assert.equal(byId("o1").platformCharge.status, "PAID", "an earlier per-order 'POS not chargeable' stamp is replaced");
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
  assert.equal(state.balance, 100000 - 900);
  // Nor does a per-order charge fired later on any of the rounds.
  for (const id of ["o1", "o2", "o3"]) await chargeOrder(id);
  assert.equal(state.entries.length, 1);
});

test("a charge already on a later round is honoured, not added to", async () => {
  reset();
  byId("o3").platformCharge = { status: "PAID", totalPaise: 900 };
  const r = await chargeTableSession(SID);
  assert.equal(r.already, true);
  assert.equal(state.entries.length, 0);
  assert.equal(byId("o1").platformCharge.reason, "Table bill charged once (order o3)");
});

test("a short balance leaves the one charge PENDING, still once", async () => {
  reset({ balance: 0 });
  const r = await chargeTableSession(SID);
  assert.equal(r.pending, true);
  assert.equal(byId("o1").platformCharge.status, "PENDING");
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

test("with the charge switched off, nothing is billed and every order says why", async () => {
  reset({ enabled: false });
  const r = await chargeTableSession(SID);
  assert.equal(r.charged, false);
  assert.equal(state.entries.length, 0);
  for (const o of state.orders) {
    assert.equal(o.platformCharge.status, "NOT_APPLICABLE");
    assert.match(o.platformCharge.reason, /before the per-order charge started/);
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
