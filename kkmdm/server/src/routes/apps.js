const express = require("express");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { App, AppVersion, Rollout, Device } = require("../models");
const { wrap, HttpError } = require("../lib/http");
const { requirePerm } = require("../lib/adminAuth");
const { inspectApk } = require("../lib/apk");
const { AGENT_FILE, localAgentInfo } = require("../lib/agentApk");
const { inRollout } = require("../lib/desiredApps");
const { audit } = require("../lib/audit");
const push = require("../lib/push");

const router = express.Router();
const APK_DIR = path.join(config.storageDir, "apks");

function roleFor(pkg) {
  if (pkg === config.agentPackage) return "agent";
  if (pkg === config.posPackage) return "pos";
  return "companion";
}

async function wakeFleet() {
  const ds = await Device.find({ lifecycle: { $in: ["enrolled", "active"] } }, { _id: 1 }).lean();
  ds.forEach((d) => push.wake(d._id));
}

router.get("/", requirePerm("apps.view"), wrap(async (req, res) => {
  const apps = await App.find().sort({ role: 1, packageName: 1 }).lean();
  const versions = await AppVersion.find().sort({ versionCode: -1 }).populate("uploadedBy", "email").lean();
  const fleet = await Device.aggregate([
    { $match: { lifecycle: { $ne: "retired" } } },
    { $unwind: "$apps" },
    { $group: { _id: { p: "$apps.packageName", v: "$apps.versionCode" }, n: { $sum: 1 } } },
  ]);
  res.json({
    items: apps.map((a) => ({
      ...a,
      versions: versions.filter((v) => String(v.appId) === String(a._id)).map((v) => ({
        ...v, file: undefined,
        installedOn: fleet.find((f) => f._id.p === a.packageName && f._id.v === v.versionCode)?.n || 0,
      })),
    })),
  });
}));

/**
 * Upload: raw APK body (Content-Type application/vnd.android.package-archive).
 * The package, version and signing cert come from the APK itself and the
 * v2/v3 signature is verified before anything is stored.
 */
router.post("/upload", requirePerm("apps.manage"),
  express.raw({ type: ["application/vnd.android.package-archive", "application/octet-stream"], limit: "300mb" }),
  wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) throw new HttpError(400, "apk_body_required");
    let info;
    try {
      info = inspectApk(req.body);
    } catch (err) {
      await audit(req, "app.upload_rejected", { details: { reason: err.message } });
      throw new HttpError(400, "invalid_apk", err.message);
    }
    let app = await App.findOne({ packageName: info.packageName });
    if (app?.signingCertSha256 && app.signingCertSha256 !== info.signingCertSha256) {
      await audit(req, "app.upload_rejected", { details: { packageName: info.packageName, reason: "signing certificate changed" } });
      throw new HttpError(400, "signature_mismatch", "Signed with a different certificate than earlier versions; Android would refuse the update.");
    }
    if (await AppVersion.exists({ packageName: info.packageName, versionCode: info.versionCode })) {
      throw new HttpError(409, "version_exists", `${info.packageName} versionCode ${info.versionCode} is already uploaded`);
    }
    if (!app) {
      app = await App.create({
        packageName: info.packageName,
        name: req.query.name || info.packageName,
        role: roleFor(info.packageName),
        signingCertSha256: info.signingCertSha256,
      });
    }
    fs.mkdirSync(APK_DIR, { recursive: true });
    const file = path.join(APK_DIR, `${info.packageName}-${info.versionCode}-${info.sha256.slice(0, 12)}.apk`);
    fs.writeFileSync(file, req.body);
    const v = await AppVersion.create({
      appId: app._id, packageName: info.packageName, versionCode: info.versionCode, versionName: info.versionName,
      label: req.query.label, minSdk: info.minSdk, targetSdk: info.targetSdk, sha256: info.sha256, size: info.size,
      signingCertSha256: info.signingCertSha256, signatureScheme: info.signatureScheme, file, uploadedBy: req.admin._id,
    });
    // The newest agent upload is also what QR provisioning downloads, so a
    // fresh server needs nothing copied onto it by hand.
    if (info.packageName === config.agentPackage) {
      const current = localAgentInfo();
      if (!current || info.versionCode > current.versionCode) {
        fs.mkdirSync(path.dirname(AGENT_FILE), { recursive: true });
        fs.copyFileSync(file, AGENT_FILE);
      }
    }
    await audit(req, "app.version_uploaded", { targetType: "app_version", targetId: v._id, details: { packageName: v.packageName, versionCode: v.versionCode, sha256: v.sha256 } });
    res.status(201).json({ app, version: { ...v.toObject(), file: undefined } });
  }));

router.patch("/:id", requirePerm("apps.manage"), wrap(async (req, res) => {
  const app = await App.findById(req.params.id);
  if (!app) throw new HttpError(404, "not_found");
  if (req.body.name) app.name = req.body.name;
  if (req.body.role && ["companion", "other"].includes(req.body.role) && !["agent", "pos"].includes(app.role)) app.role = req.body.role;
  await app.save();
  await audit(req, "app.updated", { targetType: "app", targetId: app._id, details: req.body });
  res.json({ app });
}));

/** Makes a version the fleet's stable version at once (no staging). */
router.post("/:id/set-current", requirePerm("rollouts.manage"), wrap(async (req, res) => {
  const app = await App.findById(req.params.id);
  const v = await AppVersion.findOne({ _id: req.body.versionId, appId: req.params.id });
  if (!app || !v) throw new HttpError(404, "not_found");
  const previous = app.currentVersionId;
  app.currentVersionId = v._id;
  await app.save();
  await wakeFleet();
  await audit(req, "app.current_set", { targetType: "app", targetId: app._id, details: { versionCode: v.versionCode, previous } });
  res.json({ ok: true });
}));

// ---------------- Rollouts ----------------

async function rolloutProgress(r) {
  const target = await AppVersion.findById(r.versionId, { versionCode: 1 }).lean();
  const devices = await Device.find({ lifecycle: { $in: ["enrolled", "active"] } }, { _id: 1, pilot: 1, storeId: 1, apps: 1 }).lean();
  const targeted = devices.filter((d) => inRollout(r, d));
  const updated = targeted.filter((d) => d.apps?.some((a) => a.packageName === r.packageName && a.versionCode === target?.versionCode));
  return { fleet: devices.length, targeted: targeted.length, updated: updated.length };
}

router.get("/rollouts/all", requirePerm("apps.view"), wrap(async (req, res) => {
  const rows = await Rollout.find().sort({ createdAt: -1 }).limit(100).populate("versionId", "versionCode versionName").populate("previousVersionId", "versionCode versionName").lean();
  const items = [];
  for (const r of rows) items.push({ ...r, progress: ["running", "paused"].includes(r.status) ? await rolloutProgress(r) : null });
  res.json({ items });
}));

router.post("/rollouts", requirePerm("rollouts.manage"), wrap(async (req, res) => {
  const v = await AppVersion.findById(req.body.versionId);
  if (!v) throw new HttpError(400, "bad_version");
  const app = await App.findById(v.appId);
  if (await Rollout.exists({ appId: app._id, status: { $in: ["running", "paused"] } })) throw new HttpError(409, "rollout_already_active");
  const r = await Rollout.create({
    appId: app._id, packageName: app.packageName, versionId: v._id, previousVersionId: app.currentVersionId,
    stage: "pilot", percent: 0, storeIds: req.body.storeIds || [],
    respectMaintenanceWindow: req.body.respectMaintenanceWindow !== false, createdBy: req.admin._id,
    history: [{ at: new Date(), action: "started (pilot)", by: req.admin.email }],
  });
  await wakeFleet();
  await audit(req, "rollout.started", { targetType: "rollout", targetId: r._id, details: { packageName: app.packageName, versionCode: v.versionCode } });
  res.status(201).json({ rollout: r });
}));

/** action: advance {percent} | all | pause | resume | complete | rollback */
router.post("/rollouts/:id/:action", requirePerm("rollouts.manage"), wrap(async (req, res) => {
  const r = await Rollout.findById(req.params.id);
  if (!r) throw new HttpError(404, "not_found");
  const { action } = req.params;
  const active = ["running", "paused"].includes(r.status);
  if (!active) throw new HttpError(409, "rollout_finished");
  if (action === "advance") {
    const pct = Math.min(Math.max(Number(req.body.percent) || 10, 1), 100);
    r.stage = pct >= 100 ? "all" : "percent";
    r.percent = pct;
  } else if (action === "all") {
    r.stage = "all";
    r.percent = 100;
  } else if (action === "pause") r.status = "paused";
  else if (action === "resume") r.status = "running";
  else if (action === "complete") {
    r.status = "completed";
    await App.updateOne({ _id: r.appId }, { $set: { currentVersionId: r.versionId } });
  } else if (action === "rollback") {
    r.status = "rolled_back";
    // Devices fall back to the stable version, which never moved.
  } else throw new HttpError(400, "bad_action");
  r.history.push({ at: new Date(), action: action === "advance" ? `advance to ${r.percent}%` : action, by: req.admin.email });
  await r.save();
  await wakeFleet();
  await audit(req, `rollout.${action}`, { targetType: "rollout", targetId: r._id, details: { stage: r.stage, percent: r.percent } });
  res.json({ rollout: r, progress: await rolloutProgress(r) });
}));

module.exports = { router };
