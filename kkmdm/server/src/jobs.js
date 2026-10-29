/** Background sweeps. Each runs on its own timer and never overlaps itself. */
const config = require("./config");
const { Device, Telemetry, TelemetryDaily } = require("./models");
const commands = require("./lib/commands");
const alerts = require("./lib/alerts");
const push = require("./lib/push");
const { deviceEvent } = require("./lib/audit");
const { syncStores } = require("./lib/storeSync");

function every(ms, name, fn) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (err) {
      console.error(`[job:${name}]`, err.message);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5000).unref();
  return setInterval(tick, ms).unref();
}

async function offlineSweep() {
  const cutoff = new Date(Date.now() - config.offlineAfterSeconds * 1000);
  const stale = await Device.find({ online: true, lastSeenAt: { $lt: cutoff } }, { _id: 1 }).lean();
  for (const d of stale) {
    if (push.isConnected(d._id)) continue;
    await Device.updateOne({ _id: d._id }, { $set: { online: false } });
    await deviceEvent(d._id, "offline", "No heartbeat");
  }
}

/** Rolls yesterday's raw telemetry into one row per device, kept past the 90-day raw TTL. */
async function rollupYesterday() {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - 86400e3);
  const day = start.toISOString().slice(0, 10);
  const rows = await Telemetry.aggregate([
    { $match: { ts: { $gte: start, $lt: end } } },
    { $group: { _id: "$deviceId", samples: { $sum: 1 }, batteryMin: { $min: "$battery" }, batteryAvg: { $avg: "$battery" }, offlineSamples: { $sum: { $cond: [{ $eq: ["$internetReachable", false] }, 1, 0] } } } },
  ]);
  for (const r of rows) {
    await TelemetryDaily.updateOne({ deviceId: r._id, day }, { $set: { samples: r.samples, batteryMin: r.batteryMin, batteryAvg: Math.round(r.batteryAvg ?? 0), offlineSamples: r.offlineSamples } }, { upsert: true });
  }
}

function start() {
  every(30_000, "offline", offlineSweep);
  every(60_000, "expire-commands", commands.expireOld);
  every(60_000, "alerts", () => alerts.evaluate());
  every(3600_000, "telemetry-rollup", rollupYesterday);
  if (config.knotkitchenMongoUri) every(6 * 3600_000, "store-sync", syncStores);
}

module.exports = { start, offlineSweep, rollupYesterday };
