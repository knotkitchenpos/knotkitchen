/**
 * storeAvailability.test.js
 *
 * Regression tests for two bugs found during the code audit:
 *
 * 1. The admin portal can close a store temporarily, close it until a date, or
 *    delete it, but the POS only ever rejected "suspended". Closed stores could
 *    therefore still be logged into.
 *
 * 2. otpService.verifyOtp resolved to a bare `true`, while the controllers check
 *    `result.valid`. That made `undefined` falsy, so a CORRECT OTP was rejected.
 */

process.env.ALLOW_DEV_OTP = "true";
process.env.OTP_DEV_CODE = "123456";
const { test } = require("node:test");
const assert = require("node:assert/strict");

// ---------------- Mocks ----------------

const stores = {};
const makeStore = (storeId, overrides = {}) => {
  stores[storeId] = {
    _id: "store_" + storeId,
    storeId,
    storeName: "Test Store " + storeId,
    ownerName: "Test Owner",
    ownerPhone: "9876543210",
    status: "active",
    isDeleted: false,
    save: async function () { return this; },
    ...overrides,
  };
  return stores[storeId];
};

const StoreMock = {
  findOne: async (q = {}) => (q.storeId ? stores[q.storeId] || null : null),
  create: async (d) => makeStore(d.storeId, d),
};

const RestaurantMock = {
  findOne: async () => null,
  findById: async () => null,
  create: async (d) => ({ ...d, _id: "rest_new", save: async function () { return this; } }),
};

const UserMock = {
  findOne: async () => null,
  create: async (d) => ({
    ...d,
    _id: "user_new",
    save: async function () { return this; },
    toSafeJSON: () => ({ _id: "user_new", name: d.name, phone: d.phone }),
  }),
};


// Mirrors the real service contract: always { valid, message }.
const OtpServiceMock = {
  maskPhone: (p) => String(p || "").slice(0, 2) + "****" + String(p || "").slice(-2),
  createAndSendOtp: async () => ({ otp: "123456" }),
  verifyOtp: async ({ otp }) =>
    String(otp) === "999999"
      ? { valid: true }
      : { valid: false, message: "Invalid OTP." },
};

const mocks = {
  "../models/storeModel": StoreMock,
  "../models/restaurantModel": RestaurantMock,
  "../models/userModel": UserMock,
  "../services/otpService": OtpServiceMock,
  "bcrypt": { hash: async () => "hashed" },
  "jsonwebtoken": { sign: () => "token" },
  "../models/auditLogModel": { create: async () => ({}) },
};

let userCtrl;
{
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (mocks[r]) return mocks[r];
    return orig.apply(this, arguments);
  };
  userCtrl = require("../controllers/userController");
  Module._load = orig;
}

const call = async (fn, body) => {
  const res = {
    statusCode: 200,
    _j: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this._j = o; return this; },
    cookie() { return this; },
    clearCookie() { return this; },
  };
  let err = null;
  await fn({ body, cookies: {}, ip: "127.0.0.1", get: () => "" }, res, (e) => { err = e; });
  return { res, err };
};

// ---------------- Store availability ----------------

test("an active store passes validation", async () => {
  makeStore("100001", { status: "active" });
  const { res, err } = await call(userCtrl.validateStoreId, { storeId: "100001" });
  assert.ifError(err);
  assert.equal(res.statusCode, 200);
  assert.equal(res._j.success, true);
});

test("a pending store still passes validation (it has not been closed)", async () => {
  makeStore("100002", { status: "pending" });
  const { err } = await call(userCtrl.validateStoreId, { storeId: "100002" });
  assert.ifError(err);
});

test("a suspended store is rejected", async () => {
  makeStore("100003", { status: "suspended" });
  const { err } = await call(userCtrl.validateStoreId, { storeId: "100003" });
  assert.equal(err.status, 400);
  assert.match(err.message, /inactive/i);
});

test("a temporarily closed store is rejected", async () => {
  makeStore("100004", { status: "closed_temporarily", closureReason: "Staff training day" });
  const { err } = await call(userCtrl.validateStoreId, { storeId: "100004" });
  assert.equal(err.status, 400);
  assert.match(err.message, /temporarily closed/i);
  assert.match(err.message, /Staff training day/, "the admin's reason should reach the operator");
});

test("a store closed until a future date is rejected", async () => {
  makeStore("100005", {
    status: "closed_until",
    closedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  const { err } = await call(userCtrl.validateStoreId, { storeId: "100005" });
  assert.equal(err.status, 400);
  assert.match(err.message, /closed until/i);
});

test("a store whose closure date has passed is allowed back in", async () => {
  makeStore("100006", {
    status: "closed_until",
    closedUntil: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });
  const { err } = await call(userCtrl.validateStoreId, { storeId: "100006" });
  assert.ifError(err, "an expired closure should not keep the store shut");
});

test("a deleted store is rejected", async () => {
  makeStore("100007", { status: "deleted" });
  const { err } = await call(userCtrl.validateStoreId, { storeId: "100007" });
  assert.equal(err.status, 400);
  assert.match(err.message, /no longer available/i);
});

test("closure is enforced on every store entry point, not just validate-id", async () => {
  makeStore("100008", { status: "closed_temporarily" });

  const owner = await call(userCtrl.validateStoreOwner, {
    storeId: "100008",
    phone: "9876543210",
  });
  assert.equal(owner.err?.status, 400, "validateStoreOwner must reject a closed store");

  const otp = await call(userCtrl.sendStoreOtp, {
    storeId: "100008",
    phone: "9876543210",
  });
  assert.equal(otp.err?.status, 400, "sendStoreOtp must reject a closed store");

  const verify = await call(userCtrl.verifyStoreOtp, {
    storeId: "100008",
    phone: "9876543210",
    otp: "123456",
  });
  assert.equal(verify.err?.status, 400, "verifyStoreOtp must reject a closed store");
});

// ---------------- OTP contract ----------------

test("a correct OTP is accepted (verifyOtp returns { valid })", async () => {
  makeStore("100009", { status: "active" });

  // 999999 is the only code the mocked service treats as correct, so this
  // exercises the real service contract rather than the demo-code shortcut.
  const { err } = await call(userCtrl.completeStoreSignup, {
    storeId: "100009",
    phone: "9876543210",
    otp: "999999",
    password: "password123",
  });

  assert.ifError(err, "a valid OTP must not be rejected");
});

test("an incorrect OTP is still rejected", async () => {
  makeStore("100010", { status: "active" });
  const { err } = await call(userCtrl.completeStoreSignup, {
    storeId: "100010",
    phone: "9876543210",
    otp: "111111",
    password: "password123",
  });

  assert.equal(err.status, 400);
  assert.match(err.message, /Invalid OTP/i);
});

test("the demo OTP keeps working for both signup paths", async () => {
  makeStore("100011", { status: "active" });

  const signup = await call(userCtrl.completeStoreSignup, {
    storeId: "100011",
    phone: "9876543210",
    otp: "123456",
    password: "password123",
  });
  assert.ifError(signup.err);

  const verify = await call(userCtrl.verifyStoreOtp, {
    storeId: "100011",
    phone: "9876543210",
    otp: "123456",
  });
  assert.ifError(verify.err);
});

// ---------------- Shared store status enum ----------------

test("the POS store model accepts every status the admin portal writes", () => {
  // Loaded directly (not through the mock) to read the real schema.
  const RealStore = require("../models/storeModel");
  const allowed = RealStore.schema.path("status").enumValues;

  ["pending", "active", "suspended", "closed_temporarily", "closed_until", "deleted"].forEach(
    (status) => {
      assert.ok(
        allowed.includes(status),
        `the POS Store model must accept "${status}" - the admin portal writes it to the same collection`
      );
    }
  );
});
