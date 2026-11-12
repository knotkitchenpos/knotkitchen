/**
 * Warns CSD admins before the server disk fills.
 *
 * Orders and reports stay on the server for good (owner's decision,
 * 2026-11-12), so disk use only grows. Every six hours this reads how full
 * the disk is and how big the database is; at STORAGE_WARN_PCT (default 75%)
 * it pushes a notification to CSD admins, at most once a day (the last send
 * is kept in the database, so a restart does not repeat it).
 */
const fs = require("fs");
const mongoose = require("mongoose");

const WARN_PCT = Number(process.env.STORAGE_WARN_PCT) || 75;
const DAY = 24 * 60 * 60 * 1000;
const MARK = "storage_watch";

const diskUsage = (path = "/") => {
  const s = fs.statfsSync(path);
  const total = s.blocks * s.bsize;
  const free = s.bavail * s.bsize;
  return { total, free, usedPct: total ? Math.round(((total - free) / total) * 100) : 0 };
};

const gb = (n) => `${(n / 1024 ** 3).toFixed(1)} GB`;

const check = async ({ db = mongoose.connection.db, disk = diskUsage, notify, now = Date.now() } = {}) => {
  const d = disk();
  const stats = await db.stats();
  const dbBytes = (stats.storageSize || 0) + (stats.indexSize || 0);
  const summary = { usedPct: d.usedPct, free: d.free, total: d.total, dbBytes };
  if (d.usedPct < WARN_PCT) return { ...summary, warned: false };

  const marks = db.collection(MARK);
  const last = await marks.findOne({ _id: "disk" });
  if (last && now - new Date(last.sentAt).getTime() < DAY) return { ...summary, warned: false, recent: true };

  const send = notify || require("./csdPush").notify;
  const CsdStaff = require("../models/csdStaffModel");
  const admins = await CsdStaff.find({ role: "admin", status: "active" }, { _id: 1 }).lean();
  await send(
    {
      title: `Server storage ${d.usedPct}% full`,
      body: `${gb(d.free)} free of ${gb(d.total)}. The database is ${gb(dbBytes)}. Time to add disk or move old data to the archive.`,
      url: "/",
      tag: "storage-watch",
    },
    { staffIds: admins.map((a) => a._id) },
  );
  await marks.updateOne({ _id: "disk" }, { $set: { sentAt: new Date(now), usedPct: d.usedPct } }, { upsert: true });
  console.warn(`[storage] disk ${d.usedPct}% full, ${gb(d.free)} free; CSD admins notified`);
  return { ...summary, warned: true };
};

let timer = null;
const startStorageWatch = () => {
  if (timer) return;
  const run = () =>
    check()
      .then((r) => console.log(`[storage] disk ${r.usedPct}% used, ${gb(r.free)} free, database ${gb(r.dbBytes)}`))
      .catch((err) => console.error("[storage] check failed:", err.message));
  setTimeout(run, 3 * 60 * 1000).unref();
  timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref();
};

module.exports = { check, diskUsage, startStorageWatch, WARN_PCT };
