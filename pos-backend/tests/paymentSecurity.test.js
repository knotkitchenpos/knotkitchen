process.env.CASHFREE_APP_ID = "cf_test_app_id";
process.env.CASHFREE_SECRET_KEY = "cf_test_secret_at_least_32_chars_long___";
process.env.CASHFREE_ENV = "TEST";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

/**
 * Regression tests for the payment bypasses found in the 2026-08-30 audit,
 * carried forward to Cashfree.
 *
 * Two public, unauthenticated endpoints marked money as received without
 * verifying anything, because in both cases the check was guarded by operands
 * the CALLER controls:
 *
 *   the link capture endpoint
 *     if (secret && order_id && payment_id)  <- two of three from req.body
 *     -> omit the body fields, skip verification, mark the bill paid.
 *
 *   the gateway webhook
 *     if (signature && !equals(expected, signature))
 *     -> omit the signature header, forged event treated as genuine.
 *
 * Cashfree closes the first class of bug by construction: there is nothing in
 * the request for a caller to omit. The order id is read from OUR record and
 * the status is read from the gateway. These tests assert the FORGERY IS
 * REJECTED, on behaviour rather than on the shape of any guard, so a refactor
 * that keeps the endpoint safe still passes.
 */

// ---------------------------------------------------------------------------
// Test doubles. The controllers are loaded with mocked models so no database is
// required — same Module._load interception the other suites use.
// ---------------------------------------------------------------------------

const LINK = {
  _id: "link_1",
  restaurantId: "rest_1",
  linkToken: "a".repeat(64),
  amount: 2000,
  currency: "INR",
  status: "ACTIVE",
  gatewayName: "CASHFREE",
  gatewayOrderId: "lnk_LEGITIMATE123",
  billId: null,
  orderId: null,
  tableSessionId: null,
  expiresAt: new Date(Date.now() + 3600_000),
  save: async function () { return this; },
};

/** Records every write the controller attempts, so we can assert none happened. */
const writes = { transactions: [], linkSaves: 0 };

const resetState = () => {
  writes.transactions.length = 0;
  writes.linkSaves = 0;
  LINK.status = "ACTIVE";
  LINK.gatewayName = "CASHFREE";
  LINK.gatewayOrderId = "lnk_LEGITIMATE123";
};

const PaymentLinkMock = {
  findOne: () => {
    const q = {
      session: () => Promise.resolve(LINK),
      populate() { return this; },
      then: (r) => r(LINK),
    };
    return q;
  },
  findOneAndUpdate: async () => null,
};

const PaymentTransactionMock = {
  findOne: () => ({ session: () => Promise.resolve(null) }),
  create: async (docs) => {
    writes.transactions.push(...(Array.isArray(docs) ? docs : [docs]));
    return Array.isArray(docs) ? docs : [docs];
  },
};

const noopModel = {
  findOne: () => ({ session: () => Promise.resolve(null), populate() { return this; } }),
  findOneAndUpdate: async () => null,
  create: async (d) => d,
};

const mongooseMock = {
  Types: { ObjectId: { isValid: () => true } },
  connection: { readyState: 0 },
  startSession: async () => ({
    startTransaction() {},
    async commitTransaction() {},
    async abortTransaction() {},
    async endSession() {},
  }),
};

/**
 * The gateway, stubbed. `paid` decides what Cashfree "says" about the order —
 * the whole point being that this, and not anything in the request, is what
 * settles a link.
 */
const cashfreeStub = {
  paid: false,
  amount: 2000,
  calls: [],
  isOrderPaid: async ({ orderId }) => {
    cashfreeStub.calls.push(orderId);
    return {
      paid: cashfreeStub.paid,
      orderStatus: cashfreeStub.paid ? "PAID" : "ACTIVE",
      amount: cashfreeStub.amount,
      cfOrderId: `cf_${orderId}`,
    };
  },
  createOrder: async () => ({ orderId: "lnk_NEW", paymentSessionId: "sess_x" }),
  verifyWebhook: (args) => realCashfree.verifyWebhook(args),
};

const realCashfree = require("../services/gateways/cashfree");

const mocks = {
  "../models/paymentLinkModel": PaymentLinkMock,
  "../models/paymentTransactionModel": PaymentTransactionMock,
  "../models/billModel": noopModel,
  "../models/orderModel": noopModel,
  "../models/tableSessionModel": noopModel,
  "../models/restaurantModel": noopModel,
  "../models/paymentModel": noopModel,
  "../services/messagingService": { sendPaymentLinkMessage: async () => {} },
  "../services/gateways/cashfree": cashfreeStub,
  mongoose: mongooseMock,
};

// Load the REAL model + constants before mocking, for the enum test at the end.
const RealPaymentTransaction = require("../models/paymentTransactionModel");
const RealOrder = require("../models/orderModel");
const { normalizePaymentMethod, toOrderPaymentMethod } = require("../constants/paymentMethods");

// NOTE: the interception stays active for the whole file rather than being
// restored after the requires below. The capture handler calls
// `require("mongoose")` INSIDE the function body, so a mock installed only at
// load time would not apply and it would try to open a real transaction
// against a database this suite deliberately does not have.
let linkCtrl, hookCtrl;
{
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (mocks[r]) return mocks[r];
    return orig.apply(this, arguments);
  };
  linkCtrl = require("../controllers/paymentLinkController");
  hookCtrl = require("../controllers/cashfreeWebhookController");
}

const mkRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

/** Runs a controller and returns { res, err } — err is whatever next() received. */
const run = async (handler, req) => {
  const res = mkRes();
  let err = null;
  await handler(req, res, (e) => { err = e; });
  return { res, err };
};

// ---------------------------------------------------------------------------
// CRITICAL 1 — the public capture endpoint
// ---------------------------------------------------------------------------

test("CRITICAL: an empty body cannot settle a payment link", async () => {
  resetState();
  cashfreeStub.paid = false;

  const { err } = await run(linkCtrl.verifyAndCaptureLinkPayment, {
    params: { token: LINK.linkToken },
    body: {},
  });

  assert.ok(err, "must refuse");
  assert.equal(LINK.status, "ACTIVE", "the link must not be marked paid");
  assert.equal(writes.transactions.length, 0, "no ledger entry may be written");
});

test("CRITICAL: choosing a valid enum method does not bypass verification", async () => {
  // The original bypass: `{"paymentMethod":"UPI"}` settled any bill for free,
  // because naming a method skipped straight past the guard.
  resetState();
  cashfreeStub.paid = false;

  const { err } = await run(linkCtrl.verifyAndCaptureLinkPayment, {
    params: { token: LINK.linkToken },
    body: { paymentMethod: "UPI" },
  });

  assert.ok(err, "must refuse");
  assert.equal(LINK.status, "ACTIVE");
  assert.equal(writes.transactions.length, 0);
});

test("CRITICAL: the caller cannot name the order that gets checked", async () => {
  // Cashfree closes this class by construction — the order id comes from the
  // LINK. A caller pointing at some other paid order on the same merchant
  // account must not settle this one.
  resetState();
  cashfreeStub.paid = true;
  cashfreeStub.calls.length = 0;

  await run(linkCtrl.verifyAndCaptureLinkPayment, {
    params: { token: LINK.linkToken },
    body: {
      gatewayOrderId: "lnk_SOMEONE_ELSES",
      order_id: "lnk_SOMEONE_ELSES",
      cf_order_id: "lnk_SOMEONE_ELSES",
    },
  });

  assert.ok(cashfreeStub.calls.length > 0, "the gateway must be consulted");
  for (const asked of cashfreeStub.calls) {
    assert.equal(asked, LINK.gatewayOrderId, "only ever OUR order id");
  }
});

test("an order the gateway reports as unpaid does not settle the link", async () => {
  resetState();
  cashfreeStub.paid = false;

  const { err } = await run(linkCtrl.verifyAndCaptureLinkPayment, {
    params: { token: LINK.linkToken },
    body: {},
  });

  assert.ok(err);
  assert.match(String(err.message), /not completed|unavailable/i);
  assert.equal(writes.transactions.length, 0);
});

test("an underpayment does not settle the link", async () => {
  // The link amount was locked from the order's own bill at creation.
  resetState();
  cashfreeStub.paid = true;
  cashfreeStub.amount = 1;

  const { err } = await run(linkCtrl.verifyAndCaptureLinkPayment, {
    params: { token: LINK.linkToken },
    body: {},
  });

  cashfreeStub.amount = 2000;
  assert.ok(err, "an amount mismatch must refuse");
  assert.equal(writes.transactions.length, 0);
});

test("a link opened against an unintegrated gateway is refused, not guessed at", async () => {
  resetState();
  LINK.gatewayName = "PHONEPE";
  cashfreeStub.paid = true;

  const { err } = await run(linkCtrl.verifyAndCaptureLinkPayment, {
    params: { token: LINK.linkToken },
    body: {},
  });

  assert.ok(err);
  assert.equal(err.status, 501);
  assert.equal(writes.transactions.length, 0);
});

// ---------------------------------------------------------------------------
// CRITICAL 2 — the public webhook
// ---------------------------------------------------------------------------

const hookReq = ({ body, signature, timestamp = "1725500000" }) => {
  const raw = JSON.stringify(body);
  return {
    body,
    rawBody: Buffer.from(raw, "utf8"),
    headers: {
      ...(signature === undefined ? {} : { "x-webhook-signature": signature }),
      "x-webhook-timestamp": timestamp,
    },
  };
};

const signFor = (raw, timestamp, secret) =>
  crypto.createHmac("sha256", secret).update(`${timestamp}${raw}`).digest("base64");

test("CRITICAL: a webhook with NO signature header settles nothing", async () => {
  resetState();
  const body = { type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: LINK.gatewayOrderId } } };
  const { res } = await run(hookCtrl.cashfreeWebhook, hookReq({ body, signature: undefined }));

  // Acknowledged so the provider stops retrying — but nothing happened.
  assert.equal(res.statusCode, 200);
  assert.notEqual(res.body?.settled, "link");
  assert.equal(writes.transactions.length, 0);
  assert.equal(LINK.status, "ACTIVE");
});

test("CRITICAL: a webhook with a wrong signature settles nothing", async () => {
  resetState();
  const body = { type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: LINK.gatewayOrderId } } };
  const { res } = await run(hookCtrl.cashfreeWebhook, hookReq({ body, signature: "d3Jvbmctc2lnbmF0dXJl" }));

  assert.equal(res.statusCode, 401, "a bad signature is worth refusing outright");
  assert.equal(writes.transactions.length, 0);
  assert.equal(LINK.status, "ACTIVE");
});

test("CRITICAL: a forged event for an order we never opened settles nothing", async () => {
  resetState();
  const body = { type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: "lnk_NEVER_EXISTED" } } };
  const raw = JSON.stringify(body);
  const req = hookReq({ body });
  req.headers["x-webhook-signature"] = signFor(raw, "1725500000", process.env.CASHFREE_SECRET_KEY);

  const { res } = await run(hookCtrl.cashfreeWebhook, req);
  assert.equal(res.statusCode, 200);
  assert.notEqual(res.body?.settled, "link");
  assert.equal(writes.transactions.length, 0);
});

test("signature is verified against RAW bytes, not a re-serialisation", () => {
  // Key order and whitespace are not preserved by JSON.parse + stringify, so a
  // re-serialised body only matches by luck. Any non-ASCII character in a
  // customer name would break genuine webhooks with no code change.
  const secret = "some_secret";
  const raw = '{"b":1,"a":"Ravi\\u00a0Kumar"}';
  const ts = "1725500000";
  const good = signFor(raw, ts, secret);

  assert.equal(
    realCashfree.verifyWebhook({ rawBody: raw, timestamp: ts, signature: good, secretKey: secret }),
    true,
  );
  const reserialised = JSON.stringify(JSON.parse(raw));
  assert.notEqual(reserialised, raw, "the re-serialisation genuinely differs");
  assert.equal(
    realCashfree.verifyWebhook({
      rawBody: reserialised,
      timestamp: ts,
      signature: good,
      secretKey: secret,
    }),
    false,
  );
});

// ---------------------------------------------------------------------------
// The enum that used to abort every genuine capture
// ---------------------------------------------------------------------------

test("payment methods normalise to values the model actually accepts", () => {
  const allowed = RealPaymentTransaction.schema.path("method").enumValues;
  for (const raw of ["ONLINE", "netbanking", "card", "upi", "wallet", "emi", "", undefined]) {
    const normalised = normalizePaymentMethod(raw);
    assert.ok(
      allowed.includes(normalised),
      `normalizePaymentMethod(${JSON.stringify(raw)}) -> ${normalised}, not in ${allowed.join("|")}`,
    );
  }

  // The REAL model, captured before the mocks went in -- requiring it here
  // would hand back the noop double and assert nothing.
  const orderAllowed = RealOrder.schema.path("payments").schema.path("method").enumValues;
  for (const raw of ["ONLINE", "netbanking", "card", "upi", "emi"]) {
    assert.ok(
      orderAllowed.includes(toOrderPaymentMethod(raw)),
      `toOrderPaymentMethod(${raw}) must be one of ${orderAllowed.join("|")}`,
    );
  }
});
