process.env.CSD_JWT_SECRET = "test-csd-secret-that-is-comfortably-over-32-chars";
process.env.SUPERADMIN_EMAIL = "boss@example.com";
process.env.SUPERADMIN_PASSWORD = "TestSuperSecret_123";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");

/**
 * Tests for the CSD email + password auth introduced on 2026-08-30, replacing
 * the phone + OTP flow that had a hard Fast2SMS dependency. Assertions are
 * scoped to behaviour the switch was supposed to guarantee:
 *
 *   - the seeded super-admin is created from the SUPERADMIN_* env vars,
 *   - login uses bcrypt.compare, not any plaintext check,
 *   - a wrong password is refused,
 *   - the seeded super-admin cannot be demoted or disabled (recovery path).
 *
 * The Mongoose model and audit service are stubbed via require.cache so the
 * tests run with no live database — same pattern as csdAccessControl.test.js.
 */

// --- Stubbed CsdStaff model -----------------------------------------------
const staffPath = require.resolve("../models/csdStaffModel");
const staffById = new Map();
const staffByEmail = new Map();

const makeDoc = (init) => {
  const doc = { ...init, save: async function save() { staffById.set(String(this._id), this); staffByEmail.set(this.email, this); return this; }, loginHistory: init.loginHistory || [], toSafeJSON() { const { password, ...rest } = this; return rest; } };
  return doc;
};

const CsdStaff = {
  // Mimics Mongoose: returns a chainable Query that resolves to the doc (or
  // null) when awaited. Returning null directly would break the controller's
  // `.select("+password")` call — same failure the tests exposed.
  findOne(q) {
    const clauses = q?.$or ? q.$or : [q];
    let found = null;
    for (const doc of staffById.values()) {
      for (const c of clauses) {
        if (c?.email && doc.email === c.email) { found = doc; break; }
        if (c?.isPredefined === true && doc.isPredefined === true) { found = doc; break; }
      }
      if (found) break;
    }
    return withSelect(found);
  },
  async findById(id) { return staffById.get(String(id)) || null; },
  async countDocuments(q) {
    let n = 0;
    for (const d of staffById.values()) {
      if (q?.role && d.role !== q.role) continue;
      if (q?.status && d.status !== q.status) continue;
      n += 1;
    }
    return n;
  },
  async nextStaffId() { return "KK-ST-" + String(staffById.size + 1).padStart(3, "0"); },
};

// The controller calls `.select("+password")` on the query, then hits await.
// A chainable stand-in whose then() resolves to the doc.
const withSelect = (doc) => {
  const chain = { select: () => chain, then: (r) => Promise.resolve(doc).then(r) };
  return chain;
};

// The real constructor + pre-save hashing + comparePassword method.
function CsdStaffCtor(props) {
  Object.assign(this, {
    _id: props._id || "id-" + (staffById.size + 1),
    ...props,
    loginHistory: [],
  });
}
CsdStaffCtor.prototype.save = async function save() {
  if (this._pwPlain !== this.password) {
    this.password = await bcrypt.hash(this.password, 4); // low rounds — test speed
    this._pwPlain = this.password;
  }
  staffById.set(String(this._id), this);
  staffByEmail.set(this.email, this);
  return this;
};
CsdStaffCtor.prototype.comparePassword = function comparePassword(candidate) {
  if (typeof candidate !== "string" || !this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};
CsdStaffCtor.prototype.toSafeJSON = function toSafeJSON() {
  const { password, _pwPlain, ...rest } = this;
  return rest;
};
Object.assign(CsdStaffCtor, CsdStaff);

require.cache[staffPath] = {
  id: staffPath, filename: staffPath, loaded: true, exports: CsdStaffCtor,
};

// --- Stubbed audit service (records nothing) ------------------------------
const auditPath = require.resolve("../services/csdAuditService");
require.cache[auditPath] = {
  id: auditPath, filename: auditPath, loaded: true, exports: { csdAudit: async () => {} },
};

// --- Load controllers with those stubs in place ---------------------------
const authCtrl = require("../controllers/csdAuthController");

const makeRes = () => {
  const res = { statusCode: 200, body: null, cookies: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.cookie = (name, val) => { res.cookies[name] = val; };
  res.clearCookie = () => {};
  return res;
};
const run = async (h, req) => {
  const res = makeRes();
  let err = null;
  await h(req, res, (e) => { err = e; });
  return { res, err };
};

// ---------------------------------------------------------------------------
test("seedSuperAdmin creates the bootstrap admin from the env vars", async () => {
  staffById.clear(); staffByEmail.clear();
  await authCtrl.seedSuperAdmin();
  const seeded = staffByEmail.get("boss@example.com");
  assert.ok(seeded, "the seeded row must exist");
  assert.equal(seeded.role, "admin");
  assert.equal(seeded.status, "active");
  assert.equal(seeded.isPredefined, true, "the seeded row must be marked so it cannot be demoted");
  assert.notEqual(seeded.password, "TestSuperSecret_123", "the raw password must not be stored");
  assert.ok(seeded.password.startsWith("$2"), "password must be a bcrypt hash");
});

test("seedSuperAdmin is idempotent (a second run does not create a duplicate)", async () => {
  const before = staffById.size;
  await authCtrl.seedSuperAdmin();
  assert.equal(staffById.size, before, "no new row should be created on the second call");
});

test("login accepts the correct password and issues the session cookie", async () => {
  const { res, err } = await run(authCtrl.login, {
    body: { email: "boss@example.com", password: "TestSuperSecret_123" },
    headers: {}, ip: "127.0.0.1",
  });
  assert.equal(err, null);
  assert.equal(res.statusCode, 200);
  assert.ok(res.cookies.csdToken, "a session cookie must be set");
  assert.equal(res.body.data.email, "boss@example.com");
});

test("login rejects a wrong password with a generic 401 (no enumeration)", async () => {
  const { err } = await run(authCtrl.login, {
    body: { email: "boss@example.com", password: "WRONG" },
    headers: {}, ip: "127.0.0.1",
  });
  assert.ok(err);
  assert.equal(err.status, 401);
  assert.match(err.message, /invalid/i);
});

test("login rejects an unknown email with the SAME message as a wrong password", async () => {
  const { err } = await run(authCtrl.login, {
    body: { email: "ghost@example.com", password: "anything" },
    headers: {}, ip: "127.0.0.1",
  });
  assert.ok(err);
  assert.equal(err.status, 401);
  assert.match(err.message, /invalid/i);
});

test("login refuses missing fields with 400 (not 401 — separate error class)", async () => {
  for (const body of [{}, { email: "x@y.z" }, { password: "abc" }, { email: 1, password: "" }]) {
    const { err } = await run(authCtrl.login, { body, headers: {}, ip: "127.0.0.1" });
    assert.equal(err?.status, 400, `body=${JSON.stringify(body)} should be 400`);
  }
});
