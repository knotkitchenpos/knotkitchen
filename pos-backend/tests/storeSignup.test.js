process.env.ALLOW_DEV_OTP = "true";
process.env.OTP_DEV_CODE = "123456";
const { test } = require("node:test");
const assert = require("node:assert/strict");

// Mock Data
const stores = {
  "483921": {
    _id: "store_01",
    storeId: "483921",
    storeName: "Demo Takeaway 01",
    ownerName: "Demo Owner 01",
    ownerPhone: "9876543210",
    status: "pending",
    isDeleted: false,
    save: async function () { return this; },
  },
};

const StoreMock = function (d) { return { ...d, _id: "store_new", save: async function () { return this; } }; };
StoreMock.findOne = async (q) => {
  if (q.storeId) return stores[q.storeId] || null;
  if (q.storeName) {
    return Object.values(stores).find((s) => s.storeName === q.storeName && !s.isDeleted) || null;
  }
  if (q.ownerPhone) {
    return Object.values(stores).find((s) => s.ownerPhone === q.ownerPhone && !s.isDeleted) || null;
  }
  return null;
};
StoreMock.exists = async (q) => Boolean(await StoreMock.findOne(q));
StoreMock.create = async (d) => {
  const store = { ...d, _id: "store_" + d.storeId, isDeleted: false, save: async function () { return this; } };
  stores[d.storeId] = store;
  return store;
};

const otps = {};
const OtpServiceMock = {
  createAndSendOtp: async ({ storeId, phone, purpose }) => {
    otps[`${storeId}_${phone}`] = "123456";
    return { otp: "123456" };
  },
  maskPhone: (p) => String(p || "").slice(0, 2) + "****" + String(p || "").slice(-2),
  verifyOtp: async ({ storeId, phone, otp }) => {
    const key = `${storeId}_${phone}`;
    if (otps[key] && otps[key] === String(otp).trim()) {
      return { valid: true };
    }
    return { valid: false, message: "Invalid or expired OTP." };
  },
};

const UserMock = {
  findOne: async () => null,
  create: async (d) => ({
    ...d,
    _id: "user_new",
    save: async function () { return this; },
    toSafeJSON: () => ({ _id: "user_new", name: d.name, phone: d.phone }),
  }),
  save: async function () { return this; },
};

// Restaurants are looked up by storeId as well as by id, and the controllers
// call .save() on whatever comes back, so the mock has to behave like a document.
const restaurants = {};
const RestaurantMock = {
  create: async (d) => {
    const restaurant = {
      ...d,
      _id: d._id || "rest_" + (d.storeId || "new"),
      save: async function () { return this; },
    };
    if (d.storeId) restaurants[d.storeId] = restaurant;
    return restaurant;
  },
  findOne: async (q = {}) => {
    if (q.storeId) return restaurants[q.storeId] || null;
    if (q._id) return Object.values(restaurants).find((r) => r._id === q._id) || null;
    return null;
  },
  findById: async (id) => Object.values(restaurants).find((r) => r._id === id) || null,
};


const mocks = {
  "../models/storeModel": StoreMock,
  "../models/userModel": UserMock,
  "../models/restaurantModel": RestaurantMock,
  "../services/otpService": OtpServiceMock,
  "bcrypt": { hash: async () => "hashedpass" },
  "jsonwebtoken": { sign: () => "mocktoken" },
  "../config/config": { accessTokenSecret: "sec", refreshTokenSecret: "ref", accessTokenExpiry: "15m", refreshTokenExpiry: "30d" },
  "../models/auditLogModel": { create: async () => ({}) },
};

let adminCtrl, userCtrl;
{
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (mocks[r]) return mocks[r];
    return orig.apply(this, arguments);
  };
  adminCtrl = require("../../knotkitchen-admin/backend/controllers/restaurantController");
  userCtrl = require("../controllers/userController");
  Module._load = orig;
}

const req = (body, extra = {}) => ({ body, cookies: {}, ip: "127.0.0.1", get: () => "", ...extra });
const res = () => {
  const r = {
    statusCode: 200,
    _j: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this._j = o; return this; },
    cookie() { return this; },
    clearCookie() { return this; },
  };
  return r;
};

const call = async (fn, body, extra) => {
  const r = res();
  let err = null;
  await fn(req(body, extra), r, (e) => { err = e; });
  return { r, err };
};

// Admin: Store Creation
// Store creation is OTP-authenticated: the admin first calls sendStoreCreationOtp
// and then passes the code to createStore. "123456" is the accepted demo code.
const DEMO_OTP = "123456";

test("Admin Store Creation: generates 6-digit Store ID and saves store", async () => {
  const { r, err } = await call(adminCtrl.createStore, {
    storeName: "Demo Takeaway 03",
    ownerName: "Owner 03",
    ownerPhone: "9876543212",
    otp: DEMO_OTP,
  });
  assert.ifError(err);
  assert.equal(r.statusCode, 201);
  assert.equal(r._j.success, true);
  assert.match(r._j.data.storeId, /^\d{6}$/);
  assert.equal(r._j.data.storeName, "Demo Takeaway 03");
});

test("Admin Store Creation: requires an OTP", async () => {
  const { err } = await call(adminCtrl.createStore, {
    storeName: "No OTP Store",
    ownerName: "Owner",
    ownerPhone: "9876543298",
  });
  assert.equal(err.status, 400);
  assert.match(err.message, /OTP/i);
});

test("Admin Store Creation: rejects an incorrect OTP", async () => {
  const { err } = await call(adminCtrl.createStore, {
    storeName: "Wrong OTP Store",
    ownerName: "Owner",
    ownerPhone: "9876543297",
    otp: "000000",
  });
  assert.equal(err.status, 400);
  assert.match(err.message, /Invalid or expired OTP/i);
});

test("Admin Store Creation: rejects duplicate store name", async () => {
  const { err } = await call(adminCtrl.createStore, {
    storeName: "Demo Takeaway 01",
    ownerName: "Owner Unique",
    ownerPhone: "9876543299",
    otp: DEMO_OTP,
  });
  assert.equal(err.status, 400);
  assert.match(err.message, /already exists/i);
});

test("Admin Store Creation: rejects duplicate owner phone", async () => {
  const { r, err } = await call(adminCtrl.sendStoreCreationOtp, {
    storeName: "Unique Name",
    ownerName: "Owner Unique",
    ownerPhone: "9876543210",
  });
  assert.equal(err.status, 400);
  assert.match(err.message, /already associated with another store/i);
});


// EPOS Phone Signup: Step 1 Validate Store ID
test("Store Signup: Validate Store ID fails with invalid ID", async () => {
  const { err } = await call(userCtrl.validateStoreId, { storeId: "000000" });
  assert.equal(err.status, 404);
  assert.match(err.message, /Invalid Store ID/i);
});

test("Store Signup: Validate Store ID succeeds with valid ID", async () => {
  const { r, err } = await call(userCtrl.validateStoreId, { storeId: "483921" });
  assert.ifError(err);
  assert.equal(r.statusCode, 200);
  assert.equal(r._j.data.storeName, "Demo Takeaway 01");
});

// EPOS Phone Signup: Step 2 Validate Owner Phone
test("Store Signup: Validate Owner fails when phone does not match", async () => {
  const { err } = await call(userCtrl.validateStoreOwner, { storeId: "483921", phone: "1111111111" });
  assert.equal(err.status, 400);
  assert.match(err.message, /Phone number does not match/i);
});

test("Store Signup: Validate Owner succeeds when phone matches", async () => {
  const { r, err } = await call(userCtrl.validateStoreOwner, { storeId: "483921", phone: "9876543210" });
  assert.ifError(err);
  assert.equal(r.statusCode, 200);
  assert.equal(r._j.data.ownerName, "Demo Owner 01");
});

// EPOS Phone Signup: Step 3 Send & Verify OTP
test("Store Signup: Send OTP & verify wrong OTP fails", async () => {
  await call(userCtrl.sendStoreOtp, { storeId: "483921", phone: "9876543210" });
  const { err } = await call(userCtrl.verifyStoreOtp, { storeId: "483921", phone: "9876543210", otp: "000000" });
  assert.equal(err.status, 400);
  assert.match(err.message, /Invalid or expired OTP/i);
});

test("Store Signup: Send OTP & complete signup with correct OTP succeeds", async () => {
  await call(userCtrl.sendStoreOtp, { storeId: "483921", phone: "9876543210" });
  const { r, err } = await call(userCtrl.completeStoreSignup, {
    storeId: "483921",
    phone: "9876543210",
    otp: "123456",
    password: "password123",
  });
  assert.ifError(err);
  assert.equal(r.statusCode, 201);
  assert.equal(r._j.success, true);
});
