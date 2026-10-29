/**
 * Desired-state app management. Each sync the server says which version of
 * every managed app (agent, POS, companions) a device should run; the agent
 * installs whatever differs. Version source, most specific first:
 *   store pin -> running rollout the device is in -> the app's stable version.
 */
const crypto = require("crypto");
const config = require("../config");
const { App, AppVersion, Rollout, Store } = require("../models");

function bucket(rolloutId, deviceId) {
  return crypto.createHash("sha256").update(`${rolloutId}:${deviceId}`).digest().readUInt32BE(0) % 100;
}

/** Is the device inside the rollout's current stage? */
function inRollout(rollout, device) {
  if (rollout.storeIds?.length && !rollout.storeIds.some((s) => String(s) === String(device.storeId))) return false;
  if (rollout.stage === "all") return true;
  if (device.pilot) return true;
  if (rollout.stage === "percent") return bucket(rollout._id, device._id) < rollout.percent;
  return false;
}

async function desiredAppsFor(device) {
  const apps = await App.find({ role: { $in: ["agent", "pos", "companion"] } }).lean();
  if (!apps.length) return [];
  const [store, rollouts] = await Promise.all([
    device.storeId ? Store.findById(device.storeId, { appPins: 1 }).lean() : null,
    Rollout.find({ appId: { $in: apps.map((a) => a._id) }, status: { $in: ["running", "paused"] } }).lean(),
  ]);
  const installed = new Map((device.apps || []).map((a) => [a.packageName, a.versionCode]));
  const picks = [];
  for (const app of apps) {
    let versionId = null;
    let source = "stable";
    let respectWindow = true;
    const pin = store?.appPins?.find((p) => p.packageName === app.packageName);
    if (pin) {
      versionId = pin.versionId;
      source = "pin";
    } else {
      const r = rollouts.find((x) => String(x.appId) === String(app._id));
      if (r) {
        const target = await AppVersion.findById(r.versionId, { versionCode: 1 }).lean();
        // A paused rollout adds no new devices but keeps the ones already on it.
        const member = r.status === "running" ? inRollout(r, device) : installed.get(app.packageName) === target?.versionCode;
        if (member) {
          versionId = r.versionId;
          source = `rollout:${r._id}`;
          respectWindow = r.respectMaintenanceWindow;
        }
      }
      if (!versionId) versionId = app.currentVersionId;
    }
    if (!versionId) continue;
    picks.push({ versionId, source, respectWindow, app });
  }
  const versions = await AppVersion.find({ _id: { $in: picks.map((p) => p.versionId) } }).lean();
  return picks.map((p) => {
    const v = versions.find((x) => String(x._id) === String(p.versionId));
    if (!v) return null;
    return {
      packageName: v.packageName,
      role: p.app.role,
      versionId: String(v._id),
      versionCode: v.versionCode,
      versionName: v.versionName,
      sha256: v.sha256,
      size: v.size,
      url: `${config.publicUrl}/device/apps/${v._id}/download`,
      source: p.source,
      respectMaintenanceWindow: p.respectWindow,
    };
  }).filter(Boolean);
}

module.exports = { desiredAppsFor, inRollout, bucket };
