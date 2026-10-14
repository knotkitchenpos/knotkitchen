// Table QR money path (QA batch 8, P1): the diner's Pay tap, verify, the
// Cashfree webhook and the gateway helpers. The real controllers run with
// their DB modules, the session controller and Cashfree's order calls faked;
// refunds go through the real cashfree adapter over a stubbed fetch, so the
// refund id is the one Cashfree would see.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const crypto = require("crypto");

const realCashfree = require("../services/gateways/cashfree");
const RealTableSession = require("../models/tableSessionModel");

const RID = "507f1f77bcf86cd799439011";
const QR = "../controllers/qrController";
const HOOK = "../controllers/cashfreeWebhookController";
const GW = { enabled: true, provider: "cashfree", keyId: "k", secret: "s", environment: "TEST", webhookSecret: "w" };
const ua = (orderId) => `ua_${crypto.createHash("sha1").update(orderId).digest("hex").slice(0, 30)}`;

const withFakes = async (fakes, modulePath, run) => {
  const orig = Module._load;
  Module._load = function (r) {
    if (Object.prototype.hasOwnProperty.call(fakes, r)) return fakes[r];
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve(modulePath)];
  try {
    return await run(require(modulePath));
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve(modulePath)];
  }
};

/** Cashfree's refund endpoint, recorded. `fail` answers 500 to everything; state.refundStatus is what a refund says. */
const withRefundApi = async (state, run, { fail = false } = {}) => {
  const orig = global.fetch;
  global.fetch = async (url, init = {}) => {
    if (fail) return { status: 500, ok: false, json: async () => ({ message: "down" }) };
    const refundStatus = state.refundStatus || "PENDING";
    if (init.method === "POST" && /\/refunds$/.test(url)) {
      const body = JSON.parse(init.body);
      state.refunds.push({ orderId: decodeURIComponent(url.split("/orders/")[1].split("/")[0]), ...body });
      return { status: 200, ok: true, json: async () => ({ refund_id: body.refund_id, cf_refund_id: 7, refund_status: refundStatus, refund_amount: body.refund_amount }) };
    }
    if ((init.method || "GET") === "GET" && /\/refunds\/[^/]+$/.test(url)) {
      return { status: 200, ok: true, json: async () => ({ refund_id: decodeURIComponent(url.split("/refunds/")[1]), cf_refund_id: 7, refund_status: refundStatus, refund_amount: 505 }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    return await run();
  } finally {
    global.fetch = orig;
  }
};

const mkRes = () => {
  const r = { code: 200, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
  return r;
};

const tableSession = (over = {}) => ({
  _id: "s1", sessionCode: "TS_1", restaurantId: RID, status: "PAYMENT_PENDING", accessToken: "",
  customerPhone: "9876543210", customerName: "Asha", bills: { totalWithTax: 500 }, items: [],
  payment: { status: "PENDING", gatewayProvider: "cashfree", gatewayOrderId: "", gatewayOrderIds: [], platformFee: {} },
  timeline: [],
  save: async () => {},
  ...over,
});

const newState = (session, orders = {}) => ({ session, orders, opened: [], settled: [], refunds: [], paidChecks: [], liveClaims: [] });

/** TableSession.updateOne on state.session: the filter's dotted fields, then $set, $addToSet, $pull, $push. */
const sessionWrites = (state) => ({
  updateOne: async (filter, update) => {
    const s = state.session;
    const at = (path) => path.split(".").reduce((o, k) => o?.[k], s);
    const put = (path, v) => { const ks = path.split("."); ks.slice(0, -1).reduce((o, k) => o[k], s)[ks.at(-1)] = v; };
    if (state.writeError) throw state.writeError;
    if (!s || Object.entries(filter).some(([k, v]) => k !== "_id" && at(k) !== v)) return { modifiedCount: 0 };
    for (const [k, v] of Object.entries(update.$set || {})) put(k, v);
    for (const [k, v] of Object.entries(update.$addToSet || {})) put(k, [...new Set([...(at(k) || []), ...(v.$each || [v])])]);
    for (const [k, v] of Object.entries(update.$pull || {})) put(k, (at(k) || []).filter((x) => x !== v));
    for (const [k, v] of Object.entries(update.$push || {})) at(k).push(v);
    return { modifiedCount: 1 };
  },
  // The real static, run against the updateOne above.
  dropRefundedOrder: RealTableSession.dropRefundedOrder,
});

/** Cashfree as the controllers see it: orders by id, from state.orders. */
const cashfreeFake = (state) => ({
  ...realCashfree,
  createOrder: async ({ orderId, amount }) => {
    // Two Pay taps in one millisecond: a distinct id each, as two taps a moment apart get.
    if (state.orders[orderId]) orderId = `${orderId}_${state.opened.length}`;
    state.opened.push({ orderId, amount });
    state.orders[orderId] = { order_status: "ACTIVE", order_amount: amount, payment_session_id: `ps_${orderId}` };
    return { orderId, paymentSessionId: `ps_${orderId}`, environment: "TEST" };
  },
  fetchOrder: async ({ orderId }) => {
    const o = state.orders[orderId];
    if (!o || o.throws) throw new realCashfree.CashfreeError("Cashfree request timed out.", { retryable: true });
    return { order_id: orderId, cf_order_id: `cf_${orderId}`, ...o };
  },
  isOrderPaid: async ({ orderId }) => {
    state.paidChecks.push(orderId);
    const o = state.orders[orderId];
    if (!o || o.throws) throw new realCashfree.CashfreeError("Cashfree request timed out.", { retryable: true });
    return { paid: o.order_status === "PAID", orderStatus: o.order_status, amount: o.order_amount, cfOrderId: `cf_${orderId}` };
  },
  verifyWebhook: () => true,
});

const qrFakes = (state) => ({
  "./tableSessionController": {
    findActiveSessionByTable: async () => state.session,
    settleSessionFromGateway: async (a) => {
      state.settled.push(a);
      state.session.status = "CLOSED";
    },
  },
  "../models/tableSessionModel": {
    ...sessionWrites(state),
    exists: async (q) => (state.liveClaims.includes(q.accessToken) && q.status.$in.includes("OCCUPIED") ? { _id: "elsewhere" } : null),
    findById: async () => state.session,
  },
  "../models/orderModel": { findOne: () => ({ sort() { return this; }, select() { return this; }, lean: async () => null }) },
  "../services/paymentGateway": { resolveGateway: async () => GW, isOnlinePaymentEnabled: async () => true, PROVIDERS: { CASHFREE: "cashfree" } },
  "../services/orderCharge": { quotePlatformFee: async () => null },
  "../services/gateways/cashfree": cashfreeFake(state),
});

const qrReq = (query = {}) => ({ scope: { table: { _id: "t1" }, restaurantId: RID }, body: {}, query });

/** Run one QR handler; resolves to the response (or the error passed to next). */
const callQr = (state, handler, query) =>
  withRefundApi(state, () =>
    withFakes(qrFakes(state), QR, async (ctrl) => {
      const res = mkRes();
      let failure;
      await ctrl[handler](qrReq(query), res, (e) => { failure = e; });
      return { res, failure };
    }),
  );

// ---------------------------------------------------------------------------
// N021a: the Pay button
// ---------------------------------------------------------------------------

test("N021a: a second Pay tap while the first checkout is open reuses it, opening no second Cashfree order", async () => {
  const state = newState(tableSession({ status: "BILL_REQUESTED" }));
  const run = () => withFakes(qrFakes(state), QR, async ({ paymentIntent }) => {
    const res = mkRes();
    await paymentIntent(qrReq(), res, (e) => { throw e; });
    return res.body.data.checkout;
  });
  const first = await run();
  const second = await run();
  assert.equal(state.opened.length, 1, "one bill, one payable Cashfree order");
  assert.equal(second.paymentSessionId, first.paymentSessionId);
  assert.equal(second.gatewayOrderId, first.gatewayOrderId);
  assert.deepEqual(state.session.payment.gatewayOrderIds, [first.gatewayOrderId]);
});

test("N021a: an earlier order we cannot read, or one for another amount, is replaced but remembered", async () => {
  for (const earlier of [{ throws: true }, { order_status: "ACTIVE", order_amount: 400, payment_session_id: "ps_A" }]) {
    const state = newState(tableSession({ payment: { ...tableSession().payment, gatewayOrderId: "tbl_A" } }), { tbl_A: earlier });
    const { res, failure } = await callQr(state, "paymentIntent");
    assert.equal(failure, undefined, failure && failure.message);
    assert.equal(state.opened.length, 1, JSON.stringify(earlier));
    assert.equal(res.body.data.checkout.gatewayOrderId, state.opened[0].orderId);
    assert.equal(state.session.payment.gatewayOrderId, state.opened[0].orderId);
    assert.deepEqual(state.session.payment.gatewayOrderIds, ["tbl_A", state.opened[0].orderId], "a late payment on A is still found");
  }
});

test("N021a: an earlier order already PAID settles the table under that order, opening none", async () => {
  const state = newState(tableSession({ payment: { ...tableSession().payment, gatewayOrderId: "tbl_A" } }), {
    tbl_A: { order_status: "PAID", order_amount: 500 },
  });
  const { res } = await callQr(state, "paymentIntent");
  assert.equal(state.opened.length, 0);
  assert.equal(state.settled.length, 1);
  assert.equal(state.settled[0].gatewayOrderId, "tbl_A");
  assert.equal(state.settled[0].idempotencyKey, "qr-online-cf_tbl_A");
  assert.equal(res.code, 400, "never 409: the diner page ends its session on a 409 from Pay");
  assert.match(res.body.message, /earlier payment went through/);
});

test("N021a: an earlier PAID order for a bill that has since changed is refunded, still as a 400", async () => {
  const state = newState(tableSession({ payment: { ...tableSession().payment, gatewayOrderId: "tbl_A" } }), {
    tbl_A: { order_status: "PAID", order_amount: 400 },
  });
  const { res } = await callQr(state, "paymentIntent");
  assert.equal(state.opened.length, 0);
  assert.equal(state.settled.length, 0);
  assert.deepEqual(state.refunds.map((r) => [r.orderId, r.refund_id, r.refund_amount]), [["tbl_A", ua("tbl_A"), 400]]);
  assert.equal(res.code, 400);
  assert.equal(res.body.message, "Your bill changed while you were paying, so that payment of ₹400 is being refunded. Please pay the new total.");
  assert.equal(state.session.payment.gatewayOrderId, "", "the refunded order is dropped");
});

// ---------------------------------------------------------------------------
// N017: dishes nobody accepted
// ---------------------------------------------------------------------------

test("N017: Pay is refused while a guest's latest dishes wait for the staff, and the table is not flipped", async () => {
  const state = newState(tableSession({
    status: "OCCUPIED",
    items: [
      { name: "Dosa", status: "preparing", addedBy: "QR" },
      { name: "Coffee", status: "pending", addedBy: "QR" },
    ],
  }));
  const { res } = await callQr(state, "paymentIntent");
  assert.equal(res.code, 400, "400, never 409");
  assert.equal(res.body.message, "Your latest dishes are waiting for the staff to confirm them. Please try again in a moment.");
  assert.equal(state.session.status, "OCCUPIED");
  assert.equal(state.opened.length, 0);
});

// ---------------------------------------------------------------------------
// N015b: a party the till moved
// ---------------------------------------------------------------------------

test("N015b: a party moved to another table is told so, not that their order was settled", async () => {
  const state = newState(null);
  state.liveClaims.push("claim-live");
  const moved = await callQr(state, "getSessionByToken", { s: "claim-live" });
  assert.equal(moved.failure?.status, 409, "same status as the expired path");
  assert.equal(moved.failure.message, "Your party was moved to another table. Please scan the QR code on your new table.");

  const settled = await callQr(state, "getSessionByToken", { s: "claim-old" });
  assert.match(settled.failure.message, /has been settled/);
});

// ---------------------------------------------------------------------------
// paymentVerify
// ---------------------------------------------------------------------------

test("N016: verify refunds a payment for a bill that changed, and tells the diner", async () => {
  const state = newState(tableSession({ bills: { totalWithTax: 600 }, payment: { ...tableSession().payment, gatewayOrderId: "tbl_A" } }), {
    tbl_A: { order_status: "PAID", order_amount: 500 },
  });
  const { res } = await callQr(state, "paymentVerify");
  assert.equal(res.code, 409);
  assert.equal(res.body.message, "Your bill changed while you were paying, so that payment of ₹500 is being refunded. Please pay the new total.");
  assert.deepEqual(state.refunds.map((r) => [r.refund_id, r.refund_amount]), [[ua("tbl_A"), 500]]);
  assert.equal(state.settled.length, 0);
  assert.equal(state.session.payment.gatewayOrderId, "");
  assert.deepEqual(state.session.timeline.map((t) => [t.event, t.note]), [["ONLINE_PAYMENT_REFUNDED", "₹500 online payment refunded (order tbl_A): bill changed during payment"]]);
});

test("N021a: verify finds the earlier attempt the diner actually paid", async () => {
  const state = newState(tableSession({ payment: { ...tableSession().payment, gatewayOrderId: "tbl_C", gatewayOrderIds: ["tbl_A", "tbl_B"] } }), {
    tbl_A: { order_status: "PAID", order_amount: 500 },
    tbl_B: { throws: true }, // unreadable earlier attempt: skipped, the webhook is the backstop
    tbl_C: { order_status: "ACTIVE", order_amount: 500 },
  });
  const { res } = await callQr(state, "paymentVerify");
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.deepEqual(state.paidChecks, ["tbl_C", "tbl_B", "tbl_A"], "current first, then newest first");
  assert.equal(state.settled[0].gatewayOrderId, "tbl_A");
});

test("verify: an unreadable CURRENT order is still a 502, and a failed refund keeps the order for a retry", async () => {
  const unreadable = newState(tableSession({ payment: { ...tableSession().payment, gatewayOrderId: "tbl_A" } }), { tbl_A: { throws: true } });
  assert.equal((await callQr(unreadable, "paymentVerify")).res.code, 502);

  const state = newState(tableSession({ bills: { totalWithTax: 600 }, payment: { ...tableSession().payment, gatewayOrderId: "tbl_A" } }), {
    tbl_A: { order_status: "PAID", order_amount: 500 },
  });
  const res = await withRefundApi(state, () => withFakes(qrFakes(state), QR, async ({ paymentVerify }) => {
    const r = mkRes();
    await paymentVerify(qrReq(), r, (e) => { throw e; });
    return r;
  }), { fail: true });
  assert.equal(res.code, 502);
  assert.match(res.body.message, /could not confirm that payment/);
  assert.equal(state.session.payment.gatewayOrderId, "tbl_A");
});

// ---------------------------------------------------------------------------
// The webhook
// ---------------------------------------------------------------------------

const hookFakes = (state) => ({
  "../models/tableSessionModel": {
    ...sessionWrites(state),
    // The $or the webhook sends: the current order, or one opened before it; or a refund event's refundedOrderIds.
    findOne: async (f) => {
      const s = state.session;
      const hit = f.$or
        ? s && f.$or.some((c) => c["payment.gatewayOrderId"] === s.payment.gatewayOrderId || (s.payment.gatewayOrderIds || []).includes(c["payment.gatewayOrderIds"]))
        : s && (s.payment.refundedOrderIds || []).includes(f["payment.refundedOrderIds"]);
      return hit ? s : null;
    },
    findById: async () => state.fresh || state.session,
  },
  "../models/paymentLinkModel": { findOne: async () => null },
  "../models/rechargeOrderModel": { findOne: async () => null },
  "../models/websiteCheckoutModel": { findOne: async () => null },
  "../services/paymentGateway": { resolveGateway: async () => GW, resolvePlatformGateway: () => ({}), PROVIDERS: { CASHFREE: "cashfree" } },
  "../services/gateways/cashfree": cashfreeFake(state),
  "./tableSessionController": {
    settleSessionFromGateway: async (a) => {
      if (state.settleError) throw state.settleError;
      state.settled.push(a);
    },
  },
});

const hook = (state, orderId, { refundsFail = false } = {}) => {
  const body = { type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: orderId } } };
  const req = { rawBody: Buffer.from(JSON.stringify(body)), body, headers: { "x-webhook-timestamp": "1", "x-webhook-signature": "x" } };
  return withRefundApi(state, () => withFakes(hookFakes(state), HOOK, async ({ cashfreeWebhook }) => {
    const res = mkRes();
    await cashfreeWebhook(req, res);
    return res;
  }), { fail: refundsFail });
};

test("N021a webhook: a paid earlier attempt (only in gatewayOrderIds) settles the open table", async () => {
  const state = newState(tableSession({ payment: { ...tableSession().payment, gatewayOrderId: "tbl_B", gatewayOrderIds: ["tbl_A"] } }), {
    tbl_A: { order_status: "PAID", order_amount: 500 },
  });
  const res = await hook(state, "tbl_A");
  assert.equal(res.body.settled, "session", JSON.stringify(res.body));
  assert.equal(state.settled.length, 1);
  assert.equal(state.settled[0].gatewayOrderId, "tbl_A");
  assert.equal(state.refunds.length, 0);
});

test("N021b: a payment that lands after the till settled the table in cash is refunded once and noted", async () => {
  const state = newState(tableSession({
    status: "CLOSED",
    payment: { method: "CASH", status: "PAID", gatewayProvider: "cashfree", gatewayOrderId: "tbl_A", gatewayOrderIds: [], platformFee: {} },
  }), { tbl_A: { order_status: "PAID", order_amount: 500 } });
  const res = await hook(state, "tbl_A");
  assert.equal(res.code, 200);
  assert.equal(res.body.refunded, true);
  assert.equal(state.refunds.length, 1);
  assert.match(state.refunds[0].refund_id, /^ua_/);
  assert.equal(state.refunds[0].refund_id, ua("tbl_A"));
  assert.equal(state.refunds[0].refund_amount, 500);
  assert.equal(state.settled.length, 0);
  assert.equal(state.session.payment.gatewayOrderId, "", "A is dropped from the session");
  assert.deepEqual(state.session.timeline.map((t) => [t.event, t.note, t.actorType]), [
    ["ONLINE_PAYMENT_REFUNDED", "₹500 online payment refunded (order tbl_A): table already settled", "SYSTEM"],
  ]);
});

test("S4b: a table settled online by THIS order is already settled; by another order, this one is refunded", async () => {
  const byThis = newState(tableSession({
    status: "CLOSED",
    payment: { method: "ONLINE", status: "PAID", gatewayProvider: "cashfree", gatewayOrderId: "tbl_A", gatewayOrderIds: ["tbl_B"], platformFee: {} },
  }), { tbl_A: { order_status: "PAID", order_amount: 500 }, tbl_B: { order_status: "PAID", order_amount: 500 } });
  const again = await hook(byThis, "tbl_A");
  assert.equal(again.body.alreadySettled, true);
  assert.deepEqual(byThis.paidChecks, [], "a repeat delivery does not even ask Cashfree");

  const other = await hook(byThis, "tbl_B");
  assert.equal(other.body.refunded, true);
  assert.deepEqual(byThis.refunds.map((r) => r.refund_id), [ua("tbl_B")]);
  assert.deepEqual(byThis.session.payment.gatewayOrderIds, [], "B pulled; A, the settling order, kept");
  assert.equal(byThis.session.payment.gatewayOrderId, "tbl_A");
});

test("webhook: a refund that fails answers 500 so Cashfree retries, and keeps the order", async () => {
  const state = newState(tableSession({
    status: "CLOSED",
    payment: { method: "CASH", status: "PAID", gatewayProvider: "cashfree", gatewayOrderId: "tbl_A", gatewayOrderIds: [], platformFee: {} },
  }), { tbl_A: { order_status: "PAID", order_amount: 500 } });
  const res = await hook(state, "tbl_A", { refundsFail: true });
  assert.equal(res.code, 500);
  assert.equal(state.session.payment.gatewayOrderId, "tbl_A");
  assert.deepEqual(state.session.timeline, []);
});

test("webhook: a settle the table refuses is refunded; one the browser won is not; a write clash is retried", async () => {
  const open = () => tableSession({ payment: { ...tableSession().payment, gatewayOrderId: "tbl_A" } });
  const paid = { tbl_A: { order_status: "PAID", order_amount: 500 } };

  const refused = newState(open(), { ...paid });
  refused.settleError = Object.assign(new Error("This table's order was cancelled. There is nothing to charge."), { status: 409 });
  const r1 = await hook(refused, "tbl_A");
  assert.equal(r1.body.refunded, true);
  assert.deepEqual(refused.refunds.map((r) => r.refund_note), ["Could not be applied to the table"]);

  const browserWon = newState(open(), { ...paid });
  browserWon.settleError = Object.assign(new Error("This table session has already been paid."), { status: 400 });
  browserWon.fresh = { ...open(), status: "CLOSED", payment: { ...open().payment, method: "ONLINE", status: "PAID" } };
  const r2 = await hook(browserWon, "tbl_A");
  assert.equal(r2.body.settled, false);
  assert.equal(browserWon.refunds.length, 0);

  const clash = newState(open(), { ...paid });
  clash.settleError = Object.assign(new Error("Write conflict"), { code: 112 });
  const r3 = await hook(clash, "tbl_A");
  assert.equal(r3.code, 500, "the browser's settle may still be committing: never refund on a clash");
  assert.equal(clash.refunds.length, 0);
});

test("N016: verify and the webhook refund a changed bill under the same refund id", async () => {
  const mk = () => newState(tableSession({ bills: { totalWithTax: 600 }, payment: { ...tableSession().payment, gatewayOrderId: "tbl_A" } }), {
    tbl_A: { order_status: "PAID", order_amount: 500 },
  });
  const viaHook = mk();
  const res = await hook(viaHook, "tbl_A");
  assert.equal(res.body.refunded, true);
  const viaVerify = mk();
  await callQr(viaVerify, "paymentVerify");
  assert.equal(viaHook.refunds.length, 1);
  assert.equal(viaHook.refunds[0].refund_id, viaVerify.refunds[0].refund_id, "one refund, whichever path gets there first");
  assert.equal(viaHook.session.timeline[0].note, "₹500 online payment refunded (order tbl_A): bill changed during payment");
});

// ---------------------------------------------------------------------------
// S1, S2: the gateway helpers
// ---------------------------------------------------------------------------

const withFetch = async (handler, run) => {
  const orig = global.fetch;
  global.fetch = handler;
  try {
    return await run();
  } finally {
    global.fetch = orig;
  }
};
const answer = (status, body) => ({ status, ok: status < 300, json: async () => body });

test("S1: a refund id Cashfree already holds is read back; when both calls fail the first error stands", async () => {
  const calls = [];
  const out = await withFetch(async (url, init = {}) => {
    calls.push(init.method || "GET");
    return init.method === "POST"
      ? answer(409, { message: "refund_id already exists" })
      : answer(200, { refund_id: url.split("/refunds/")[1], cf_refund_id: 9, refund_status: "SUCCESS", refund_amount: 500 });
  }, () => realCashfree.refundUnappliedPayment({ gw: GW, orderId: "tbl_A", amount: 500, note: "Table already settled" }));
  assert.deepEqual(calls, ["POST", "GET"]);
  assert.deepEqual(out, { refundId: ua("tbl_A"), cfRefundId: "9", status: "SUCCESS", amount: 500 });

  await assert.rejects(
    withFetch(async (url, init = {}) => (init.method === "POST" ? answer(409, { message: "refund_id already exists" }) : answer(404, { message: "not found" })),
      () => realCashfree.refundUnappliedPayment({ gw: GW, orderId: "tbl_A", amount: 500, note: "x" })),
    /refund_id already exists/,
  );
});

test("S2: an order opened with expiresAt carries Cashfree's IST expiry, and a 400 retries once without it", async () => {
  const sent = [];
  const open = (firstStatus) => withFetch(async (url, init) => {
    sent.push(JSON.parse(init.body));
    return sent.length === 1 && firstStatus === 400
      ? answer(400, { message: "order_expiry_time : invalid value" })
      : answer(200, { order_id: "web_x", payment_session_id: "ps", order_status: "ACTIVE" });
  }, () => realCashfree.createOrder({
    appId: "a", secretKey: "s", environment: "TEST", amount: 100, orderId: "web_x",
    customer: { phone: "9876543210" }, expiresAt: new Date("2026-10-14T10:00:00.000Z"),
  }));

  await open(200);
  assert.match(sent[0].order_expiry_time, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+05:30$/);
  assert.equal(sent[0].order_expiry_time, "2026-10-14T15:30:00+05:30");

  sent.length = 0;
  const order = await open(400);
  assert.equal(sent.length, 2, "retried once");
  assert.equal(sent[1].order_expiry_time, undefined);
  assert.equal(order.paymentSessionId, "ps");

  // Without an expiry a 400 is a real refusal: no retry.
  sent.length = 0;
  await assert.rejects(withFetch(async (url, init) => { sent.push(JSON.parse(init.body)); return answer(400, { message: "bad phone" }); },
    () => realCashfree.createOrder({ appId: "a", secretKey: "s", amount: 100, orderId: "web_x", customer: { phone: "9876543210" } })), /bad phone/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].order_expiry_time, undefined);
});

// ---------------------------------------------------------------------------
// Review fixes: concurrent Pay taps, atomic drops, cancelled refunds
// ---------------------------------------------------------------------------

test("REGRESSION N021a: two phones tapping Pay at once on a fresh table each mint an order, and both stay findable", async () => {
  const state = newState(tableSession());
  let arrived = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const fakes = {
    ...qrFakes(state),
    // Both requests read the table before either writes, as two phones a second apart do.
    "../services/orderCharge": { quotePlatformFee: async () => { if (++arrived === 2) release(); await gate; return null; } },
  };
  const [a, b] = await withRefundApi(state, () => withFakes(fakes, QR, async ({ paymentIntent }) => {
    const tap = async () => { const res = mkRes(); await paymentIntent(qrReq(), res, (e) => { throw e; }); return res.body.data.checkout; };
    return Promise.all([tap(), tap()]);
  }));
  assert.equal(state.opened.length, 2);
  assert.notEqual(a.gatewayOrderId, b.gatewayOrderId);
  assert.deepEqual([...state.session.payment.gatewayOrderIds].sort(), [a.gatewayOrderId, b.gatewayOrderId].sort(), "neither id was overwritten");

  // A phone pays the order the session no longer calls current: verify still finds it.
  const other = state.session.payment.gatewayOrderId === a.gatewayOrderId ? b : a;
  state.orders[other.gatewayOrderId].order_status = "PAID";
  const { res } = await callQr(state, "paymentVerify");
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(state.settled[0].gatewayOrderId, other.gatewayOrderId);
});

test("REGRESSION: a refund is recorded with an atomic write, so a table saved meanwhile cannot leave the refunded order listed", async () => {
  const versionClash = async () => { throw Object.assign(new Error("No matching document found for id s1 version 3"), { name: "VersionError" }); };
  const mk = () => newState(tableSession({ bills: { totalWithTax: 700 }, save: versionClash, payment: { ...tableSession().payment, gatewayOrderId: "tbl_X", gatewayOrderIds: ["tbl_E", "tbl_X"] } }), {
    tbl_E: { order_status: "PAID", order_amount: 500 },
  });
  const viaHook = mk();
  const res = await hook(viaHook, "tbl_E");
  assert.equal(res.body.refunded, true, JSON.stringify(res.body));
  assert.deepEqual(viaHook.session.payment.gatewayOrderIds, ["tbl_X"], "E can never settle the table later");
  assert.deepEqual(viaHook.session.payment.refundedOrderIds, ["tbl_E"]);

  // The bill goes back to 500: verify does not find E again.
  viaHook.session.bills.totalWithTax = 500;
  viaHook.orders.tbl_X = { order_status: "ACTIVE", order_amount: 700 };
  const { res: verify } = await callQr(viaHook, "paymentVerify");
  assert.equal(verify.code, 400);
  assert.deepEqual(viaHook.paidChecks.filter((id) => id === "tbl_E"), ["tbl_E"], "only the webhook's own check");
  assert.equal(viaHook.settled.length, 0);

  // A write that does fail after the refund answers 500: Cashfree retries under the same refund id.
  const failing = mk();
  failing.writeError = new Error("primary stepped down");
  const r2 = await hook(failing, "tbl_E");
  assert.equal(r2.code, 500);
  assert.equal(failing.refunds.length, 1);
});

test("REGRESSION S1: a refund Cashfree cancelled is not a refund: the payment stays on the table and the webhook retries", async () => {
  await assert.rejects(
    withFetch(async () => answer(200, { refund_id: "x", cf_refund_id: 9, refund_status: "CANCELLED", refund_amount: 500 }),
      () => realCashfree.refundUnappliedPayment({ gw: GW, orderId: "tbl_A", amount: 500, note: "x" })),
    /cancelled/i,
  );
  await assert.rejects(
    withFetch(async (url, init = {}) => (init.method === "POST" ? answer(409, { message: "refund_id already exists" }) : answer(200, { refund_status: "CANCELLED", refund_amount: 500 })),
      () => realCashfree.refundUnappliedPayment({ gw: GW, orderId: "tbl_A", amount: 500, note: "x" })),
    /cancelled/i,
    "a cancelled refund read back on a retry is not 'done' either",
  );

  const state = newState(tableSession({
    status: "CLOSED",
    payment: { method: "CASH", status: "PAID", gatewayProvider: "cashfree", gatewayOrderId: "tbl_A", gatewayOrderIds: [], platformFee: {} },
  }), { tbl_A: { order_status: "PAID", order_amount: 500 } });
  state.refundStatus = "CANCELLED";
  const res = await hook(state, "tbl_A");
  assert.equal(res.code, 500);
  assert.equal(state.session.payment.gatewayOrderId, "tbl_A", "kept for the retry");
  assert.deepEqual(state.session.timeline, [], "never noted as refunded");
});

test("REGRESSION: an unapplied refund Cashfree later cancels is logged and noted on the table, not ignored", async () => {
  const state = newState(tableSession({
    status: "CLOSED",
    payment: { method: "CASH", status: "PAID", gatewayProvider: "cashfree", gatewayOrderId: "", gatewayOrderIds: [], refundedOrderIds: ["tbl_A"], platformFee: {} },
  }));
  state.refundStatus = "CANCELLED";
  const body = { type: "REFUND_STATUS_WEBHOOK", data: { refund: { order_id: "tbl_A", refund_id: ua("tbl_A") } } };
  const req = { rawBody: Buffer.from(JSON.stringify(body)), body, headers: { "x-webhook-timestamp": "1", "x-webhook-signature": "x" } };
  const logged = [];
  const origError = console.error;
  console.error = (m) => logged.push(String(m));
  let res;
  try {
    res = await withRefundApi(state, () => withFakes(hookFakes(state), HOOK, async ({ cashfreeWebhook }) => {
      const r = mkRes();
      await cashfreeWebhook(req, r);
      return r;
    }));
  } finally {
    console.error = origError;
  }
  assert.equal(res.body.refund, "CANCELLED", JSON.stringify(res.body));
  assert.match(logged.join("\n"), /was CANCELLED: the customer has not been paid back/);
  assert.deepEqual(state.session.timeline.map((t) => t.event), ["ONLINE_REFUND_CANCELLED"]);
  assert.match(state.session.timeline[0].note, /cancelled by Cashfree: pay the diner back/);
});

test("REGRESSION N021b: a QR payment that lands after a payment link closed the table is refunded", async () => {
  const state = newState(tableSession({
    status: "CLOSED",
    payment: { method: "PAYMENT_LINK", status: "PAID", gatewayProvider: "cashfree", gatewayOrderId: "tbl_A", gatewayOrderIds: ["tbl_A"], platformFee: {} },
  }), { tbl_A: { order_status: "PAID", order_amount: 505 } });
  const res = await hook(state, "tbl_A");
  assert.equal(res.body.refunded, true, JSON.stringify(res.body));
  assert.deepEqual(state.refunds.map((r) => r.refund_amount), [505]);
});
