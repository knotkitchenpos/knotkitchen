// Product ID auth tests
const { test } = require("node:test");
const assert = require("node:assert/strict");

const saveSig = async function () { return this; };
const products = {
  "KK-TEST-001": { _id: "p1", productId: "KK-TEST-001", status: "ACTIVE", isActive: true, allowsRegistration: true, isAssigned: false, save: saveSig, toObject: () => ({}) },
  "KK-INACTIVE": { _id: "p2", productId: "KK-INACTIVE", status: "INACTIVE", isActive: false, allowsRegistration: true, save: saveSig, toObject: () => ({}) },
  "KK-NOREG": { _id: "p3", productId: "KK-NOREG", status: "ACTIVE", isActive: true, allowsRegistration: false, save: saveSig, toObject: () => ({}) },
  "KK-USED": { _id: "p4", productId: "KK-USED", status: "CONSUMED", isActive: true, allowsRegistration: true, isAssigned: true, assignedRestaurantId: "rx", save: saveSig, toObject: () => ({}) },
  "KK-TEST-002": { _id: "p5", productId: "KK-TEST-002", status: "ACTIVE", isActive: true, allowsRegistration: true, save: saveSig, toObject: () => ({}) },
};
const users = {
  "a@test.com": { _id: "u1", name: "A", email: "a@test.com", phone: "1111111111", password: "h", restaurantId: "r1", productId: "p1", isActive: true, isDeleted: false, sessions: [], save: async function () { return this; }, toSafeJSON: () => ({ _id: "u1" }) },
  "b@test.com": { _id: "u2", name: "B", email: "b@test.com", phone: "2222222222", password: "h", restaurantId: "r2", productId: "p5", isActive: true, isDeleted: false, sessions: [], save: async function () { return this; }, toSafeJSON: () => ({ _id: "u2" }) },
};

const UserMock = (d) => ({ ...d, _id: "uNew", save: async function () { return this; }, toSafeJSON: () => ({ _id: "uNew" }) });
UserMock.findOne = async (q) => {
  if (q.$or) {
    for (const cond of q.$or) {
      for (const u of Object.values(users)) {
        if ((cond.email && u.email === cond.email) || (cond.phone && u.phone === cond.phone)) return u;
      }
    }
    return null;
  }
  return q.email ? users[q.email] : null;
};
UserMock.findById = async (id) => Object.values(users).find((u) => u._id === id) || null;

const mocks = {
  "../models/productIdModel": {
    findOne: async ({ productId }) => products[productId] || null,
    findById: async (id) => Object.values(products).find((p) => p._id === id) || null,
  },
  "../models/userModel": UserMock,
  "../models/restaurantModel": { create: async (d) => ({ ...d, _id: "rNew" }) },
  "../models/auditLogModel": { create: async () => ({}) },
  "bcrypt": { compare: async (password, hash) => password === hash },
};
let uc;
{
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) { if (mocks[r]) return mocks[r]; return orig.apply(this, arguments); };
  uc = require("../controllers/userController");
  Module._load = orig;
}
const req = (body, extra = {}) => ({ body, cookies: {}, ip: "1.2.3.4", get: () => "", ...extra });
const res = () => { const r = { statusCode: 200, _j: null, status(c) { this.statusCode = c; return this; }, json(o) { this._j = o; return this; }, cookie() { return this; }, clearCookie() { return this; } }; return r; };
const call = async (fn, body, extra) => { const r = res(); let err = null; await fn(req(body, extra), r, (e) => { err = e; }); return { r, err }; };

// SIGNUP
test("signup without Product ID -> 400", async () => {
  const { err } = await call(uc.register, { name: "T", address: "A", phone: "9999999999", password: "x" });
  assert.equal(err.status, 400); assert.match(err.message, /Product ID is required/i);
});
test("invalid Product ID -> 400", async () => {
  const { err } = await call(uc.register, { name: "T", address: "A", phone: "9999999999", password: "x", productId: "KK-NOPE" });
  assert.equal(err.status, 400); assert.match(err.message, /Invalid Product ID/i);
});
test("inactive Product ID -> 400", async () => {
  const { err } = await call(uc.register, { name: "T", address: "A", phone: "9999999999", password: "x", productId: "KK-INACTIVE" });
  assert.equal(err.status, 400); assert.match(err.message, /inactive/i);
});
test("Product ID without registration -> 400", async () => {
  const { err } = await call(uc.register, { name: "T", address: "A", phone: "9999999999", password: "x", productId: "KK-NOREG" });
  assert.equal(err.status, 400); assert.match(err.message, /does not permit registration/i);
});
test("already-assigned Product ID -> 400", async () => {
  const { err } = await call(uc.register, { name: "T", address: "A", phone: "9999999999", password: "x", productId: "KK-USED" });
  assert.equal(err.status, 400); assert.match(err.message, /already been assigned/i);
});
test("valid Product ID -> 201", async () => {
  const { r, err } = await call(uc.register, { name: "T", address: "A", phone: "8888888888", email: "z@t.com", password: "x", productId: "KK-TEST-001", restaurantName: "R" });
  assert.ifError(err); assert.equal(r.statusCode, 201); assert.equal(r._j.success, true);
});

// LOGIN
test("login without Product ID -> 400", async () => {
  const { err } = await call(uc.login, { email: "a@test.com", password: "h" });
  assert.equal(err.status, 400); assert.match(err.message, /Product ID is required/i);
});
test("invalid Product ID at login -> 400", async () => {
  const { err } = await call(uc.login, { email: "a@test.com", password: "h", productId: "KK-NOPE" });
  assert.equal(err.status, 400); assert.match(err.message, /Invalid Product ID/i);
});
test("user A cannot login with Product ID B -> 401", async () => {
  const { err } = await call(uc.login, { email: "a@test.com", password: "h", productId: "KK-TEST-002" });
  assert.equal(err.status, 401); assert.match(err.message, /Invalid Credentials for this Product ID/i);
});
test("valid login with correct Product ID -> 200", async () => {
  const { r, err } = await call(uc.login, { email: "a@test.com", password: "h", productId: "KK-TEST-001" });
  assert.ifError(err); assert.equal(r.statusCode, 200); assert.equal(r._j.success, true);
});

// TENANT / IDOR
test("updateTeam requires restaurantId scope", async () => {
  const teamMock = { findOneAndUpdate: async (q) => { assert.ok(q.restaurantId, "query MUST include restaurantId"); assert.equal(q.restaurantId, "r1"); return null; } };
  const Module = require("module"); const orig = Module._load;
  Module._load = function (r) { if (r === "../models/teamModel") return teamMock; if (mocks[r]) return mocks[r]; return orig.apply(this, arguments); };
  const tc = require("../controllers/teamController"); Module._load = orig;
  let err = null;
  await tc.updateTeam(req({ name: "x" }, { user: { _id: "u1", restaurantId: "r1", outletId: "o1" }, params: { teamId: "t1" } }), res(), (e) => { err = e; });
  assert.equal(err && err.status, 404);
});
test("manipulated outletId in body is ignored", async () => {
  const userMock = { findOneAndUpdate: async (q, update) => { assert.equal(update.outletId, "o1"); return { _id: "s1" }; } };
  const Module = require("module"); const orig = Module._load;
  Module._load = function (r) { if (r === "../models/userModel") return userMock; return orig.apply(this, arguments); };
  const tc = require("../controllers/teamController"); Module._load = orig;
  const r = res();
  await tc.updateStaff(req({ outletId: "EVIL-999", name: "x" }, { user: { _id: "u1", restaurantId: "r1", outletId: "o1" }, params: { userId: "s1" } }), r, () => {});
  assert.equal(r.statusCode, 200);
});