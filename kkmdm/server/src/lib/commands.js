const crypto = require("crypto");
const { Command, Device, Store } = require("../models");
const push = require("./push");
const { inWindow } = require("./time");

// Default time-to-live per command type, hours.
const TTL_HOURS = { wipe: 72, install_app: 72, uninstall_app: 72, apply_policy: 168, release_device_owner: 24 };
// These wait for the store's maintenance window unless forced.
const MAINTENANCE_TYPES = new Set(["install_app", "uninstall_app", "reboot"]);
// A "sent" command not acknowledged within this is offered again; the
// device dedupes by cmdId so a repeat never runs twice.
const RESEND_AFTER_MS = 2 * 60 * 1000;
const TERMINAL = ["succeeded", "failed", "expired", "cancelled"];

function newCmdId() {
  return crypto.randomUUID();
}

/**
 * Queues one command and wakes the device.
 * opts: { force, ttlHours, bulkId, rolloutId, actor }
 */
async function enqueue(deviceId, type, params = {}, opts = {}) {
  const ttl = opts.ttlHours ?? TTL_HOURS[type] ?? 24;
  const holdForWindow = MAINTENANCE_TYPES.has(type) && !opts.force && opts.respectMaintenanceWindow !== false;
  const cmd = await Command.create({
    cmdId: newCmdId(),
    deviceId,
    type,
    params,
    status: "queued",
    expiresAt: new Date(Date.now() + ttl * 3600 * 1000),
    holdForMaintenance: holdForWindow,
    bulkId: opts.bulkId,
    rolloutId: opts.rolloutId,
    createdBy: opts.actor?._id,
    createdByEmail: opts.actor?.email || "system",
    history: [{ status: "queued", at: new Date() }],
  });
  if (!holdForWindow) push.wake(deviceId);
  return cmd;
}

/**
 * Commands to hand a device on sync. Maintenance-held commands are released
 * while the device's store is inside its maintenance window.
 */
async function pendingFor(device) {
  const now = new Date();
  const store = device.storeId ? await Store.findById(device.storeId, { maintenanceWindow: 1, timezone: 1 }).lean() : null;
  const windowOpen = store
    ? inWindow(store.maintenanceWindow?.start, store.maintenanceWindow?.end, store.timezone)
    : true;

  const candidates = await Command.find({
    deviceId: device._id,
    expiresAt: { $gt: now },
    $or: [
      { status: "queued" },
      { status: "sent", updatedAt: { $lt: new Date(Date.now() - RESEND_AFTER_MS) } },
    ],
  }).sort({ createdAt: 1 }).limit(20);

  const out = [];
  for (const c of candidates) {
    if (c.holdForMaintenance && !windowOpen) continue;
    if (c.status === "queued") {
      c.status = "sent";
      c.history.push({ status: "sent", at: now });
    }
    await c.save();
    out.push({ cmdId: c.cmdId, type: c.type, params: c.params, expiresAt: c.expiresAt });
  }
  return out;
}

const ORDER = { queued: 0, sent: 1, delivered: 2, executing: 3, succeeded: 4, failed: 4, expired: 4, cancelled: 4 };

/** Device-reported progress. Never moves backwards, ignores finished commands. */
async function report(device, cmdId, { status, result, error }) {
  if (!["delivered", "executing", "succeeded", "failed"].includes(status)) return { ok: false, reason: "bad_status" };
  const c = await Command.findOne({ cmdId, deviceId: device._id });
  if (!c) return { ok: false, reason: "unknown_command" };
  if (TERMINAL.includes(c.status) || ORDER[status] <= ORDER[c.status]) return { ok: true, ignored: true };
  c.status = status;
  c.history.push({ status, at: new Date() });
  if (result !== undefined) c.result = result;
  if (error) c.error = String(error).slice(0, 2000);
  await c.save();
  return { ok: true, command: c };
}

async function expireOld() {
  const now = new Date();
  const r = await Command.updateMany(
    { status: { $in: ["queued", "sent", "delivered", "executing"] }, expiresAt: { $lte: now } },
    { $set: { status: "expired" }, $push: { history: { status: "expired", at: now } } },
  );
  return r.modifiedCount;
}

async function bulkProgress(bulkId) {
  const rows = await Command.aggregate([{ $match: { bulkId } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}

/** Devices for a bulk target: { deviceIds } | { storeId } | { groupId } | { fleet: true } */
async function resolveTarget(target, scopeFilter) {
  const q = { lifecycle: { $in: ["enrolled", "active", "in_repair"] }, ...scopeFilter };
  if (target.deviceIds?.length) q._id = { $in: target.deviceIds };
  else if (target.groupId) q.groupId = target.groupId;
  else if (target.storeId) q.storeId = target.storeId;
  else if (!target.fleet) throw new Error("target needs deviceIds, storeId, groupId or fleet");
  return Device.find(q, { _id: 1 }).lean();
}

module.exports = { enqueue, pendingFor, report, expireOld, bulkProgress, resolveTarget, TERMINAL };
