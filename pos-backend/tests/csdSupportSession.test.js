/**
 * N035 / D10: a CSD "Open POS" support session signs in as the owner but is
 * audited as support, lasts 4 hours and is never extended by a refresh.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const AuditLog = require("../models/auditLogModel");
const User = require("../models/userModel");
const CsdPosSession = require("../models/csdPosSessionModel");
const sessionCookies = require("../services/sessionCookies");
const { logActivity } = require("../services/auditService");
const { impersonateWithSupportToken, refreshToken } = require("../controllers/userController");

const HOUR = 60 * 60 * 1000;

test("N035 an action in a CSD 'Open POS' session is recorded as support, with the session", async () => {
  const savedCreate = AuditLog.create;
  const rows = [];
  AuditLog.create = async (doc) => (rows.push(doc), doc);
  try {
    const sid = new mongoose.Types.ObjectId();
    const owner = { _id: new mongoose.Types.ObjectId(), restaurantId: new mongoose.Types.ObjectId(), storeId: "231146", role: "Owner", phone: "9876543210", name: "Owner" };
    const req = (user) => ({ user, ip: "", get: () => "" });
    await logActivity({ req: req({ ...owner, supportPosSessionId: sid }), action: "MENU_ITEM_UPDATED", resource: "Menu", description: "Price changed" });
    await logActivity({ req: req({ ...owner, supportPosSessionId: null }), action: "MENU_ITEM_UPDATED", resource: "Menu", description: "Price changed" });
    assert.equal(rows[0].role, "csd:support");
    assert.equal(String(rows[0].metadata.supportPosSessionId), String(sid));
    assert.equal(rows[0].metadata.actingAs, "Owner");
    assert.equal(rows[0].storeId, "231146");
    assert.equal(rows[0].description, "[CSD support] Price changed");
    assert.equal(rows[1].role, "Owner", "the owner's own actions are unchanged");
    assert.equal(rows[1].description, "Price changed");
    assert.equal(rows[1].metadata, undefined);
  } finally {
    AuditLog.create = savedCreate;
  }
});

test("N035 an 'Open POS' session ends after 4 hours and never slides; the owner's own session still does", async () => {
  const owner = new User({ name: "Owner", address: "x", role: "Owner", storeId: "100001", password: "not-used-here" });
  owner.save = async () => owner;
  const saved = { claim: CsdPosSession.findOneAndUpdate, findOne: User.findOne, findById: User.findById, read: sessionCookies.readRefreshToken };
  CsdPosSession.findOneAndUpdate = async () => ({ _id: new mongoose.Types.ObjectId(), storeId: "100001", staffName: "Staff" });
  User.findOne = async () => owner;
  User.findById = async () => owner;
  try {
    const cookies = {};
    const res = { cookie: (n, v, o) => (cookies[n] = o), status: () => res, json: () => res };
    let err;
    await impersonateWithSupportToken({ body: { token: "t".repeat(40) }, headers: {}, ip: "", get: () => "" }, res, (e) => (err = e));
    assert.equal(err, undefined, err?.message);
    const s = owner.sessions[owner.sessions.length - 1];
    const left = s.expiresAt - Date.now();
    assert.ok(left > 3.9 * HOUR && left <= 4 * HOUR, `support session lasts ${(left / HOUR).toFixed(1)} h`);
    assert.ok(Object.values(cookies).every((o) => o.maxAge <= 4 * HOUR), "the cookies end with it");

    const before = +s.expiresAt;
    sessionCookies.readRefreshToken = () => s.refreshToken;
    await refreshToken({ headers: {}, cookies: {} }, res, (e) => (err = e));
    assert.equal(err, undefined, err?.message);
    assert.equal(+s.expiresAt, before, "a refresh does not extend a support session");
    assert.ok(Object.values(cookies).every((o) => o.maxAge <= 4 * HOUR));

    s.supportPosSessionId = null; // the same session, as the owner's own
    await refreshToken({ headers: {}, cookies: {} }, res, (e) => (err = e));
    assert.equal(err, undefined, err?.message);
    assert.ok(s.expiresAt - Date.now() > 300 * 24 * HOUR, "the owner's session still slides");
  } finally {
    CsdPosSession.findOneAndUpdate = saved.claim;
    Object.assign(User, { findOne: saved.findOne, findById: saved.findById });
    sessionCookies.readRefreshToken = saved.read;
  }
});
