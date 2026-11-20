// CSD staff: no account email, no password at creation; the staff member
// chooses one at their first sign-in with a one-time setup code (owner, 2026-11-20).
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const CsdStaff = require("../models/csdStaffModel");
const AuditLog = require("../models/auditLogModel");
const { createStaff } = require("../controllers/csdStaffController");
const { firstLogin } = require("../controllers/csdAuthController");
const { ensureStaffEmailIndex } = require("../services/csdStaffIndexes");

const newStaff = (extra = {}) => new CsdStaff({ staffId: "KK-ST-009", fullName: "Asha Roy", phone: "9000000123", ...extra });

test("an account needs neither an email nor a password", () => {
  const err = newStaff().validateSync();
  assert.equal(err?.errors?.email, undefined);
  assert.equal(err?.errors?.password, undefined);
  assert.equal(newStaff().toSafeJSON().email, "");
});

test("a setup code: 6 digits, valid 24 hours, only the hash is kept, a new one replaces the old", async () => {
  const s = newStaff();
  const code = await s.issueSetupCode();
  assert.match(code, /^\d{6}$/);
  assert.notEqual(s.setupCodeHash, code);
  assert.ok(Math.abs(s.setupCodeExpiresAt - Date.now() - 24 * 3600 * 1000) < 5000);
  assert.equal(await s.checkSetupCode(code), true);
  assert.equal(await s.checkSetupCode(code === "000000" ? "111111" : "000000"), false);
  assert.equal(await s.checkSetupCode(""), false);
  const next = await s.issueSetupCode();
  if (next !== code) assert.equal(await s.checkSetupCode(code), false, "the earlier code stops working");
  s.setupCodeExpiresAt = new Date(Date.now() - 1000);
  assert.equal(await s.checkSetupCode(next), false, "expired");
});

test("creating staff: phone and name only; the setup code comes back once, no password or email stored", async () => {
  const saved = { exists: CsdStaff.exists, next: CsdStaff.nextStaffId, save: CsdStaff.prototype.save, audit: AuditLog.create };
  let doc = null;
  CsdStaff.exists = async () => null;
  CsdStaff.nextStaffId = async () => "KK-ST-009";
  CsdStaff.prototype.save = async function () { doc = this; return this; };
  AuditLog.create = async (d) => d;
  const out = {};
  const res = { status: (c) => { out.status = c; return res; }, json: (b) => { out.body = b; return res; } };
  try {
    await createStaff(
      { body: { fullName: "Asha Roy", phone: "9000000123", role: "staff" }, csdStaff: { _id: new mongoose.Types.ObjectId(), staffId: "KK-ST-001" }, headers: {}, get: () => "" },
      res,
      (e) => { out.error = e; }
    );
  } finally {
    Object.assign(CsdStaff, { exists: saved.exists, nextStaffId: saved.next });
    CsdStaff.prototype.save = saved.save;
    AuditLog.create = saved.audit;
  }
  assert.equal(out.error, undefined, out.error?.message);
  assert.equal(out.status, 201);
  assert.match(out.body.data.setupCode, /^\d{6}$/);
  assert.equal(doc.password, undefined);
  assert.equal(doc.email, undefined, "left out, so the sparse index skips it");
  assert.equal(await doc.checkSetupCode(out.body.data.setupCode), true);
});

/** firstLogin against one stubbed account; returns { status, error, failed }. */
const tryFirstLogin = async (account, body) => {
  const saved = { findOne: CsdStaff.findOne, updateOne: CsdStaff.updateOne };
  const out = { failed: 0 };
  CsdStaff.findOne = () => ({ select: async () => account });
  CsdStaff.updateOne = async () => { out.failed += 1; };
  const res = { status: (c) => { out.status = c; return res; }, json: () => res };
  try {
    await firstLogin({ body, headers: {}, get: () => "" }, res, (e) => { out.error = e; });
  } finally {
    Object.assign(CsdStaff, saved);
  }
  return out;
};

test("first sign-in is refused with the wrong code, a used-up account, or a short password", async () => {
  const s = newStaff();
  const code = await s.issueSetupCode();
  const wrong = await tryFirstLogin(s, { phone: "9000000123", setupCode: code === "123456" ? "654321" : "123456", password: "a-good-password" });
  assert.equal(wrong.error.status, 401);
  assert.equal(wrong.failed, 1, "counts towards the lockout");

  const hasPassword = newStaff({ password: "already-set" });
  await hasPassword.issueSetupCode();
  assert.equal((await tryFirstLogin(hasPassword, { phone: "9000000123", setupCode: code, password: "a-good-password" })).error.status, 401);

  assert.equal((await tryFirstLogin(s, { phone: "9000000123", setupCode: code, password: "short" })).error.status, 400);
  assert.equal((await tryFirstLogin(null, { phone: "9000000123", setupCode: code, password: "a-good-password" })).error.status, 401);
  assert.equal((await tryFirstLogin(newStaff({ status: "disabled" }), { phone: "9000000123", setupCode: code, password: "a-good-password" })).error.status, 401);
});

test("boot swaps the old non-sparse email index for a sparse one, once", async () => {
  const calls = [];
  let indexes = [{ name: "_id_" }, { name: "email_1", unique: true }];
  const col = {
    indexes: async () => indexes,
    dropIndex: async (n) => { calls.push(["drop", n]); },
    createIndex: async (k, o) => { calls.push(["create", o]); indexes = [{ name: "_id_" }, { name: "email_1", ...o }]; },
  };
  const savedCol = mongoose.connection.collection;
  mongoose.connection.collection = () => col;
  try {
    assert.deepEqual(await ensureStaffEmailIndex(), { changed: true });
    assert.deepEqual(calls[0], ["drop", "email_1"]);
    assert.deepEqual(calls[1][1], { unique: true, sparse: true, name: "email_1" });
    assert.deepEqual(await ensureStaffEmailIndex(), { changed: false }, "a no-op once sparse");
    assert.equal(calls.length, 2);
  } finally {
    mongoose.connection.collection = savedCol;
  }
});
