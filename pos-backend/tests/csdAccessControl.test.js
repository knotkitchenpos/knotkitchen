const { test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

/**
 * CSD/Admin panel access-control tests.
 *
 * The spec's hard requirement is:
 *
 *   "Never allow a Staff user to access Admin-only pages by manually entering
 *    URLs" / "Staff must not be able to access Admin APIs even if they
 *    manually modify frontend routes."
 *
 * Hiding nav links cannot satisfy that — only the server guards can. These
 * tests exercise the real middleware against a stubbed CsdStaff model, in the
 * style of tenantIsolation.test.js (no live Mongo, no live Express).
 *
 * The most important case is `role is read from the database, not the token`:
 * sessions last 12h, so if the role were trusted from the JWT payload a
 * demoted or disabled employee would keep admin access for up to half a day.
 */

const SECRET = "test-csd-secret-that-is-comfortably-over-32-chars";
process.env.CSD_JWT_SECRET = SECRET;
// CSD_ADMIN_PHONES no longer exists — the panel is email+password now.

// --- Stub the CsdStaff model BEFORE the middleware requires it -------------
const staffModelPath = require.resolve("../models/csdStaffModel");
let staffInDb = null; // what findById currently returns
require.cache[staffModelPath] = {
  id: staffModelPath,
  filename: staffModelPath,
  loaded: true,
  exports: { findById: async () => staffInDb },
};

const {
  requireCsdAuth,
  requireCsdAdmin,
} = require("../middlewares/csdAuth");

// --- Tiny express-ish doubles ---------------------------------------------
const makeRes = () => ({
  cleared: [],
  cookie() {},
  clearCookie(name) {
    this.cleared.push(name);
  },
});

const makeReq = (token, extra = {}) => ({
  cookies: token ? { csdToken: token } : {},
  headers: {},
  ...extra,
});

const run = async (mw, req, res) =>
  new Promise((resolve) => {
    mw(req, res, (err) => resolve(err || null));
  });

const tokenFor = (id, secret = SECRET) =>
  jwt.sign({ sub: id, staffId: "KK-ST-001" }, secret, { algorithm: "HS256", expiresIn: "12h" });

const activeAdmin = { _id: "aaa", staffId: "KK-ST-001", role: "admin", status: "active" };
const activeStaff = { _id: "bbb", staffId: "KK-ST-002", role: "staff", status: "active" };

// ---------------------------------------------------------------------------

test("no token is rejected", async () => {
  staffInDb = activeAdmin;
  const err = await run(requireCsdAuth, makeReq(null), makeRes());
  assert.equal(err?.status, 401);
});

test("token signed with a different secret is rejected", async () => {
  staffInDb = activeAdmin;
  const forged = tokenFor("aaa", "an-attacker-controlled-secret-of-length-32+");
  const err = await run(requireCsdAuth, makeReq(forged), makeRes());
  assert.equal(err?.status, 401);
});

test("expired token is rejected", async () => {
  staffInDb = activeAdmin;
  const expired = jwt.sign({ sub: "aaa" }, SECRET, { algorithm: "HS256", expiresIn: -10 });
  const err = await run(requireCsdAuth, makeReq(expired), makeRes());
  assert.equal(err?.status, 401);
});

test("valid token for an active staff member authenticates", async () => {
  staffInDb = activeStaff;
  const req = makeReq(tokenFor("bbb"));
  const err = await run(requireCsdAuth, req, makeRes());
  assert.equal(err, null);
  assert.equal(req.csdStaff.staffId, "KK-ST-002");
});

test("staff CANNOT reach an admin-guarded route (the URL-tampering case)", async () => {
  staffInDb = activeStaff;
  const req = makeReq(tokenFor("bbb"));
  assert.equal(await run(requireCsdAuth, req, makeRes()), null);

  const err = await run(requireCsdAdmin, req, makeRes());
  assert.equal(err?.status, 403, "a staff session must be refused by requireCsdAdmin");
});

test("admin can reach an admin-guarded route", async () => {
  staffInDb = activeAdmin;
  const req = makeReq(tokenFor("aaa"));
  assert.equal(await run(requireCsdAuth, req, makeRes()), null);
  assert.equal(await run(requireCsdAdmin, req, makeRes()), null);
});

test("requireCsdAdmin refuses an unauthenticated request outright", async () => {
  const err = await run(requireCsdAdmin, makeReq(null), makeRes());
  assert.equal(err?.status, 401);
});

test("disabling a staff member invalidates their EXISTING session immediately", async () => {
  staffInDb = activeStaff;
  const token = tokenFor("bbb");

  // Session works while active...
  assert.equal(await run(requireCsdAuth, makeReq(token), makeRes()), null);

  // ...admin disables the account; the token itself is untouched and unexpired.
  staffInDb = { ...activeStaff, status: "disabled" };

  const res = makeRes();
  const err = await run(requireCsdAuth, makeReq(token), res);
  assert.equal(err?.status, 401, "a disabled account must lose access at once");
  assert.ok(res.cleared.includes("csdToken"), "the stale cookie should be cleared");
});

test("demoting an admin takes effect on the next request, not at token expiry", async () => {
  staffInDb = activeAdmin;
  const token = tokenFor("aaa"); // minted while the user was an admin

  const before = makeReq(token);
  await run(requireCsdAuth, before, makeRes());
  assert.equal(await run(requireCsdAdmin, before, makeRes()), null);

  // Demoted in the database. The JWT still says staffId KK-ST-001 and carries
  // no role claim to contradict — role must come from this row.
  staffInDb = { ...activeAdmin, role: "staff" };

  const after = makeReq(token);
  await run(requireCsdAuth, after, makeRes());
  const err = await run(requireCsdAdmin, after, makeRes());
  assert.equal(err?.status, 403, "the demoted user must lose admin on the very next request");
});

test("a deleted staff row cannot authenticate even with a valid token", async () => {
  staffInDb = null;
  const err = await run(requireCsdAuth, makeReq(tokenFor("ccc")), makeRes());
  assert.equal(err?.status, 401);
});

// The predefined-phones admin gate (isAdminPhone) was removed with the switch
// to email+password auth. The equivalent guarantee is now enforced by the
// `isPredefined` flag on the seeded CsdStaff row and covered by the seed and
// Staff Management tests below.
