const express = require("express");
const fs = require("fs");
const {
  Device, DeviceEvent, DeviceLog, Command, BulkJob, Telemetry, Store, Group, App, AppVersion,
} = require("../models");
const { wrap, HttpError, paging, escapeRegex } = require("../lib/http");
const { requirePerm, requireRecentAuth, scopeFilter } = require("../lib/adminAuth");
const { can, COMMAND_PERMS, DESTRUCTIVE_COMMANDS } = require("../lib/rbac");
const commands = require("../lib/commands");
const { resolveForDevice } = require("../lib/policy");
const { revokeAll } = require("../lib/deviceAuth");
const { totp, decrypt } = require("../lib/crypto");
const { audit, deviceEvent } = require("../lib/audit");
const push = require("../lib/push");

const router = express.Router();

// Technician OTP: TOTP over the device's own seed with a 5-minute step. The
// agent accepts the current step and the one either side.
const TECH_STEP = 300;

async function currentPosVersionCode() {
  const pos = await App.findOne({ role: "pos" }).lean();
  if (!pos) return null;
  const v = await AppVersion.findOne({ appId: pos._id }).sort({ versionCode: -1 }).lean();
  return v?.versionCode ?? null;
}

/** Builds the device-list filter from query parameters. */
async function listFilter(req) {
  const q = { ...scopeFilter(req) };
  const f = req.query;
  if (f.lifecycle) q.lifecycle = f.lifecycle;
  else q.lifecycle = { $ne: "retired" };
  if (f.storeId) q.storeId = q.storeId ? { $in: (q.storeId.$in || []).filter((s) => String(s) === f.storeId) } : f.storeId;
  if (f.groupId) q.groupId = f.groupId;
  if (f.status === "online") q.online = true;
  if (f.status === "offline") q.online = false;
  if (f.lowBattery) q["telemetry.battery"] = { $lt: Number(f.lowBattery) || 20 };
  if (f.notCharging) q["telemetry.charging"] = false;
  if (f.kioskError) q["kiosk.state"] = { $in: ["error", "unlocked"] };
  if (f.noncompliant) q["policy.compliant"] = false;
  if (f.pilot) q.pilot = true;
  if (f.outdated) {
    const vc = await currentPosVersionCode();
    if (vc != null) q.$or = [{ posVersionCode: { $lt: vc } }, { posVersionCode: null }];
  }
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q), "i");
    q.$and = [{ $or: [{ name: rx }, { serial: rx }, { model: rx }, { "inventory.assetTag": rx }] }];
  }
  return q;
}

async function loadDevice(req) {
  const d = await Device.findOne({ _id: req.params.id, ...scopeFilter(req) });
  if (!d) throw new HttpError(404, "device_not_found");
  return d;
}

const LIST_FIELDS = "name storeId groupId lifecycle online lastSeenAt serial model manufacturer androidVersion sdkInt agentVersion posVersion posVersionCode telemetry kiosk policy.compliant pilot inventory.assetTag";

router.get("/", requirePerm("devices.view"), wrap(async (req, res) => {
  const { skip, limit, page } = paging(req);
  const q = await listFilter(req);
  const sort = { name: { name: 1 }, lastSeen: { lastSeenAt: -1 }, battery: { "telemetry.battery": 1 } }[req.query.sort] || { name: 1 };
  const [items, total] = await Promise.all([
    Device.find(q, LIST_FIELDS).sort(sort).skip(skip).limit(limit).populate("storeId", "name").populate("groupId", "name").lean(),
    Device.countDocuments(q),
  ]);
  res.json({ items, total, page, limit });
}));

router.get("/export.csv", requirePerm("devices.view"), wrap(async (req, res) => {
  const q = await listFilter(req);
  const cols = ["name", "store", "group", "lifecycle", "online", "lastSeenAt", "battery", "charging", "androidVersion", "posVersion", "agentVersion", "model", "serial", "network", "ssid", "kiosk", "compliant", "assetTag"];
  const esc = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // no formula injection in Excel
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kkmdm-devices-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.write(cols.join(",") + "\n");
  for await (const d of Device.find(q).populate("storeId", "name").populate("groupId", "name").lean().cursor()) {
    res.write([d.name, d.storeId?.name, d.groupId?.name, d.lifecycle, d.online, d.lastSeenAt?.toISOString(), d.telemetry?.battery,
      d.telemetry?.charging, d.androidVersion, d.posVersion, d.agentVersion, d.model, d.serial, d.telemetry?.networkType,
      d.telemetry?.ssid, d.kiosk?.state, d.policy?.compliant, d.inventory?.assetTag].map(esc).join(",") + "\n");
  }
  await audit(req, "devices.exported", { details: { filter: req.query } });
  res.end();
}));

router.get("/:id", requirePerm("devices.view"), wrap(async (req, res) => {
  const d = await loadDevice(req);
  await d.populate([{ path: "storeId", select: "name kkStoreId maintenanceWindow" }, { path: "groupId", select: "name" }]);
  const obj = d.toObject();
  delete obj.techSecretEnc;
  delete obj.fcmToken;
  res.json({ device: obj, connected: push.isConnected(d._id), posLatestVersionCode: await currentPosVersionCode() });
}));

router.patch("/:id", requirePerm("devices.edit"), wrap(async (req, res) => {
  const d = await loadDevice(req);
  const before = { name: d.name, storeId: d.storeId, groupId: d.groupId, lifecycle: d.lifecycle };
  const b = req.body;
  if (b.name !== undefined) d.name = String(b.name).trim().slice(0, 80) || d.name;
  if (b.storeId !== undefined) {
    const store = await Store.findById(b.storeId);
    if (!store) throw new HttpError(400, "bad_store");
    if (String(store._id) !== String(d.storeId)) d.groupId = undefined;
    d.storeId = store._id;
  }
  if (b.groupId !== undefined) {
    if (b.groupId && !(await Group.exists({ _id: b.groupId, storeId: d.storeId }))) throw new HttpError(400, "bad_group");
    d.groupId = b.groupId || undefined;
  }
  if (b.lifecycle !== undefined) {
    if (!["active", "in_repair", "in_stock", "enrolled"].includes(b.lifecycle)) throw new HttpError(400, "use_retire_endpoint");
    d.lifecycle = b.lifecycle;
  }
  if (b.pilot !== undefined) d.pilot = Boolean(b.pilot);
  if (b.inventory) {
    for (const k of ["assetTag", "purchaseDate", "warrantyUntil", "notes"]) {
      if (b.inventory[k] !== undefined) d.inventory[k] = b.inventory[k] || undefined;
    }
  }
  await d.save();
  // Store or group changes alter the effective policy and managed config.
  push.wake(d._id);
  await audit(req, "device.updated", { targetType: "device", targetId: d._id, details: { before, changes: b } });
  res.json({ ok: true });
}));

router.get("/:id/policy", requirePerm("devices.view"), wrap(async (req, res) => {
  const d = await loadDevice(req);
  const eff = await resolveForDevice(d.toObject());
  res.json({ ...eff, applied: d.policy });
}));

router.get("/:id/events", requirePerm("devices.view"), wrap(async (req, res) => {
  const d = await loadDevice(req);
  const { skip, limit } = paging(req, 100);
  res.json({ items: await DeviceEvent.find({ deviceId: d._id }).sort({ at: -1 }).skip(skip).limit(limit).lean() });
}));

router.get("/:id/telemetry", requirePerm("devices.view"), wrap(async (req, res) => {
  const d = await loadDevice(req);
  const hours = Math.min(Number(req.query.hours) || 24, 24 * 90);
  const items = await Telemetry.find({ deviceId: d._id, ts: { $gte: new Date(Date.now() - hours * 3600e3) } })
    .sort({ ts: 1 }).limit(5000).lean();
  res.json({ items });
}));

router.get("/:id/commands", requirePerm("devices.view"), wrap(async (req, res) => {
  const d = await loadDevice(req);
  const { skip, limit } = paging(req);
  res.json({ items: await Command.find({ deviceId: d._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean() });
}));

router.get("/:id/logs", requirePerm("logs.pull"), wrap(async (req, res) => {
  const d = await loadDevice(req);
  res.json({ items: await DeviceLog.find({ deviceId: d._id }).sort({ createdAt: -1 }).limit(50).lean() });
}));

router.get("/:id/logs/:logId/download", requirePerm("logs.pull"), wrap(async (req, res) => {
  const d = await loadDevice(req);
  const log = await DeviceLog.findOne({ _id: req.params.logId, deviceId: d._id });
  if (!log || !fs.existsSync(log.file)) throw new HttpError(404, "not_found");
  await audit(req, "device.log_downloaded", { targetType: "device", targetId: d._id, details: { log: log._id, kind: log.kind } });
  res.download(log.file);
}));

function checkCommandAllowed(req, type) {
  const perm = COMMAND_PERMS[type];
  if (!perm) throw new HttpError(400, "unknown_command");
  if (!can(req.admin.role, perm)) throw new HttpError(403, "forbidden", `needs ${perm}`);
  if (DESTRUCTIVE_COMMANDS.has(type) && !requireRecentAuth(req)) throw new HttpError(428, "reauth_required");
  if (type === "release_device_owner" && process.env.NODE_ENV === "production" && process.env.ALLOW_RELEASE !== "true") {
    throw new HttpError(403, "release_disabled_in_production");
  }
}

async function commandParams(type, params = {}) {
  if (type === "install_app") {
    const v = await AppVersion.findById(params.versionId).lean();
    if (!v) throw new HttpError(400, "bad_version");
    return { versionId: String(v._id), packageName: v.packageName, versionCode: v.versionCode, sha256: v.sha256, size: v.size };
  }
  if (type === "uninstall_app") {
    if (!/^[a-zA-Z0-9_.]+$/.test(params.packageName || "")) throw new HttpError(400, "bad_package");
    return { packageName: params.packageName };
  }
  if (type === "lost_mode_on") return { message: String(params.message || "This tablet belongs to KnotKitchen.").slice(0, 300), phone: String(params.phone || "").slice(0, 20) };
  if (type === "kiosk_exit_temp") return { minutes: Math.min(Math.max(Number(params.minutes) || 15, 1), 120) };
  if (type === "wipe") return { reason: String(params.reason || "").slice(0, 200), wipeExternal: Boolean(params.wipeExternal) };
  return {};
}

async function afterCommandQueued(device, type, params) {
  if (type === "lost_mode_on") {
    await Device.updateOne({ _id: device._id }, { $set: { lostMode: { enabled: true, message: params.message, phone: params.phone, since: new Date() } } });
  } else if (type === "lost_mode_off") {
    await Device.updateOne({ _id: device._id }, { $set: { "lostMode.enabled": false } });
  }
}

router.post("/:id/commands", wrap(async (req, res) => {
  const { type, params, force } = req.body;
  checkCommandAllowed(req, type);
  const d = await loadDevice(req);
  if (d.lifecycle === "retired") throw new HttpError(409, "device_retired");
  const p = await commandParams(type, params);
  const cmd = await commands.enqueue(d._id, type, p, { force: Boolean(force), actor: req.admin });
  await afterCommandQueued(d, type, p);
  await audit(req, `command.${type}`, { targetType: "device", targetId: d._id, details: { cmdId: cmd.cmdId, params: p, force: Boolean(force) } });
  res.status(201).json({ command: cmd });
}));

/** Bulk: { type, params, target: { deviceIds | storeId | groupId | fleet } } */
router.post("/bulk/commands", requirePerm("fleet.bulk"), wrap(async (req, res) => {
  const { type, params, target = {}, force } = req.body;
  checkCommandAllowed(req, type);
  if (target.fleet && !requireRecentAuth(req)) throw new HttpError(428, "reauth_required");
  const devices = await commands.resolveTarget(target, scopeFilter(req));
  if (!devices.length) throw new HttpError(400, "no_devices");
  const p = await commandParams(type, params);
  const job = await BulkJob.create({ type, params: p, target, total: devices.length, createdBy: req.admin._id, createdByEmail: req.admin.email });
  for (const d of devices) {
    await commands.enqueue(d._id, type, p, { force: Boolean(force), actor: req.admin, bulkId: job._id });
    await afterCommandQueued(d, type, p);
  }
  await audit(req, `bulk.${type}`, { targetType: "bulk_job", targetId: job._id, details: { target, total: devices.length } });
  res.status(201).json({ bulkId: job._id, total: devices.length });
}));

router.post("/:id/technician-otp", requirePerm("technician.otp"), wrap(async (req, res) => {
  const d = await loadDevice(req);
  if (!d.techSecretEnc) throw new HttpError(409, "device_has_no_seed");
  const code = totp(decrypt(d.techSecretEnc), { step: TECH_STEP });
  const step = TECH_STEP * 1000;
  const validUntil = new Date((Math.floor(Date.now() / step) + 2) * step);
  await audit(req, "device.technician_otp_issued", { targetType: "device", targetId: d._id, details: { reason: req.body.reason } });
  await deviceEvent(d._id, "technician_otp_issued", `Issued to ${req.admin.email}`);
  res.json({ code, validUntil });
}));

router.post("/:id/rotate-credentials", requirePerm("devices.edit"), wrap(async (req, res) => {
  const d = await loadDevice(req);
  // The device fetches a new secret on next sync (see /device/sync).
  await Device.updateOne({ _id: d._id }, { $set: { rotateCredential: true } });
  push.wake(d._id);
  await audit(req, "device.credential_rotation_requested", { targetType: "device", targetId: d._id });
  res.json({ ok: true });
}));

/** Retire: wipe (optional), revoke credentials, free the inventory record. */
router.post("/:id/retire", requirePerm("devices.retire"), wrap(async (req, res) => {
  const d = await loadDevice(req);
  const wipe = req.body.wipe !== false;
  if (wipe) {
    if (!can(req.admin.role, "cmd.wipe")) throw new HttpError(403, "forbidden", "wiping needs Super Admin");
    if (!requireRecentAuth(req)) throw new HttpError(428, "reauth_required");
    // Wipe first; credentials are revoked once the device confirms (or the command expires).
    await commands.enqueue(d._id, "wipe", { reason: "retired" }, { actor: req.admin, force: true });
    d.lifecycle = "retired";
    d.retiredAt = new Date();
    await d.save();
  } else {
    await revokeAll(d._id, "retired");
    d.lifecycle = "retired";
    d.retiredAt = new Date();
    d.online = false;
    await d.save();
  }
  await audit(req, "device.retired", { targetType: "device", targetId: d._id, details: { wipe } });
  res.json({ ok: true });
}));

module.exports = { router, TECH_STEP, currentPosVersionCode };
