const crypto = require("crypto");
const { AuditLog, Counter, DeviceEvent } = require("../models");

// Appends are serialised in-process so each row can chain to the one before.
// Running several API instances needs this moved behind a single writer
// (a queue consumer) — see docs/ARCHITECTURE.md §3.
let tail = Promise.resolve();

function rowHash(row) {
  const body = JSON.stringify([row.seq, row.at.toISOString(), String(row.actorId || ""), row.actorEmail || "",
    row.action, row.targetType || "", row.targetId || "", row.details || null, row.ip || "", row.prevHash || ""]);
  return crypto.createHash("sha256").update(body).digest("hex");
}

/**
 * audit(req|actor, action, {targetType, targetId, details})
 * req.admin is the signed-in admin; pass null for system actions.
 */
function audit(req, action, { targetType, targetId, details } = {}) {
  const actor = req?.admin || null;
  const job = tail.then(async () => {
    const counter = await Counter.findOneAndUpdate({ _id: "audit" }, { $inc: { seq: 1 } }, { upsert: true, new: true });
    const prev = counter.seq > 1 ? await AuditLog.findOne({ seq: counter.seq - 1 }, { hash: 1 }).lean() : null;
    const row = {
      seq: counter.seq,
      at: new Date(),
      actorId: actor?._id,
      actorEmail: actor?.email || (req?.system || "system"),
      actorRole: actor?.role || "system",
      action,
      targetType,
      targetId: targetId ? String(targetId) : undefined,
      // Plain JSON, so what is hashed is exactly what Mongo stores and returns.
      details: details === undefined ? undefined : JSON.parse(JSON.stringify(details)),
      ip: req?.ip,
      prevHash: prev?.hash || "",
    };
    row.hash = rowHash(row);
    await AuditLog.create(row);
  });
  tail = job.catch((err) => console.error("[audit] append failed:", err.message));
  return job;
}

async function verifyChain() {
  let prevHash = "";
  let checked = 0;
  for await (const row of AuditLog.find().sort({ seq: 1 }).lean().cursor()) {
    const expected = rowHash({ ...row, at: new Date(row.at) });
    if (row.prevHash !== prevHash || row.hash !== expected) {
      return { ok: false, brokenAtSeq: row.seq, checked };
    }
    prevHash = row.hash;
    checked++;
  }
  return { ok: true, checked };
}

function deviceEvent(deviceId, type, message, data) {
  return DeviceEvent.create({ deviceId, type, message, data }).catch((err) =>
    console.error("[device-event]", err.message));
}

module.exports = { audit, verifyChain, deviceEvent };
