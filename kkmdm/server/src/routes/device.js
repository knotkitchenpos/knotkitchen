/**
 * Device API, used only by the KK Agent. Everything except /enroll and the
 * public agent download needs "Authorization: Device <id>.<secret>".
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("../config");
const {
  Device, EnrollmentToken, EnrollmentAttempt, PolicyAssignment, Telemetry, DeviceLog, AppVersion, Store,
} = require("../models");
const { wrap, rateLimit, HttpError } = require("../lib/http");
const { requireDevice, issueCredential, revokeAll } = require("../lib/deviceAuth");
const { sha256, encrypt, newTotpSecret } = require("../lib/crypto");
const { resolveForDevice, managedConfigFor } = require("../lib/policy");
const { desiredAppsFor } = require("../lib/desiredApps");
const commands = require("../lib/commands");
const { inWindow } = require("../lib/time");
const { audit, deviceEvent } = require("../lib/audit");
const { AGENT_FILE } = require("../lib/agentApk");
const { verifyAttestation } = require("../lib/attestation");

const router = express.Router();
const enrollLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, name: "enroll" });
const deviceLimit = rateLimit({ windowMs: 60 * 1000, max: 120, name: "device", key: (req) => req.headers.authorization?.slice(7, 31) || req.ip });
const LOG_DIR = path.join(config.storageDir, "logs");

const str = (v, n = 120) => (v == null ? undefined : String(v).slice(0, n));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

/** Public: the setup wizard downloads the agent from here during QR provisioning. */
router.get("/agent/kk-agent.apk", (req, res) => {
  if (!fs.existsSync(AGENT_FILE)) return res.status(404).send("agent not published");
  res.type("application/vnd.android.package-archive");
  res.sendFile(AGENT_FILE);
});

function cleanFacts(f = {}) {
  return {
    serial: str(f.serial, 64),
    hardwareId: str(f.hardwareId, 128),
    imei: str(f.imei, 32),
    manufacturer: str(f.manufacturer, 64),
    model: str(f.model, 64),
    androidVersion: str(f.androidVersion, 16),
    sdkInt: num(f.sdkInt),
    securityPatch: str(f.securityPatch, 16),
    gms: Boolean(f.gms),
    agentVersion: str(f.agentVersion, 32),
    agentVersionCode: num(f.agentVersionCode),
    emulator: Boolean(f.emulator),
  };
}

async function failAttempt(req, tokenId, reason, facts, status = 401) {
  await EnrollmentAttempt.create({ tokenId, success: false, reason, ip: req.ip, deviceFacts: facts });
  await audit({ ip: req.ip, system: "device" }, "enrollment.failed", { targetType: "enrollment_token", targetId: tokenId, details: { reason, serial: facts.serial, model: facts.model } });
  throw new HttpError(status, reason);
}

router.post("/device/enroll", enrollLimit, wrap(async (req, res) => {
  const facts = cleanFacts(req.body.facts);
  const raw = String(req.body.token || "");
  if (raw.length < 22) await failAttempt(req, undefined, "token_missing", facts);
  const hash = sha256(raw);
  const t = await EnrollmentToken.findOne({ tokenHash: hash });
  if (!t) await failAttempt(req, undefined, "token_unknown", facts);
  if (t.revokedAt) await failAttempt(req, t._id, "token_revoked", facts);
  if (t.expiresAt <= new Date()) await failAttempt(req, t._id, "token_expired", facts);

  const att = verifyAttestation(req.body.attestation, hash);
  if (config.isProduction && process.env.REQUIRE_ATTESTATION === "true" && !att.verified) {
    await failAttempt(req, t._id, `attestation_failed:${att.detail}`, facts, 403);
  }
  if (facts.emulator && config.isProduction) await failAttempt(req, t._id, "emulator_rejected", facts, 403);

  // Burn one use atomically: two devices racing a single-use token cannot both win.
  const burned = await EnrollmentToken.findOneAndUpdate(
    { _id: t._id, revokedAt: null, expiresAt: { $gt: new Date() }, $expr: { $lt: ["$uses", "$maxUses"] } },
    { $inc: { uses: 1 } },
    { new: true },
  );
  if (!burned) await failAttempt(req, t._id, "token_used", facts);

  // A device re-enrolling after a factory reset keeps its record.
  let device = facts.serial && facts.serial !== "unknown"
    ? await Device.findOne({ serial: facts.serial, companyId: t.companyId, lifecycle: { $ne: "retired" } })
    : null;
  const name = burned.maxUses > 1 ? `${burned.deviceName} ${burned.uses}` : burned.deviceName;
  const techSecret = newTotpSecret();
  const fields = {
    ...facts,
    attestation: { verified: att.verified, detail: att.detail },
    companyId: t.companyId,
    storeId: t.storeId,
    groupId: t.groupId,
    lifecycle: "enrolled",
    enrolledAt: new Date(),
    techSecretEnc: encrypt(techSecret),
    online: true,
    lastSeenAt: new Date(),
    kiosk: { state: "unknown" },
  };
  if (device) {
    await revokeAll(device._id, "re-enrolled");
    Object.assign(device, fields);
    await device.save();
  } else {
    device = await Device.create({ ...fields, name });
  }
  if (t.policyId) {
    await PolicyAssignment.updateOne({ scope: "device", targetId: device._id }, { $set: { policyId: t.policyId } }, { upsert: true });
  }
  const credential = await issueCredential(device._id);
  await EnrollmentAttempt.create({ tokenId: t._id, success: true, reason: "ok", ip: req.ip, deviceFacts: facts, deviceId: device._id });
  await audit({ ip: req.ip, system: "device" }, "enrollment.succeeded", { targetType: "device", targetId: device._id, details: { token: t.hint, serial: facts.serial, model: facts.model } });
  await deviceEvent(device._id, "enrolled", `Enrolled with token ${t.hint}…`, { model: facts.model, androidVersion: facts.androidVersion });

  const policy = await resolveForDevice(device.toObject());
  await Device.updateOne({ _id: device._id }, { $set: { "policy.policyId": policy.policyId, "policy.expectedHash": policy.hash } });
  const apps = await desiredAppsFor(device);
  res.json({
    deviceId: device._id,
    deviceName: device.name,
    credential,
    techSecret,
    techStepSeconds: 300,
    policy: { hash: policy.hash, settings: policy.settings },
    managedConfig: await managedConfigFor(device, apps, policy.settings),
    apps,
    serverTime: Date.now(),
  });
}));

/**
 * Heartbeat + work fetch. The device posts its state; the reply carries the
 * policy (when it changed), managed config, desired apps and any commands.
 */
router.post("/device/sync", deviceLimit, requireDevice(), wrap(async (req, res) => {
  const d = req.device;
  const b = req.body || {};
  const now = new Date();
  const t = b.telemetry;
  const set = { online: true, lastSeenAt: now };
  if (t) {
    set.telemetry = {
      battery: num(t.battery), charging: Boolean(t.charging), plugged: str(t.plugged, 16),
      storageFreeMb: num(t.storageFreeMb), storageTotalMb: num(t.storageTotalMb),
      ramFreeMb: num(t.ramFreeMb), ramTotalMb: num(t.ramTotalMb),
      networkType: str(t.networkType, 16), ssid: str(t.ssid, 64), signal: num(t.signal), ip: str(t.ip, 64),
      internetReachable: t.internetReachable !== false, uptimeSec: num(t.uptimeSec), lastBootReason: str(t.lastBootReason, 64),
      volume: num(t.volume), brightness: num(t.brightness), at: now,
    };
  }
  for (const k of ["androidVersion", "securityPatch", "agentVersion", "posVersion"]) if (b[k]) set[k] = str(b[k], 32);
  for (const k of ["agentVersionCode", "posVersionCode", "sdkInt"]) if (b[k] != null) set[k] = num(b[k]);
  if (Array.isArray(b.apps)) {
    set.apps = b.apps.slice(0, 300).map((a) => ({ packageName: str(a.packageName, 128), versionCode: num(a.versionCode), versionName: str(a.versionName, 64) }));
  }
  if (b.kiosk) {
    set["kiosk.state"] = ["locked", "unlocked", "technician", "lost", "error"].includes(b.kiosk.state) ? b.kiosk.state : "unknown";
    set["kiosk.error"] = str(b.kiosk.error, 300);
    set["kiosk.crashCount"] = num(b.kiosk.crashCount);
    set["kiosk.technicianUntil"] = b.kiosk.technicianUntil ? new Date(b.kiosk.technicianUntil) : undefined;
  }
  if (b.fcmToken) set.fcmToken = str(b.fcmToken, 300);

  const policy = await resolveForDevice({ ...d.toObject(), ...set });
  if (b.policy) {
    set["policy.appliedHash"] = str(b.policy.appliedHash, 32);
    set["policy.errors"] = (b.policy.errors || []).slice(0, 30).map((e) => str(e, 300));
    set["policy.appliedAt"] = b.policy.appliedAt ? new Date(b.policy.appliedAt) : undefined;
  }
  set["policy.policyId"] = policy.policyId;
  set["policy.expectedHash"] = policy.hash;
  const applied = b.policy?.appliedHash ?? d.policy?.appliedHash;
  set["policy.compliant"] = applied === policy.hash && !(b.policy?.errors?.length);

  if (b.location && policy.settings.location?.enabled) {
    set.location = { lat: num(b.location.lat), lng: num(b.location.lng), accuracy: num(b.location.accuracy), at: now };
  }
  const wasOffline = !d.online;
  const becameReady = Array.isArray(b.events) && b.events.some((e) => e.type === "ready");
  if (becameReady && d.lifecycle === "enrolled") {
    set.lifecycle = "active";
    set.readyAt = now;
  }
  await Device.updateOne({ _id: d._id }, { $set: set });
  if (set.telemetry) {
    Telemetry.create({
      ts: now, deviceId: d._id, battery: set.telemetry.battery, charging: set.telemetry.charging,
      storageFreeMb: set.telemetry.storageFreeMb, ramFreeMb: set.telemetry.ramFreeMb, networkType: set.telemetry.networkType,
      signal: set.telemetry.signal, internetReachable: set.telemetry.internetReachable, kiosk: set["kiosk.state"],
    }).catch(() => {});
  }
  if (wasOffline) deviceEvent(d._id, "online", "Device back online");
  for (const e of (b.events || []).slice(0, 50)) {
    await deviceEvent(d._id, str(e.type, 40), str(e.message, 500), { ...(e.data || {}), at: e.at });
  }

  const merged = { ...d.toObject(), ...set, apps: set.apps || d.apps };
  const store = d.storeId ? await Store.findById(d.storeId, { maintenanceWindow: 1, timezone: 1 }).lean() : null;
  const apps = await desiredAppsFor(merged);
  const reply = {
    serverTime: Date.now(),
    heartbeatSeconds: policy.settings.telemetry?.heartbeatSeconds || config.heartbeatSeconds,
    policyHash: policy.hash,
    managedConfig: await managedConfigFor(merged, apps, policy.settings),
    apps,
    maintenanceWindowOpen: store ? inWindow(store.maintenanceWindow?.start, store.maintenanceWindow?.end, store.timezone) : true,
    lostMode: d.lostMode?.enabled ? { message: d.lostMode.message, phone: d.lostMode.phone } : null,
    commands: await commands.pendingFor(d),
  };
  if (applied !== policy.hash || b.wantPolicy) reply.policy = { hash: policy.hash, settings: policy.settings };
  if (d.rotateCredential) {
    reply.newCredential = await issueCredential(d._id);
    await Device.updateOne({ _id: d._id }, { $set: { rotateCredential: false } });
    await deviceEvent(d._id, "credential_rotated", "New device credential issued");
  }
  res.json(reply);
}));

router.post("/device/commands/:cmdId", deviceLimit, requireDevice(), wrap(async (req, res) => {
  const r = await commands.report(req.device, req.params.cmdId, req.body || {});
  if (!r.ok) throw new HttpError(400, r.reason);
  const c = r.command;
  if (c && ["succeeded", "failed"].includes(c.status)) {
    await deviceEvent(req.device._id, `command_${c.status}`, `${c.type}${c.error ? `: ${c.error}` : ""}`, { cmdId: c.cmdId });
    // A confirmed wipe ends the device's access.
    if (c.type === "wipe" && c.status !== "failed") await revokeAll(req.device._id, "wiped");
    if (c.type === "lost_mode_off" && c.status === "succeeded") await Device.updateOne({ _id: req.device._id }, { $set: { "lostMode.enabled": false } });
  }
  res.json({ ok: true });
}));

/** Log/bug-report upload: raw body (text or zip), at most 50 MB. */
router.post("/device/logs", deviceLimit, requireDevice(),
  express.raw({ type: () => true, limit: "50mb" }),
  wrap(async (req, res) => {
    const kind = ["agent", "logcat", "bugreport", "crash"].includes(req.query.kind) ? req.query.kind : "agent";
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const ext = kind === "bugreport" ? "zip" : "txt";
    const file = path.join(LOG_DIR, `${req.device._id}-${kind}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${ext}`);
    fs.writeFileSync(file, req.body);
    const log = await DeviceLog.create({
      deviceId: req.device._id, commandId: str(req.query.cmdId, 64), kind, file, size: req.body.length,
      summary: kind === "crash" ? req.body.toString("utf8", 0, 300) : undefined,
    });
    await deviceEvent(req.device._id, "log_uploaded", `${kind} (${Math.round(req.body.length / 1024)} KB)`, { logId: log._id });
    res.status(201).json({ id: log._id });
  }));

router.get("/device/apps/:versionId/download", requireDevice(), wrap(async (req, res) => {
  const v = await AppVersion.findById(req.params.versionId).lean();
  if (!v || !fs.existsSync(v.file)) throw new HttpError(404, "not_found");
  res.type("application/vnd.android.package-archive");
  res.setHeader("X-Checksum-Sha256", v.sha256);
  res.sendFile(v.file);
}));

module.exports = { router };
