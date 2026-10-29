const express = require("express");
const bcrypt = require("bcrypt");
const {
  Device, Command, BulkJob, Alert, AlertRule, AuditLog, AdminUser, EnrollmentToken, Rollout, Store, ALERT_TYPES,
} = require("../models");
const { wrap, HttpError, paging } = require("../lib/http");
const { requirePerm, requireRecentAuth, scopeFilter } = require("../lib/adminAuth");
const { ROLES, permissionsFor } = require("../lib/rbac");
const commands = require("../lib/commands");
const { audit, verifyChain } = require("../lib/audit");
const { publicAdmin, checkPassword } = require("./auth");
const { currentPosVersionCode } = require("./devices");
const { agentDownload } = require("../lib/agentApk");
const push = require("../lib/push");
const config = require("../config");

const router = express.Router();

// ---------------- Dashboard ----------------

router.get("/summary", requirePerm("devices.view"), wrap(async (req, res) => {
  const base = { ...scopeFilter(req), lifecycle: { $ne: "retired" } };
  const posVc = await currentPosVersionCode();
  const [total, online, lowBattery, kioskErrors, noncompliant, outdated, pendingEnrollments, openAlerts, rollouts] = await Promise.all([
    Device.countDocuments(base),
    Device.countDocuments({ ...base, online: true }),
    Device.countDocuments({ ...base, "telemetry.battery": { $lt: 20 }, "telemetry.charging": { $ne: true } }),
    Device.countDocuments({ ...base, "kiosk.state": { $in: ["error", "unlocked"] } }),
    Device.countDocuments({ ...base, "policy.compliant": false }),
    posVc == null ? 0 : Device.countDocuments({ ...base, $or: [{ posVersionCode: { $lt: posVc } }, { posVersionCode: null }] }),
    req.admin.role === "store_user" ? 0 : EnrollmentToken.countDocuments({ revokedAt: null, expiresAt: { $gt: new Date() }, $expr: { $lt: ["$uses", "$maxUses"] } }),
    Alert.find({ status: { $ne: "resolved" } }).sort({ openedAt: -1 }).limit(8).populate("deviceId", "name").populate("storeId", "name").lean(),
    Rollout.find({ status: { $in: ["running", "paused"] } }).populate("versionId", "versionCode versionName").lean(),
  ]);
  res.json({
    totals: { total, online, offline: total - online, lowBattery, kioskErrors, noncompliant, outdated, pendingEnrollments },
    recentAlerts: openAlerts,
    rollouts,
    pushConnections: push.connectedCount(),
  });
}));

// ---------------- Command history ----------------

router.get("/commands", requirePerm("commands.view"), wrap(async (req, res) => {
  const { skip, limit } = paging(req);
  const q = {};
  if (req.query.status) q.status = req.query.status;
  if (req.query.type) q.type = req.query.type;
  if (req.query.bulkId) q.bulkId = req.query.bulkId;
  const items = await Command.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("deviceId", "name").lean();
  res.json({ items });
}));

router.post("/commands/:cmdId/cancel", requirePerm("cmd.basic"), wrap(async (req, res) => {
  const c = await Command.findOne({ cmdId: req.params.cmdId });
  if (!c) throw new HttpError(404, "not_found");
  if (c.status !== "queued") throw new HttpError(409, "only_queued_commands_can_be_cancelled");
  c.status = "cancelled";
  c.history.push({ status: "cancelled", at: new Date() });
  await c.save();
  await audit(req, "command.cancelled", { targetType: "command", targetId: c.cmdId });
  res.json({ ok: true });
}));

router.get("/bulk", requirePerm("commands.view"), wrap(async (req, res) => {
  const jobs = await BulkJob.find().sort({ createdAt: -1 }).limit(30).lean();
  const items = [];
  for (const j of jobs) items.push({ ...j, progress: await commands.bulkProgress(j._id) });
  res.json({ items });
}));

// ---------------- Alerts ----------------

router.get("/alerts", requirePerm("alerts.view"), wrap(async (req, res) => {
  const { skip, limit } = paging(req);
  const q = {};
  if (req.query.status) q.status = req.query.status;
  if (req.admin.role === "store_user") q.storeId = { $in: req.admin.storeIds };
  const items = await Alert.find(q).sort({ openedAt: -1 }).skip(skip).limit(limit).populate("deviceId", "name").populate("storeId", "name").lean();
  res.json({ items });
}));

router.post("/alerts/:id/ack", requirePerm("alerts.view"), wrap(async (req, res) => {
  const a = await Alert.findById(req.params.id);
  if (!a) throw new HttpError(404, "not_found");
  if (req.admin.role === "store_user" && !req.admin.storeIds.some((s) => String(s) === String(a.storeId))) throw new HttpError(404, "not_found");
  if (a.status === "open") {
    a.status = "acknowledged";
    a.acknowledgedBy = req.admin.email;
    await a.save();
    await audit(req, "alert.acknowledged", { targetType: "alert", targetId: a._id });
  }
  res.json({ ok: true });
}));

router.get("/alert-rules", requirePerm("alerts.view"), wrap(async (req, res) => {
  res.json({ items: await AlertRule.find().populate("storeId", "name").lean(), types: ALERT_TYPES });
}));

router.post("/alert-rules", requirePerm("alerts.manage"), wrap(async (req, res) => {
  const b = req.body;
  if (!ALERT_TYPES.includes(b.type)) throw new HttpError(400, "bad_type");
  const store = b.storeId ? await Store.findById(b.storeId) : null;
  const companyId = store?.companyId || req.admin.companyId || (await Store.findOne())?.companyId;
  const r = await AlertRule.create({ companyId, storeId: store?._id, type: b.type, enabled: b.enabled !== false, threshold: b.threshold, businessHoursOnly: Boolean(b.businessHoursOnly), channels: b.channels || {} });
  await audit(req, "alert_rule.created", { targetType: "alert_rule", targetId: r._id, details: b });
  res.status(201).json({ rule: r });
}));

router.patch("/alert-rules/:id", requirePerm("alerts.manage"), wrap(async (req, res) => {
  const r = await AlertRule.findById(req.params.id);
  if (!r) throw new HttpError(404, "not_found");
  for (const k of ["enabled", "threshold", "businessHoursOnly", "channels"]) if (req.body[k] !== undefined) r[k] = req.body[k];
  await r.save();
  await audit(req, "alert_rule.updated", { targetType: "alert_rule", targetId: r._id, details: req.body });
  res.json({ rule: r });
}));

router.delete("/alert-rules/:id", requirePerm("alerts.manage"), wrap(async (req, res) => {
  await AlertRule.deleteOne({ _id: req.params.id });
  await audit(req, "alert_rule.deleted", { targetType: "alert_rule", targetId: req.params.id });
  res.json({ ok: true });
}));

// ---------------- Audit ----------------

router.get("/audit", requirePerm("audit.view"), wrap(async (req, res) => {
  const { skip, limit } = paging(req, 100);
  const q = {};
  if (req.query.action) q.action = new RegExp(`^${req.query.action.replace(/[^a-z_.]/gi, "")}`);
  if (req.query.targetId) q.targetId = req.query.targetId;
  if (req.query.actor) q.actorEmail = req.query.actor;
  res.json({ items: await AuditLog.find(q).sort({ seq: -1 }).skip(skip).limit(limit).lean() });
}));

router.get("/audit/verify", requirePerm("audit.view"), wrap(async (req, res) => res.json(await verifyChain())));

// ---------------- Admin users ----------------

router.get("/roles", requirePerm("devices.view"), (req, res) => {
  res.json({ items: Object.entries(ROLES).map(([key, r]) => ({ key, name: r.name, permissions: permissionsFor(key) })) });
});

router.get("/admins", requirePerm("admins.manage"), wrap(async (req, res) => {
  const items = await AdminUser.find().sort({ email: 1 }).lean();
  res.json({ items: items.map((a) => ({ ...publicAdmin(a), disabled: a.disabled, lastLoginAt: a.lastLoginAt, lastLoginIp: a.lastLoginIp })) });
}));

router.post("/admins", requirePerm("admins.manage"), wrap(async (req, res) => {
  const { email, name, role, password, storeIds } = req.body;
  if (!ROLES[role]) throw new HttpError(400, "bad_role");
  const weak = checkPassword(password);
  if (weak) throw new HttpError(400, "weak_password", weak);
  if (role === "store_user" && !storeIds?.length) throw new HttpError(400, "store_user_needs_stores");
  const a = await AdminUser.create({
    email, name, role, companyId: req.admin.companyId, storeIds: role === "store_user" ? storeIds : [],
    passwordHash: await bcrypt.hash(password, 12),
  });
  await audit(req, "admin.created", { targetType: "admin", targetId: a._id, details: { email, role } });
  res.status(201).json({ admin: publicAdmin(a) });
}));

router.patch("/admins/:id", requirePerm("admins.manage"), wrap(async (req, res) => {
  const a = await AdminUser.findById(req.params.id);
  if (!a) throw new HttpError(404, "not_found");
  const b = req.body;
  if (String(a._id) === String(req.admin._id) && (b.role || b.disabled)) throw new HttpError(400, "cannot_change_own_role");
  if (b.role) { if (!ROLES[b.role]) throw new HttpError(400, "bad_role"); a.role = b.role; }
  if (b.name !== undefined) a.name = b.name;
  if (b.storeIds) a.storeIds = b.storeIds;
  if (b.disabled !== undefined) a.disabled = Boolean(b.disabled);
  if (b.password) {
    const weak = checkPassword(b.password);
    if (weak) throw new HttpError(400, "weak_password", weak);
    a.passwordHash = await bcrypt.hash(b.password, 12);
  }
  if (b.reset2fa) { a.totpEnabled = false; a.totpSecretEnc = undefined; }
  // Any change to access ends the user's sessions.
  a.sessionVersion += 1;
  await a.save();
  await audit(req, "admin.updated", { targetType: "admin", targetId: a._id, details: { ...b, password: b.password ? "***" : undefined } });
  res.json({ admin: publicAdmin(a) });
}));

// ---------------- Settings ----------------

router.get("/settings", requirePerm("devices.view"), (req, res) => {
  res.json({
    publicUrl: config.publicUrl,
    agent: agentDownload(),
    heartbeatSeconds: config.heartbeatSeconds,
    offlineAfterSeconds: config.offlineAfterSeconds,
    enrollTokenDefaultTtlHours: config.enrollTokenDefaultTtlHours,
    storeSync: Boolean(config.knotkitchenMongoUri),
    alertWebhook: Boolean(config.alertWebhookUrl),
    environment: config.isProduction ? "production" : "development",
  });
});

module.exports = { router, requireRecentAuth };
