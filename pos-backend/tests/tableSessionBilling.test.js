/**
 * Batch 8, table bill and settle (P2):
 *   N017  a guest's QR dish the till has not accepted is not billed,
 *         discounted or settled past; a diner's online payment declines it.
 *   S4    a gateway settle books the Cashfree order that was paid and keeps
 *         every other order id the table opened.
 *   N015a a merged table's bill goes to the table's own customer.
 *   S6    restrikeOpenBills re-prices open tables, never one already paying.
 *
 * The real controller runs with its DB modules faked (Module._load).
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const path = require("path");
const mongoose = require("mongoose");

const CTRL = path.join(__dirname, "../controllers/tableSessionController.js");
const RID = "507f1f77bcf86cd799439011";
const SID = "507f1f77bcf86cd799439077";

const withFakes = async (fakes, run) => {
  const orig = Module._load;
  Module._load = function (r) {
    if (Object.prototype.hasOwnProperty.call(fakes, r)) return fakes[r];
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve(CTRL)];
  try {
    return await run(require(CTRL));
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve(CTRL)];
  }
};

const noGst = { resolveGstForRestaurant: async () => ({ rate: 0, inclusive: false, serviceChargePercent: 0 }), buyerFrom: () => null };
const socket = { emitOrderCreated() {}, emitOrderStatusChanged() {}, emitTableSessionUpdated() {} };

test("S5: the awaiting and billable rules", async () => {
  await withFakes({}, async ({ isAwaitingAcceptance, isBillable }) => {
    const qrPending = { status: "pending", addedBy: "QR" };
    assert.equal(isAwaitingAcceptance(qrPending), true);
    assert.equal(isBillable(qrPending), false);
    assert.equal(isAwaitingAcceptance({ status: "pending", addedBy: "POS" }), false, "till and old lines are left alone");
    assert.equal(isBillable({ status: "preparing", addedBy: "QR" }), true, "an accepted guest dish is billed");
    assert.equal(isBillable({ status: "cancelled", addedBy: "POS" }), false);
  });
});

test("N017: a guest's unaccepted (pending) dish is not on the table's bill", async () => {
  await withFakes({ "../services/gst": noGst }, async ({ recalculateSessionBill }) => {
    const session = {
      restaurantId: RID,
      bills: {},
      items: [
        { price: 100, quantity: 1, status: "preparing", addedBy: "POS" },
        { price: 50, quantity: 1, status: "pending", addedBy: "QR" },
      ],
      save: async () => {},
    };
    await recalculateSessionBill(session);
    assert.equal(session.bills.totalWithTax, 100);
  });
});

test("N017: a % discount is computed on accepted dishes only", async () => {
  const session = {
    restaurantId: RID, status: "OCCUPIED", bills: {}, timeline: [],
    items: [
      { price: 100, quantity: 1, status: "preparing", addedBy: "POS" },
      { price: 100, quantity: 1, status: "pending", addedBy: "QR" },
    ],
    save: async () => {},
  };
  const fakes = {
    "../services/gst": noGst,
    "../models/tableSessionModel": { findOne: async () => session },
    "../models/orderModel": { find: async () => [] },
    "../services/socket": socket,
  };
  await withFakes(fakes, async ({ setDiscount }) => {
    let failure;
    const res = { status() { return res; }, json() { return res; } };
    await setDiscount({ user: { restaurantId: RID }, params: { id: SID }, body: { mode: "percent", value: 10 } }, res, (e) => { failure = e; });
    assert.equal(failure, undefined, failure && failure.message);
    assert.equal(session.bills.discount, 10, "10% of the ₹100 accepted bill");
  });
});

test("a discount's base is the bill's subtotal: each weighed line to the paisa first", async () => {
  const session = {
    restaurantId: RID, status: "OCCUPIED", bills: {}, timeline: [],
    // 333.33 x 1.8 = 599.994 per line: the bill shows 1199.98, not 1199.99.
    items: [1, 2].map(() => ({ price: 333.33, quantity: 1.8, status: "preparing", addedBy: "POS" })),
    save: async () => {},
  };
  const fakes = {
    "../services/gst": noGst,
    "../models/tableSessionModel": { findOne: async () => session },
    "../models/orderModel": { find: async () => [] },
    "../services/socket": socket,
  };
  await withFakes(fakes, async ({ setDiscount }) => {
    const res = { status() { return res; }, json() { return res; } };
    const call = async (body) => {
      let failure;
      await setDiscount({ user: { restaurantId: RID }, params: { id: SID }, body }, res, (e) => { failure = e; });
      return failure;
    };
    const whole = await call({ mode: "fixed", value: 1199.98 });
    assert.equal(whole && whole.status, 400, "a discount of the whole bill would leave a ₹0 table stuck");
    assert.equal(await call({ mode: "percent", value: 50 }), undefined);
    assert.equal(session.bills.discount, 599.99);
  });
});

// A table bill settled through recordSessionPayment, with every write recorded.
const settle = async ({ session, orders, viaGateway, gatewayOrderId, body }) => {
  const calls = { updateOne: [] };
  const origStart = mongoose.startSession;
  mongoose.startSession = async () => ({ startTransaction() {}, commitTransaction: async () => {}, abortTransaction: async () => {}, endSession() {} });
  const fakes = {
    "./tableBookingController": { findActiveBlock: async () => null, blockedError: () => new Error("b"), formatTimeOf: () => "" },
    "../models/tableSessionModel": { findOne: () => ({ session: async () => session }) },
    "../models/tableModel": { findOneAndUpdate: async () => ({}) },
    "../models/paymentTransactionModel": { create: async (d) => d, updateMany: async () => {} },
    "../models/billModel": { create: async () => [{ _id: "b1" }], findOneAndUpdate: async () => {} },
    "../models/orderModel": {
      find: () => ({ sort() { return this; }, session: async () => orders }),
      updateOne: async (q, u, o) => { calls.updateOne.push({ q, u, o }); },
      updateMany: async () => {},
    },
    "../services/eBillService": { fireAutoEBill: () => {} },
    "../services/orderCharge": { fireTableSessionCharge: () => {} },
    "../services/tableCooldownService": { buildCooldownUpdate: async () => ({}) },
    "../services/socket": socket,
  };
  try {
    return await withFakes(fakes, async (ctrl) => {
      let failure;
      if (viaGateway) {
        await ctrl
          .settleSessionFromGateway({ sessionId: session._id, restaurantId: RID, method: "ONLINE", amount: 100, platformFee: {}, transactionId: "cf_1", idempotencyKey: "qr-online-cf_1", gatewayOrderId })
          .catch((e) => { failure = e; });
      } else {
        const res = { status() { return res; }, json() { return res; } };
        await ctrl.recordSessionPayment({ user: { restaurantId: RID, _id: "u1" }, params: { id: session._id }, body }, res, (e) => { failure = e; });
      }
      return { failure, calls };
    });
  } finally {
    mongoose.startSession = origStart;
  }
};

const tableWithGuestDish = () => ({
  _id: SID, sessionCode: "TS_P", restaurantId: RID, tableId: "507f1f77bcf86cd799439099",
  status: "OCCUPIED", customerName: "B", customerPhone: "9000000002", customerCount: 2,
  bills: { totalWithTax: 100 },
  payment: { status: "PENDING", platformFee: {}, gatewayProvider: "cashfree", gatewayOrderId: "tbl_TS_P_B", gatewayOrderIds: ["tbl_TS_P_A"] },
  paymentHistory: [], timeline: [],
  items: [
    { _id: "i1", name: "Dosa", price: 100, quantity: 1, total: 100, status: "preparing", addedBy: "POS", kdsItemId: "k1" },
    { _id: "i2", name: "Coffee", price: 50, quantity: 1, total: 50, status: "pending", addedBy: "QR", kdsItemId: "k2" },
  ],
  toObject() { return this; }, save: async () => {},
});

test("N017: the till cannot settle past a guest dish nobody has accepted or declined", async () => {
  const session = tableWithGuestDish();
  const { failure, calls } = await settle({ session, orders: [{ _id: "o1", orderStatus: "Preparing", items: [] }], body: { method: "CASH", amount: 100 } });
  assert.equal(failure?.status, 409);
  assert.equal(failure.message, "1 dish(es) the guest added are waiting: accept or decline them first.");
  assert.equal(session.status, "OCCUPIED");
  assert.equal(session.items[1].status, "pending");
  assert.equal(calls.updateOne.length, 0, "no order was touched");
});

test("N017 + S4: a gateway settle declines the unaccepted dish and books the order that paid", async () => {
  const session = tableWithGuestDish();
  // The guest's dish lives in a second order, merged into the oldest on settle.
  const orders = [
    { _id: "o1", orderStatus: "Preparing", items: [{ _id: "k1", name: "Dosa", status: "preparing" }] },
    { _id: "o2", orderStatus: "Preparing", items: [{ _id: "k2", name: "Coffee", status: "pending" }] },
  ];
  const { failure, calls } = await settle({ session, orders, viaGateway: true, gatewayOrderId: "tbl_TS_P_A" });
  assert.equal(failure, undefined, failure && failure.message);
  assert.equal(session.status, "CLOSED");
  assert.equal(session.items[1].status, "cancelled");
  assert.equal(session.items[1].cancelReason, "Not accepted before payment");
  assert.equal(session.items[0].status, "preparing", "the accepted dish is untouched");

  // S4: the paid (earlier) attempt is the booked one; the displaced id stays findable.
  assert.equal(session.payment.method, "ONLINE");
  assert.equal(session.payment.gatewayOrderId, "tbl_TS_P_A");
  assert.deepEqual(session.payment.gatewayOrderIds, ["tbl_TS_P_A", "tbl_TS_P_B"]);

  // The primary order's $set runs after the merge $push and cancels the line by its id.
  const last = calls.updateOne[calls.updateOne.length - 1];
  assert.equal(last.q._id, "o1");
  assert.ok(calls.updateOne[0].u.$push, "the merge ran first");
  assert.equal(last.u.$set["items.$[declined].status"], "cancelled");
  assert.equal(last.u.$set["items.$[declined].cancelReason"], "Not accepted before payment");
  assert.deepEqual(last.o.arrayFilters, [{ "declined._id": { $in: ["k2"] } }]);
  assert.equal(last.u.$set["paymentData.gatewayOrderId"], "tbl_TS_P_A");
});

test("S4: a gateway settle without an order id keeps the session's own", async () => {
  const session = tableWithGuestDish();
  session.items.pop();
  const { failure, calls } = await settle({ session, orders: [{ _id: "o1", orderStatus: "Preparing", items: [] }], viaGateway: true });
  assert.equal(failure, undefined, failure && failure.message);
  assert.equal(session.payment.gatewayOrderId, "tbl_TS_P_B");
  assert.deepEqual(session.payment.gatewayOrderIds, ["tbl_TS_P_A"]);
  assert.equal(calls.updateOne[0].o.arrayFilters, undefined, "no array filter when nothing was declined");
});

test("N015a: settling a merged table books the bill under the TABLE's customer", async () => {
  const session = tableWithGuestDish();
  session.items.pop();
  session.customerCount = 4;
  const orders = [
    { _id: "oA", orderStatus: "Preparing", customerDetails: { name: "A", phone: "9000000001" }, items: [] }, // merged in, older
    { _id: "oB", orderStatus: "Preparing", customerDetails: { name: "B", phone: "9000000002" }, items: [] },
  ];
  const { failure, calls } = await settle({ session, orders, body: { method: "CASH", amount: 100 } });
  assert.equal(failure, undefined, failure && failure.message);
  const primary = calls.updateOne.find((c) => c.q._id === "oA" && c.u.$set).u.$set;
  assert.equal(primary["customerDetails.phone"], "9000000002");
  assert.equal(primary["customerDetails.name"], "B");
  assert.equal(primary["customerDetails.guests"], 4);
  assert.equal(session.payment.method, "CASH");
  assert.equal(primary["paymentData.gatewayOrderId"], undefined, "cash is not gateway money");
});

test("S6: restrikeOpenBills re-prices open tables only, and skips one that fails", async () => {
  const mk = (status, extra = {}) => ({
    _id: status, status, restaurantId: RID,
    items: [{ price: 100, quantity: 2, status: "served", addedBy: "POS" }],
    bills: { serviceChargePercent: 10, serviceCharge: 20, totalWithTax: 220 },
    save: async () => {},
    ...extra,
  });
  const all = [mk("OCCUPIED"), mk("BILL_REQUESTED"), mk("PAYMENT_PENDING"), mk("PAID"), mk("OPEN", { save: async () => { throw new Error("boom"); } })];
  const asked = [];
  const fakes = {
    "../services/gst": noGst,
    "../models/tableSessionModel": {
      find: async (q) => {
        asked.push(q);
        return all.filter((s) => q.status.$in.includes(s.status));
      },
    },
  };
  await withFakes(fakes, async ({ restrikeOpenBills }) => {
    const n = await restrikeOpenBills(RID);
    assert.equal(n, 2);
    assert.deepEqual(asked[0].status.$in, ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED"]);
    assert.equal(asked[0].restaurantId, RID);
    assert.deepEqual(asked[0].isDeleted, { $ne: true });
    const total = (s) => all.find((x) => x.status === s).bills.totalWithTax;
    assert.deepEqual([total("OCCUPIED"), total("BILL_REQUESTED")], [200, 200]);
    assert.deepEqual([total("PAYMENT_PENDING"), total("PAID")], [220, 220], "a table already paying keeps its amount");
  });
});
