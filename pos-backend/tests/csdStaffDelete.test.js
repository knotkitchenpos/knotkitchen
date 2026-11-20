// CSD > Staff Management > Delete (owner, 2026-11-20).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

const CsdStaff = require("../models/csdStaffModel");
const CsdJob = require("../models/csdJobModel");
const { WaConversation } = require("../models/waChatModel");
const { CsdPushSubscription } = require("../models/csdPushModel");
const AuditLog = require("../models/auditLogModel");
const { deleteStaff } = require("../controllers/csdStaffController");

const me = { _id: new mongoose.Types.ObjectId(), role: "admin", status: "active", staffId: "CSD001", fullName: "Admin" };

/** Runs deleteStaff against stubbed models; returns { status, body, error, log }. */
const run = async (target, { activeAdmins = 2 } = {}) => {
  const saved = {
    find: CsdStaff.findById, count: CsdStaff.countDocuments, del: CsdStaff.deleteOne,
    jobs: CsdJob.updateMany, chats: WaConversation.updateMany, push: CsdPushSubscription.deleteMany, audit: AuditLog.create,
  };
  const log = { deleted: [], jobs: [], chats: [], push: [], audit: [] };
  CsdStaff.findById = async () => target;
  CsdStaff.countDocuments = async () => activeAdmins;
  CsdStaff.deleteOne = async (q) => { log.deleted.push(q); return { deletedCount: 1 }; };
  CsdJob.updateMany = async (q, u) => { log.jobs.push({ q, u }); return { modifiedCount: 2 }; };
  WaConversation.updateMany = async (q, u) => { log.chats.push({ q, u }); return { modifiedCount: 1 }; };
  CsdPushSubscription.deleteMany = async (q) => { log.push.push(q); return { deletedCount: 1 }; };
  AuditLog.create = async (d) => { log.audit.push(d); return d; };
  const out = { log };
  const res = { status: (c) => { out.status = c; return res; }, json: (b) => { out.body = b; return res; } };
  try {
    await deleteStaff({ params: { id: String(target?._id || new mongoose.Types.ObjectId()) }, csdStaff: me, headers: {}, get: () => "" }, res, (e) => { out.error = e; });
  } finally {
    Object.assign(CsdStaff, { findById: saved.find, countDocuments: saved.count, deleteOne: saved.del });
    CsdJob.updateMany = saved.jobs; WaConversation.updateMany = saved.chats;
    CsdPushSubscription.deleteMany = saved.push; AuditLog.create = saved.audit;
  }
  return out;
};

const person = (extra = {}) => ({ _id: new mongoose.Types.ObjectId(), staffId: "CSD007", fullName: "Rahul", email: "r@example.com", role: "staff", status: "active", ...extra });

test("deleting a staff member removes them and frees their open work", async () => {
  const p = person();
  const { status, body, log, error } = await run(p);
  assert.equal(error, undefined);
  assert.equal(status, 200);
  assert.deepEqual(body.data, { unassignedJobs: 2, unassignedChats: 1 });
  assert.equal(String(log.deleted[0]._id), String(p._id));
  assert.deepEqual(log.jobs[0].q.status, { $ne: "closed" }, "closed jobs keep who handled them");
  assert.equal(log.jobs[0].u.$set.assignedToId, null);
  assert.equal(log.chats[0].u.$set.assignedToId, null);
  assert.equal(String(log.push[0].staffId), String(p._id));
});

test("refused: your own account, the seeded super-admin, the last active admin, unknown ids", async () => {
  const self = await run({ ...person(), _id: me._id });
  assert.equal(self.error.status, 400);
  assert.match(self.error.message, /your own account/);

  const seeded = await run(person({ isPredefined: true, role: "admin" }));
  assert.equal(seeded.error.status, 400);

  const last = await run(person({ role: "admin" }), { activeAdmins: 1 });
  assert.equal(last.error.status, 400);
  assert.match(last.error.message, /last active administrator/);

  const missing = await run(null);
  assert.equal(missing.error.status, 404);

  for (const r of [self, seeded, last, missing]) assert.equal(r.log.deleted.length, 0, "nothing deleted");

  // A disabled admin is not counted as the last active one.
  assert.equal((await run(person({ role: "admin", status: "disabled" }), { activeAdmins: 1 })).status, 200);
});

test("only admins reach it, and the CSD screen asks before deleting", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../routes/csdRoute.js"), "utf8");
  assert.match(routes, /router\.delete\("\/staff\/:id", requireCsdAdmin, deleteStaff\);/);
  const page = fs.readFileSync(path.join(__dirname, "../../csd-web/src/pages/StaffManagement.jsx"), "utf8");
  assert.match(page, /if \(!window\.confirm\(`Delete \$\{m\.fullName\}/);
  assert.match(page, /\{!locked && !isMe && \(\s*<button type="button" onClick=\{\(\) => removeMember\(m\)\}/);
});
