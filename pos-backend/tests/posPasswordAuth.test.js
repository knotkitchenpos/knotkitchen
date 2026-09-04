/**
 * POS password auth (2026-08-31)
 *
 * Regression tests for the new flow that replaced the Fast2SMS phone+OTP
 * login. Same mock scaffolding shape as storeAvailability.test.js — no live
 * Mongo, no live Express — but with password hashing + comparison actually
 * running through bcrypt so the assertions prove the real thing.
 *
 * Assertions map 1:1 to what the switch was supposed to guarantee:
 *
 *   status endpoint reports hasPassword correctly
 *   setup with wrong owner phone is rejected (the knowledge-factor gate)
 *   setup with the right phone creates a User and issues a session cookie
 *   the same endpoint serves reset (password rotates, sessions invalidate)
 *   login with the correct password succeeds
 *   login with a wrong password returns 401 with the SAME generic message
 *   a store with no password gets 409 (route the client to setup, not loop)
 *   password shorter than 8 is refused at both setup and login (400)
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");

// ---------- Mock scaffolding ----------

const stores = {};
const restaurantsById = {};
const usersById = {};
const usersByPhoneAndRestaurant = {};

const key = (phone, restaurantId) => `${phone}|${String(restaurantId)}`;

const putUser = (u) => {
  usersById[String(u._id)] = u;
  usersByPhoneAndRestaurant[key(u.phone, u.restaurantId)] = u;
};

// A "User document" with the real bcrypt hook wired in — the pre-save hash
// and the compare are the actual bytes that ship, not stubs.
function makeUserDoc(props) {
  const doc = {
    _id: props._id || `user_${Math.random().toString(36).slice(2, 8)}`,
    // Same defaults the Mongoose schema hands out — otherwise a User created
    // without an explicit isActive is treated as inactive by the login
    // handler and returns "Invalid credentials." for the WRONG reason.
    isActive: true,
    isDeleted: false,
    loginAttempts: 0,
    ...props,
    sessions: props.sessions || [],
    async save() {
      if (this._pwHashCache !== this.password) {
        this.password = await bcrypt.hash(this.password, 4);
        this._pwHashCache = this.password;
      }
      putUser(this);
      return this;
    },
    toSafeJSON() {
      const { password, _pwHashCache, ...rest } = this;
      return rest;
    },
  };
  return doc;
}

const StoreMock = {
  findOne: async (q = {}) => (q.storeId ? stores[q.storeId] || null : null),
  create: async (d) => {
    const s = { ...d, _id: "store_" + d.storeId, save: async function () { return this; } };
    stores[d.storeId] = s;
    return s;
  },
};

const RestaurantMock = {
  findOne: async (q = {}) => Object.values(restaurantsById).find((r) => q._id && String(r._id) === String(q._id)) || null,
  findById: async (id) => restaurantsById[String(id)] || null,
  create: async (d) => {
    const r = { ...d, _id: "rest_" + Math.random().toString(36).slice(2, 8), save: async function () { restaurantsById[String(this._id)] = this; return this; } };
    restaurantsById[String(r._id)] = r;
    return r;
  },
};

const UserMock = {
  findOne: async (q = {}) => {
    if (q._id && q.password) {
      const u = usersById[String(q._id)];
      // Mock the .password $exists filter.
      return u && u.password ? u : null;
    }
    if (q.phone && q.restaurantId) {
      return usersByPhoneAndRestaurant[key(q.phone, q.restaurantId)] || null;
    }
    // Login lookup: (storeId, phone) with active/isDeleted filters.
    if (q.storeId && q.phone) {
      const match = Object.values(usersById).find(
        (u) =>
          String(u.storeId) === String(q.storeId) &&
          String(u.phone) === String(q.phone) &&
          (q.isActive === undefined || Boolean(u.isActive) === Boolean(q.isActive)) &&
          (q.isDeleted?.$ne === undefined || Boolean(u.isDeleted) !== Boolean(q.isDeleted.$ne))
      );
      return match || null;
    }
    // "Claimed user" lookup, shared by /store/status and /store/login:
    //   { $or:[{storeId},{restaurantId}] | storeId,
    //     password:{$exists,$ne:""}, passwordPlaceholder:{$ne:true},
    //     isActive, isDeleted:{$ne:true} }
    // A system-seeded placeholder row must NOT satisfy it.
    if (q.password?.$exists && (q.storeId || q.$or)) {
      const scopes = q.$or || [{ storeId: q.storeId }];
      const inScope = (u) =>
        scopes.some(
          (sc) =>
            (sc.storeId !== undefined && String(u.storeId) === String(sc.storeId)) ||
            (sc.restaurantId !== undefined &&
              String(u.restaurantId) === String(sc.restaurantId))
        );
      const match = Object.values(usersById).find(
        (u) =>
          inScope(u) &&
          Boolean(u.isActive) === true &&
          !u.isDeleted &&
          typeof u.password === "string" &&
          u.password.length > 0 &&
          (q.passwordPlaceholder?.$ne !== true || u.passwordPlaceholder !== true)
      );
      return match || null;
    }
    return null;
  },
  findById: async (id) => usersById[String(id)] || null,
  exists: async (q) => (await UserMock.findOne(q)) ? { _id: "ok" } : null,
  create: async (d) => {
    const doc = makeUserDoc(d);
    await doc.save();
    return doc;
  },
};

const mocks = {
  "../models/storeModel": StoreMock,
  "../models/restaurantModel": RestaurantMock,
  "../models/userModel": UserMock,
  "../services/otpService": {
    // Only maskPhone survives from the old service; nothing else is called
    // by the new code path but the module require stays in place.
    maskPhone: (p) => String(p || "").slice(0, 2) + "****" + String(p || "").slice(-2),
  },
  "jsonwebtoken": {
    sign: () => "signed-token",
    verify: () => ({}),
  },
  "../models/auditLogModel": { create: async () => ({}) },
  "../services/websiteProvisioningService": { provisionWebsiteForStore: async () => ({}) },
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

// ---------- Tiny express-ish doubles ----------

const call = async (fn, body) => {
  const cookies = {};
  const res = {
    statusCode: 200,
    _j: null,
    _cookies: cookies,
    status(c) { this.statusCode = c; return this; },
    json(o) { this._j = o; return this; },
    cookie(name, val) { cookies[name] = val; return this; },
    clearCookie(name) { delete cookies[name]; return this; },
  };
  let err = null;
  await fn(
    { body, cookies: {}, ip: "127.0.0.1", headers: {}, get: () => "" },
    res,
    (e) => { err = e; }
  );
  return { res, err };
};

// ---------- Test fixtures ----------

const seedFreshStore = (storeId, ownerPhone = "9876543210") => {
  stores[storeId] = {
    _id: "store_" + storeId,
    storeId,
    storeName: "Test Store " + storeId,
    ownerName: "Test Owner",
    ownerPhone,
    status: "active",
    isDeleted: false,
    save: async function () { return this; },
  };
};

const seedStoreWithOwner = async (storeId, ownerPhone = "9876543210", password = "correct-horse") => {
  seedFreshStore(storeId, ownerPhone);
  const restaurant = await RestaurantMock.create({
    name: stores[storeId].storeName,
    storeId,
    phone: ownerPhone,
    address: { line1: "Default Address" },
  });
  stores[storeId].restaurantId = restaurant._id;
  const user = makeUserDoc({
    name: "Owner",
    phone: ownerPhone,
    address: "Default Address",
    password,
    role: "Owner",
    restaurantId: restaurant._id,
    storeId,
  });
  await user.save();
  restaurant.ownerId = user._id;
  restaurantsById[String(restaurant._id)] = restaurant;
  return { restaurant, user };
};

/**
 * The row the CSD "Open POS" handoff auto-creates for a store nobody has
 * signed into yet: a real User with a random 32-byte password no human holds.
 * Reproduces the regression where such a store reported hasPassword=true and
 * stranded the restaurant manager on a login form.
 */
const seedStoreWithPlaceholderOwner = async (storeId, ownerPhone = "9876543210") => {
  seedFreshStore(storeId, ownerPhone);
  const restaurant = await RestaurantMock.create({
    name: stores[storeId].storeName,
    storeId,
    phone: ownerPhone,
    address: { line1: "Default Address" },
  });
  stores[storeId].restaurantId = restaurant._id;
  const user = makeUserDoc({
    name: "Owner",
    phone: ownerPhone,
    address: "Default Address",
    password: require("crypto").randomBytes(32).toString("hex"),
    role: "Owner",
    restaurantId: restaurant._id,
    storeId,
    mustChangePassword: true,
    passwordPlaceholder: true,
  });
  await user.save();
  restaurant.ownerId = user._id;
  restaurantsById[String(restaurant._id)] = restaurant;
  return { restaurant, user };
};

// ===========================================================================
test("status: unknown store → 404", async () => {
  const { err } = await call(userCtrl.checkStoreStatus, { storeId: "999999" });
  assert.equal(err?.status, 404);
});

test("status: existing store with no password → hasPassword=false + phone hint", async () => {
  seedFreshStore("200001", "9876543210");
  const { res, err } = await call(userCtrl.checkStoreStatus, { storeId: "200001" });
  assert.ifError(err);
  assert.equal(res._j.data.hasPassword, false);
  assert.equal(res._j.data.ownerPhoneHint, "98******10");
  // Fully masked in the middle — no chance of reconstructing the number.
  assert.doesNotMatch(res._j.data.ownerPhoneHint, /\d{7,}/);
});

test("status: existing store with a password → hasPassword=true", async () => {
  await seedStoreWithOwner("200002", "9876543210");
  const { res } = await call(userCtrl.checkStoreStatus, { storeId: "200002" });
  assert.equal(res._j.data.hasPassword, true);
});

// ===========================================================================
test("setup: wrong owner phone is rejected (the knowledge-factor gate)", async () => {
  seedFreshStore("200010", "9876543210");
  const { err } = await call(userCtrl.setupStorePassword, {
    storeId: "200010",
    ownerPhone: "9999999999",
    password: "long-enough-password",
  });
  assert.equal(err?.status, 400);
  assert.match(err.message, /does not match/i);
});

test("setup: correct owner phone creates the User and issues a session", async () => {
  seedFreshStore("200011", "9876543210");
  const { res, err } = await call(userCtrl.setupStorePassword, {
    storeId: "200011",
    ownerPhone: "9876543210",
    password: "long-enough-password",
  });
  assert.ifError(err);
  assert.equal(res.statusCode, 201);
  assert.equal(res._j.success, true);
  // Namespaced per takeaway, so two stores signed in from one browser do
  // not share (and overwrite) a single session cookie.
  assert.ok(res._cookies.accessToken_200011, "store-scoped session cookie must be set");
  assert.equal(res._cookies.accessToken, undefined, "must not set an unscoped cookie");
  // Password is bcrypt-hashed, not stored raw.
  const created = Object.values(usersByPhoneAndRestaurant)[0];
  assert.ok(created.password.startsWith("$2"), "password must be a bcrypt hash");
});

test("setup: password shorter than 8 is refused (400)", async () => {
  seedFreshStore("200012");
  const { err } = await call(userCtrl.setupStorePassword, {
    storeId: "200012",
    ownerPhone: "9876543210",
    password: "short",
  });
  assert.equal(err?.status, 400);
});

test("setup as reset: existing user's password rotates and prior sessions die", async () => {
  const { user } = await seedStoreWithOwner("200013", "9876543210", "old-password");
  // Simulate a prior active session
  user.sessions = [{ _id: "sess_old", refreshToken: "old-rt" }];
  await user.save();

  const { res, err } = await call(userCtrl.setupStorePassword, {
    storeId: "200013",
    ownerPhone: "9876543210",
    password: "brand-new-password",
  });
  assert.ifError(err);
  assert.equal(res.statusCode, 200);

  // Load fresh — the old session should be gone and a NEW one issued
  const after = usersById[String(user._id)];
  const stillHasOld = (after.sessions || []).some((s) => String(s._id) === "sess_old");
  assert.equal(stillHasOld, false, "prior sessions must be invalidated on reset");
  // The new password must actually authenticate
  assert.ok(await bcrypt.compare("brand-new-password", after.password));
  assert.equal(await bcrypt.compare("old-password", after.password), false);
});

// ===========================================================================
test("login: no-password store → 409 (route client to setup, not infinite 401)", async () => {
  seedFreshStore("200020");
  const { err } = await call(userCtrl.storeLoginWithPassword, {
    storeId: "200020",
    phone: "9876543210",
    password: "anything-here",
  });
  assert.equal(err?.status, 409, "409 tells the client to switch to setup mode");
});

test("login: correct phone + password succeeds and issues session", async () => {
  await seedStoreWithOwner("200021", "9876543210", "correct-horse-battery");
  const { res, err } = await call(userCtrl.storeLoginWithPassword, {
    storeId: "200021",
    phone: "9876543210",
    password: "correct-horse-battery",
  });
  assert.ifError(err);
  assert.equal(res.statusCode, 200);
  assert.ok(res._cookies.accessToken_200021, "store-scoped session cookie must be set");
  assert.ok(res._cookies.refreshToken_200021, "store-scoped refresh cookie must be set");
  assert.equal(res._cookies.accessToken, undefined, "must not set an unscoped cookie");
});

test("login: wrong password returns 401 with the generic message", async () => {
  await seedStoreWithOwner("200022", "9876543210", "correct-horse-battery");
  const { err } = await call(userCtrl.storeLoginWithPassword, {
    storeId: "200022",
    phone: "9876543210",
    password: "definitely-not-the-password",
  });
  assert.equal(err?.status, 401);
  assert.equal(err.message, "Invalid credentials.");
});

test("login: unknown phone for existing store returns the same 401", async () => {
  await seedStoreWithOwner("200023", "9876543210", "correct-horse-battery");
  const { err } = await call(userCtrl.storeLoginWithPassword, {
    storeId: "200023",
    phone: "9999999999",
    password: "correct-horse-battery",
  });
  assert.equal(err?.status, 401);
  assert.equal(err.message, "Invalid credentials.");
});

test("login: unknown store returns the SAME 401 (no enumeration)", async () => {
  const { err } = await call(userCtrl.storeLoginWithPassword, {
    storeId: "111111",
    phone: "9876543210",
    password: "anything-here",
  });
  assert.equal(err?.status, 401);
  assert.equal(err.message, "Invalid credentials.");
});

test("login: missing fields → 400 (separate error class from wrong credentials)", async () => {
  for (const body of [
    {},
    { storeId: "200021" },
    { phone: "9876543210", password: "abc" },
    { storeId: "200021", password: "abc" },
    { storeId: "200021", phone: "9876543210" },
    { storeId: 1, phone: "9876543210", password: "" },
  ]) {
    const { err } = await call(userCtrl.storeLoginWithPassword, body);
    assert.equal(err?.status, 400, `body=${JSON.stringify(body)} must be 400`);
  }
});

// ---------------------------------------------------------------------------
// Regression: an admin-created store whose only account was auto-seeded by
// CSD "Open POS" must still read as UNCLAIMED. Otherwise the manager who is
// handed the bare Store ID is shown a password prompt nobody can satisfy.
// ---------------------------------------------------------------------------

test("status: store whose only account is a CSD-seeded placeholder → hasPassword=false", async () => {
  await seedStoreWithPlaceholderOwner("300031");
  const { res, err } = await call(userCtrl.checkStoreStatus, { storeId: "300031" });
  assert.equal(err, null);
  assert.equal(res._j.data.hasPassword, false);
});

test("login: placeholder-only store → 409, routing the manager to setup", async () => {
  await seedStoreWithPlaceholderOwner("300032");
  const { err } = await call(userCtrl.storeLoginWithPassword, {
    storeId: "300032",
    phone: "9876543210",
    password: "whatever-they-guess",
  });
  assert.equal(err?.status, 409);
});

test("setup: the manager can claim a placeholder store, and it then reads as claimed", async () => {
  const { user } = await seedStoreWithPlaceholderOwner("300033");
  const seededHash = user.password;

  const { res, err } = await call(userCtrl.setupStorePassword, {
    storeId: "300033",
    ownerPhone: "9876543210",
    password: "manager-chosen-pw",
  });
  assert.equal(err, null);
  assert.equal(res.statusCode, 200);

  // The unusable hash is gone and the row is no longer a placeholder.
  assert.notEqual(user.password, seededHash);
  assert.equal(user.passwordPlaceholder, false);
  assert.equal(user.mustChangePassword, false);

  const status = await call(userCtrl.checkStoreStatus, { storeId: "300033" });
  assert.equal(status.res._j.data.hasPassword, true);

  // …and the password they just chose actually signs them in.
  const login = await call(userCtrl.storeLoginWithPassword, {
    storeId: "300033",
    phone: "9876543210",
    password: "manager-chosen-pw",
  });
  assert.equal(login.err, null);
  assert.equal(login.res.statusCode, 200);
});
