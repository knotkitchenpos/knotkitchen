process.env.RAZORPAY_KEY_ID = "rzp_test_key";
process.env.RAZORPAY_KEY_SECRET = "rzp_test_secret_at_least_32_chars_long__";
process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test_at_least_32_chars_long_______";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

/**
 * Regression tests for the payment bypasses found in the 2026-08-30 audit.
 *
 * Two public, unauthenticated endpoints marked money as received without
 * verifying anything, because in both cases the signature check was guarded by
 * operands the caller controls:
 *
 *   paymentLinkController.verifyAndCaptureLinkPayment
 *     if (config.razorpaySecretKey && razorpay_order_id && razorpay_payment_id)
 *     → omit the two body fields, skip verification, mark the bill paid.
 *
 *   paymentController.webHookVerification
 *     if (signature && !timingSafeEquals(expected, signature))
 *     → omit the x-razorpay-signature header, forged event treated as genuine.
 *
 * These tests assert the FORGERY IS REJECTED. They deliberately assert on
 * behaviour rather than on the shape of the guard, so a future refactor that
 * keeps the endpoint safe still passes.
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
  gatewayName: "RAZORPAY",
  gatewayOrderId: "order_LEGITIMATE123",
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
  startSession: async () => ({
    startTransaction() {},
    async commitTransaction() {},
    async abortTransaction() {},
    async endSession() {},
  }),
};

const mocks = {
  "../models/paymentLinkModel": PaymentLinkMock,
  "../models/paymentTransactionModel": PaymentTransactionMock,
  "../models/billModel": noopModel,
  "../models/orderModel": noopModel,
  "../models/tableSessionModel": noopModel,
  "../models/restaurantModel": noopModel,
  "../models/paymentModel": noopModel,
  "../services/messagingService": { sendPaymentLinkMessage: async () => {} },
  mongoose: mongooseMock,
};

// Load the REAL model + constants before mocking, for the enum test at the end.
const RealPaymentTransaction = require("../models/paymentTransactionModel");
const { normalizePaymentMethod, toOrderPaymentMethod } = require("../constants/paymentMethods");

// NOTE: the interception stays active for the whole file rather than being
// restored after the requires below. verifyAndCaptureLinkPayment calls
// `require("mongoose")` INSIDE the function body, so a mock installed only at
// load time would not apply and the controller would try to open a real
// transaction against a database this suite deliberately does not have.
let linkCtrl, payCtrl;
{
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (mocks[r]) return mocks[r];
    return orig.apply(this, arguments);
  };
  linkCtrl = require("../controllers/paymentLinkController");
  payCtrl = require("../controllers/paymentController");
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
// CRITICAL 1 — public capture endpoint
// ---------------------------------------------------------------------------

test("CRITICAL: an empty body cannot settle a payment link", async () => {
  resetState();
  const { err } = await run(linkCtrl.verifyAndCaptureLinkPayment, {
    params: { token: LINK.linkToken },
    body: {},
  });

  assert.ok(err, "the request must be rejected");
  assert.equal(err.status ?? err.statusCode, 400);
  assert.notEqual(LINK.status, "PAID", "the link must NOT be marked paid");
  assert.equal(writes.transactions.length, 0, "no PAID ledger row may be written");
});

test("CRITICAL: choosing a valid enum method does not bypass verification", async () => {
  // The original exploit: `method` had to be an enum member for the write to
  // succeed, so the attacker sent UPI. Verification, not the enum, is the control.
  resetState();
  const { err } = await run(linkCtrl.verifyAndCaptureLinkPayment, {
    params: { token: LINK.linkToken },
    body: { paymentMethod: "UPI" },
  });

  assert.ok(err, "the request must be rejected");
  assert.notEqual(LINK.status, "PAID");
  assert.equal(writes.transactions.length, 0);
});

test("CRITICAL: a forged signature is rejected", async () => {
  resetState();
  const { err } = await run(linkCtrl.verifyAndCaptureLinkPayment, {
    params: { token: LINK.linkToken },
    body: {
      razorpay_order_id: LINK.gatewayOrderId,
      razorpay_payment_id: "pay_FORGED",
      razorpay_signature: "0".repeat(64),
    },
  });

  assert.ok(err, "the request must be rejected");
  assert.notEqual(LINK.status, "PAID");
  assert.equal(writes.transactions.length, 0);
});

test("a valid signature for a DIFFERENT order cannot settle this link", async () => {
  // Signature is genuine, but was issued for another Razorpay order on the same
  // account. Without binding to link.gatewayOrderId it would settle this link.
  resetState();
  const otherOrder = "order_SOMEONEELSE999";
  const signature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${otherOrder}|pay_REAL`)
    .digest("hex");

  const { err } = await run(linkCtrl.verifyAndCaptureLinkPayment, {
    params: { token: LINK.linkToken },
    body: {
      razorpay_order_id: otherOrder,
      razorpay_payment_id: "pay_REAL",
      razorpay_signature: signature,
    },
  });

  assert.ok(err, "a signature bound to another order must be rejected");
  assert.notEqual(LINK.status, "PAID");
  assert.equal(writes.transactions.length, 0);
});

// ---------------------------------------------------------------------------
// CRITICAL 2 — webhook signature bypasses
// ---------------------------------------------------------------------------

const webhookBody = {
  event: "payment.captured",
  payload: { payment: { entity: { id: "pay_FORGED", order_id: "order_LEGITIMATE123", amount: 200000, currency: "INR", status: "captured", method: "card", created_at: 1700000000 } } },
};

test("CRITICAL: a webhook with NO signature header is rejected", async () => {
  const raw = Buffer.from(JSON.stringify(webhookBody));
  const { err } = await run(payCtrl.webHookVerification, {
    headers: {},              // no x-razorpay-signature
    body: webhookBody,
    rawBody: raw,
  });

  assert.ok(err, "an unsigned webhook must be rejected");
  assert.equal(err.status ?? err.statusCode, 400);
});

test("CRITICAL: a webhook with a wrong signature is rejected", async () => {
  const raw = Buffer.from(JSON.stringify(webhookBody));
  const { err } = await run(payCtrl.webHookVerification, {
    headers: { "x-razorpay-signature": "0".repeat(64) },
    body: webhookBody,
    rawBody: raw,
  });

  assert.ok(err, "a mis-signed webhook must be rejected");
});

test("CRITICAL: a forged Cashfree-shaped webhook does not settle anything", async () => {
  resetState();
  const body = {
    type: "PAYMENT_SUCCESS_WEBHOOK",
    data: { order: { order_id: "order_LEGITIMATE123", order_amount: 2000 }, payment: { cf_payment_id: "cf_FORGED", payment_amount: 2000 } },
  };
  const { res, err } = await run(payCtrl.webHookVerification, {
    headers: {},
    body,
    rawBody: Buffer.from(JSON.stringify(body)),
  });

  // Acknowledged so the provider stops retrying, but inert.
  assert.equal(err, null);
  assert.equal(res.body?.skipped, true, "the payload must be ignored, not acted on");
  assert.equal(writes.transactions.length, 0, "no ledger row may be written");
  assert.notEqual(LINK.status, "PAID");
});

test("a correctly signed webhook passes verification", async () => {
  // The positive control: without it, the tests above would pass even if the
  // endpoint rejected everything unconditionally.
  const raw = Buffer.from(JSON.stringify(webhookBody));
  const signature = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(raw.toString("utf8"))
    .digest("hex");

  const { err } = await run(payCtrl.webHookVerification, {
    headers: { "x-razorpay-signature": signature },
    body: webhookBody,
    rawBody: raw,
  });

  assert.equal(err, null, "a genuine webhook must be accepted");
});

test("signature is verified against RAW bytes, not a re-serialisation", async () => {
  // A body whose raw form differs from JSON.stringify(parsed) — here by
  // whitespace. Signing the raw bytes must still verify; the old
  // JSON.stringify(req.body) approach would compute a different digest and
  // reject this genuine webhook.
  const rawText = JSON.stringify(webhookBody, null, 1); // pretty-printed on the wire
  const raw = Buffer.from(rawText);
  const signature = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawText)
    .digest("hex");

  const { err } = await run(payCtrl.webHookVerification, {
    headers: { "x-razorpay-signature": signature },
    body: JSON.parse(rawText),
    rawBody: raw,
  });

  assert.equal(err, null, "raw-body signing must verify regardless of formatting");
});

// ---------------------------------------------------------------------------
// HIGH — the enum mismatch that broke genuine payments
// ---------------------------------------------------------------------------

test("payment methods normalise to values the model actually accepts", () => {
  // Uses the REAL model captured before the mocks were installed.
  const PaymentTransaction = RealPaymentTransaction;

  // Every value the real flows produce must survive model validation.
  for (const raw of ["RAZORPAY", "netbanking", "card", "upi", "wallet", "emi", "CASHFREE", ""]) {
    const doc = new PaymentTransaction({
      restaurantId: "507f1f77bcf86cd799439011",
      method: normalizePaymentMethod(raw),
      amount: 100,
      status: "PAID",
    });
    const err = doc.validateSync();
    assert.equal(err?.errors?.method, undefined, `method "${raw}" must normalise to a valid enum value`);
  }

  // And the Order sub-document enum, which is narrower and lower-case.
  const ORDER_ENUM = ["cash", "card", "upi", "wallet", "online", "split"];
  for (const raw of ["RAZORPAY", "netbanking", "QR_CODE", "PAYMENT_LINK", "emi", ""]) {
    assert.ok(
      ORDER_ENUM.includes(toOrderPaymentMethod(raw)),
      `order method for "${raw}" must be a valid Order.payments enum value`
    );
  }
});
