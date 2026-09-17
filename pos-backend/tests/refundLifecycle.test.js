/**
 * Refunds follow the payment method, and a refund is a Cashfree refund.
 *
 *   cash / counter UPI  -> no refund, ever, and Cashfree is never called
 *   gateway (Cashfree)  -> refundable only once CANCELLED; the money moves
 *                          through Cashfree's refund API; Cashfree's answer,
 *                          not our request, decides the status
 *
 * The service is loaded with the Order model, the gateway resolver and the
 * Cashfree client replaced, so every scenario here runs the real rules and
 * the real flow against a scripted gateway.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

class CashfreeError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * One interception for the whole file, installed once and left in place:
 * the service reaches for the Order model and the Cashfree client at CALL
 * time, not at require time, so the mocks must still be there when a
 * scenario runs. `current` is whatever the latest load() scripted.
 */
let current = { calls: { createRefund: [], getRefund: [], claims: [] }, store: new Map() };
const realLoad = Module._load;
Module._load = function (r) {
  if (r === "../models/orderModel") {
    return {
      // The one-attempt-at-a-time claim: a conditional update on the stored status.
      findOneAndUpdate: async (filter, update) => {
        current.calls.claims.push(filter);
        const stored = current.store.get(String(filter._id)) ?? "";
        if (!filter.refundStatus.$in.includes(stored)) return null;
        current.store.set(String(filter._id), update.$set.refundStatus);
        return { _id: filter._id };
      },
    };
  }
  if (r === "./paymentGateway") {
    return { resolveGateway: async () => current.gateway || { enabled: true, provider: "cashfree", keyId: "app", secret: "sec", environment: "TEST" } };
  }
  if (r === "./gateways/cashfree") {
    return {
      createRefund: async (args) => {
        current.calls.createRefund.push(args);
        return current.createRefund ? current.createRefund(args) : { refundId: args.refundId, cfRefundId: "cf1", status: "SUCCESS", amount: args.amount };
      },
      getRefund: async (args) => {
        current.calls.getRefund.push(args);
        if (!current.getRefund) throw new CashfreeError("not found", { status: 404 });
        return current.getRefund(args);
      },
    };
  }
  return realLoad.apply(this, arguments);
};

/** A fresh services/refunds with scripted collaborators. */
const load = ({ createRefund, getRefund, gateway } = {}) => {
  const calls = { createRefund: [], getRefund: [], claims: [] };
  const store = new Map(); // _id -> stored refundStatus, for the claim
  current = { createRefund, getRefund, gateway, calls, store };
  delete require.cache[require.resolve("../services/refunds")];
  const svc = require("../services/refunds");
  const order = (extra = {}) => {
    const doc = {
      _id: "64f000000000000000000abc",
      restaurantId: "r1",
      storeId: "231146",
      orderStatus: "Cancelled",
      bills: { totalWithTax: 850 },
      refunds: [],
      timeline: [],
      saves: 0,
      async save() {
        this.saves += 1;
        // the model's pre-save hook, which the mock has no schema for
        this.refundStatus = svc.refundStatusOf(this);
        current.store.set(String(this._id), this.refundStatus);
        return this;
      },
      ...extra,
    };
    store.set(String(doc._id), doc.refundStatus || "");
    return doc;
  };
  return { svc, calls, order };
};

const gatewayPaid = {
  paymentMethod: "online",
  payments: [{ method: "online", amount: 850, status: "paid" }],
  paymentData: { gatewayOrderId: "kk_231146_abc", gatewayPaymentId: "cf_order_9" },
};
const cashPaid = { paymentMethod: "Cash", payments: [{ method: "cash", amount: 850, status: "paid" }] };
const upiPaid = { paymentMethod: "UPI", payments: [{ method: "upi", amount: 850, status: "paid" }] };
const user = { _id: "u1", name: "Manager" };

// ---------------------------------------------------------------------------

test("Test 1 - cash: cancelled, paid, and there is nothing to refund; Cashfree is never called", async () => {
  const { svc, calls, order } = load();
  const o = order(cashPaid);
  assert.equal(svc.paymentKindOf(o), "cash");
  assert.equal(svc.refundStatusOf(o), "NOT_APPLICABLE");
  assert.equal(svc.refundableAmount(o), 0);
  await assert.rejects(svc.refundCancelledOrder(o, { user }), (e) => e.status === 409 && e.code === "PAYMENT_METHOD_CASH");
  assert.equal(calls.createRefund.length, 0);
  assert.equal(o.refunds.length, 0);
});

test("Test 2 - counter UPI: KnotKitchen never moved the money, so it cannot move it back", async () => {
  const { svc, calls, order } = load();
  const o = order(upiPaid);
  assert.equal(svc.paymentKindOf(o), "offline");
  assert.equal(svc.PAYMENT_KIND_LABELS.offline, "UPI / Offline Payment");
  assert.equal(svc.refundStatusOf(o), "NOT_APPLICABLE");
  await assert.rejects(svc.refundCancelledOrder(o, { user }), (e) => e.code === "PAYMENT_OFFLINE");
  assert.equal(calls.createRefund.length, 0);
});

test("a gateway order that is still active is NOT_REFUNDED and cannot be refunded yet", async () => {
  const { svc, calls, order } = load();
  const o = order({ ...gatewayPaid, orderStatus: "Completed" });
  assert.equal(svc.refundStatusOf(o), "NOT_REFUNDED");
  assert.equal(svc.refundableAmount(o), 0, "nothing is refundable before cancellation");
  await assert.rejects(svc.refundCancelledOrder(o, { user }), (e) => e.code === "ORDER_NOT_CANCELLED");
  assert.equal(calls.createRefund.length, 0);
});

test("Test 3 - Cashfree paid, cancelled: the refund is a real Cashfree refund and its answer sets the status", async () => {
  const { svc, calls, order } = load();
  const o = order(gatewayPaid);
  assert.equal(svc.refundStatusOf(o), "NOT_REFUNDED");
  assert.equal(svc.refundableAmount(o), 850);

  const { entry, amount } = await svc.refundCancelledOrder(o, { user, reason: "Kitchen closed" });
  assert.equal(calls.createRefund.length, 1);
  const sent = calls.createRefund[0];
  assert.equal(sent.orderId, "kk_231146_abc", "the stored gateway order id, never a display id");
  assert.equal(sent.amount, 850, "the amount paid, from the payment record");
  assert.equal(sent.refundId, "rf_0000000abc_1");
  assert.equal(sent.appId, "app");
  assert.equal(amount, 850);
  assert.equal(entry.status, "SUCCESS");
  assert.equal(entry.gateway.cfRefundId, "cf1");
  assert.ok(entry.completedAt);
  assert.equal(entry.refundedByName, "Manager");
  assert.equal(o.refundStatus, "REFUNDED");
  assert.equal(svc.refundableAmount(o), 0);
  assert.equal(svc.refundedTotal(o), 850);
  assert.equal(o.orderStatus, "Cancelled", "cancelled stays cancelled; the refund is its own state");
});

test("the amount is what was paid, less what already went back; never more than paid", () => {
  const { svc, order } = load();
  const o = order({ ...gatewayPaid, refunds: [{ amount: 300, status: "SUCCESS" }] });
  assert.equal(svc.refundableAmount(o), 550);
  const done = order({ ...gatewayPaid, refunds: [{ amount: 850, status: "SUCCESS" }] });
  assert.equal(svc.refundableAmount(done), 0);
  assert.equal(svc.refundStatusOf(done), "REFUNDED");
  // A pending attempt reserves its amount too.
  const pending = order({ ...gatewayPaid, refunds: [{ amount: 850, status: "PENDING" }] });
  assert.equal(svc.refundableAmount(pending), 0);
});

test("Test 4 - double click: the second request loses the claim and Cashfree is called once", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { svc, calls, order } = load({
    createRefund: async (args) => {
      await gate;
      return { refundId: args.refundId, cfRefundId: "cf1", status: "SUCCESS", amount: args.amount };
    },
  });
  const o = order(gatewayPaid);
  const first = svc.refundCancelledOrder(o, { user });
  await new Promise((r) => setImmediate(r));
  await assert.rejects(svc.refundCancelledOrder(o, { user }), (e) => e.status === 409 && /already in progress/.test(e.message));
  release();
  await first;
  assert.equal(calls.createRefund.length, 1);
  assert.equal(o.refunds.length, 1);
  assert.equal(o.refundStatus, "REFUNDED");
});

test("Test 5 - Cashfree refuses: FAILED with the reason, never REFUNDED, and a retry is offered", async () => {
  const { svc, calls, order } = load({
    createRefund: async () => {
      throw new CashfreeError("refund_amount exceeds the paid amount", { status: 400 });
    },
  });
  const o = order(gatewayPaid);
  const { entry } = await svc.refundCancelledOrder(o, { user });
  assert.equal(entry.status, "FAILED");
  assert.match(entry.failureReason, /exceeds/);
  assert.equal(entry.retrySafe, true);
  assert.equal(o.refundStatus, "REFUND_FAILED");
  assert.equal(svc.refundableAmount(o), 850, "nothing went back");
  assert.equal(calls.getRefund.length, 0, "a refusal is final; no lookup needed");

  // The retry is a NEW attempt with a new refund id.
  const { svc: svc2, calls: calls2 } = load();
  const again = await svc2.refundCancelledOrder(o, { user });
  assert.equal(calls2.createRefund[0].refundId, "rf_0000000abc_2");
  assert.equal(again.entry.status, "SUCCESS");
  assert.equal(o.refundStatus, "REFUNDED");
});

test("Test 6 - Cashfree says PENDING: REFUND_PENDING, no second attempt, and sync records the outcome", async () => {
  const { svc, calls, order } = load({
    createRefund: async (args) => ({ refundId: args.refundId, cfRefundId: "cf2", status: "PENDING", amount: args.amount }),
    getRefund: async (args) => ({ refundId: args.refundId, cfRefundId: "cf2", status: "SUCCESS", amount: 850 }),
  });
  const o = order(gatewayPaid);
  const { entry } = await svc.refundCancelledOrder(o, { user });
  assert.equal(entry.status, "PENDING");
  assert.equal(o.refundStatus, "REFUND_PENDING");
  await assert.rejects(svc.refundCancelledOrder(o, { user }), (e) => e.code === "REFUND_PENDING");
  assert.equal(calls.createRefund.length, 1);

  const synced = await svc.syncRefund(o);
  assert.equal(calls.getRefund[0].refundId, "rf_0000000abc_1");
  assert.equal(synced.changed, true);
  assert.equal(synced.entry.status, "SUCCESS");
  assert.equal(o.refundStatus, "REFUNDED");
});

test("Test 7 - already refunded: no button, and another attempt is refused", async () => {
  const { svc, calls, order } = load();
  const o = order({ ...gatewayPaid, refunds: [{ amount: 850, status: "SUCCESS", gateway: { refundId: "rf_x_1", status: "SUCCESS" } }] });
  assert.equal(svc.refundStatusOf(o), "REFUNDED");
  await assert.rejects(svc.refundCancelledOrder(o, { user }), (e) => e.code === "ALREADY_REFUNDED");
  assert.equal(calls.createRefund.length, 0);
});

test("a timeout is reconciled by asking Cashfree, not by guessing", async () => {
  // Cashfree did act on it: the lookup finds the refund and it counts.
  const acted = load({
    createRefund: async () => {
      throw new CashfreeError("Cashfree request timed out.", { retryable: true });
    },
    getRefund: async (args) => ({ refundId: args.refundId, cfRefundId: "cf3", status: "SUCCESS", amount: 850 }),
  });
  const o1 = acted.order(gatewayPaid);
  const r1 = await acted.svc.refundCancelledOrder(o1, { user });
  assert.equal(r1.entry.status, "SUCCESS");
  assert.equal(o1.refundStatus, "REFUNDED");
  assert.equal(acted.calls.createRefund.length, 1);

  // Cashfree never received it: failed, safe to retry.
  const lost = load({
    createRefund: async () => {
      throw new CashfreeError("Cashfree request timed out.", { retryable: true });
    },
  });
  const o2 = lost.order(gatewayPaid);
  const r2 = await lost.svc.refundCancelledOrder(o2, { user });
  assert.equal(r2.entry.status, "FAILED");
  assert.equal(r2.entry.retrySafe, true);
  assert.equal(o2.refundStatus, "REFUND_FAILED");

  // Cashfree unreachable for the lookup too: failed, NOT safe to retry blind.
  const dark = load({
    createRefund: async () => {
      throw new CashfreeError("Cashfree request timed out.", { retryable: true });
    },
    getRefund: async () => {
      throw new CashfreeError("Cashfree 503", { status: 503, retryable: true });
    },
  });
  const o3 = dark.order(gatewayPaid);
  const r3 = await dark.svc.refundCancelledOrder(o3, { user });
  assert.equal(r3.entry.status, "FAILED");
  assert.equal(r3.entry.retrySafe, false);
  await assert.rejects(dark.svc.refundCancelledOrder(o3, { user }), (e) => e.code === "REFUND_UNCONFIRMED");
});

test("a store without a Cashfree gateway cannot refund a gateway order from here", async () => {
  const { svc, calls, order } = load({ gateway: { enabled: false } });
  const o = order(gatewayPaid);
  const { entry } = await svc.refundCancelledOrder(o, { user });
  assert.equal(entry.status, "FAILED");
  assert.match(entry.failureReason, /Cashfree gateway is not configured/);
  assert.equal(calls.createRefund.length, 0);
});

test("the view a screen gets says how it was paid and where the refund stands", () => {
  const { svc, order } = load();
  assert.deepEqual(svc.refundView(order(cashPaid)), {
    paymentKind: "cash", paymentKindLabel: "Cash", paid: true, refundStatus: "NOT_APPLICABLE", refundableAmount: 0, refundedTotal: 0,
  });
  assert.equal(svc.refundView(order(upiPaid)).paymentKindLabel, "UPI / Offline Payment");
  assert.equal(svc.refundView(order(gatewayPaid)).paymentKindLabel, "Gateway Payment");
  assert.equal(svc.refundView(order(gatewayPaid)).refundableAmount, 850);
  assert.equal(svc.refundView(order({ orderStatus: "Preparing" })).paid, false);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test("SOURCE: the controller trusts nothing from the browser but the reason", () => {
  const ctrl = read("controllers", "orderController.js");
  const block = ctrl.slice(ctrl.indexOf("const refundOrder"), ctrl.indexOf("const syncOrderRefund"));
  assert.match(block, /refundCancelledOrder\(order, \{ user: req\.user, reason: req\.body\?\.reason \}\)/);
  assert.ok(!/req\.body\?\.amount|req\.body\.amount|paymentId|gatewayOrderId/.test(block), "no amount, no ids from the request");
  assert.match(ctrl, /const voidingPaid = Boolean\(req\.voidWithReason\)/, "a paid order is voided only through the reasoned route");
  const routes = read("routes", "orderRoute.js");
  assert.match(routes, /"\/:id\/refund"\)\.post\(isVerifiedUser, requireManager, refundOrder\)/);
  assert.match(routes, /"\/:id\/refund\/sync"\)\.post\(isVerifiedUser, requireManager, syncOrderRefund\)/);
  assert.match(routes, /"\/:id\/cancel"\)\.put\(isVerifiedUser, requireProtectedAction, cancelOrder\)/);
});

test("SOURCE: every order read carries the refund view, and the model keeps refundStatus in step", () => {
  const ctrl = read("controllers", "orderController.js");
  assert.ok((ctrl.match(/refundView\(/g) || []).length >= 4, "list, detail, refund, sync");
  const model = read("models", "orderModel.js");
  assert.match(model, /refundStatus: \{\n\s+type: String,\n\s+enum: \["", "NOT_APPLICABLE", "NOT_REFUNDED", "REFUND_PENDING", "REFUNDED", "REFUND_FAILED"\]/);
  assert.match(model, /this\.refundStatus = refundStatusOf\(this\)/);
  assert.match(model, /failureReason: \{ type: String/);
});

test("SOURCE: the Cashfree client can read a refund back, and refund webhooks are verified then synced", () => {
  const cf = read("services", "gateways", "cashfree.js");
  assert.match(cf, /path: `\/orders\/\$\{encodeURIComponent\(orderId\)\}\/refunds\/\$\{encodeURIComponent\(refundId\)\}`/);
  const hook = read("controllers", "cashfreeWebhookController.js");
  assert.match(hook, /startsWith\("REFUND"\)/);
  const refundBlock = hook.slice(hook.indexOf("const handleRefundEvent"));
  assert.ok(refundBlock.indexOf("verifyWebhook") < refundBlock.indexOf("syncRefund(order"), "signature first, then ask Cashfree");
  assert.match(refundBlock, /"refunds\.gateway\.refundId": refundId/);
});
