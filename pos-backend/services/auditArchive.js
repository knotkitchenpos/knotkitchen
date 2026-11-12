/**
 * Audit log archive.
 *
 * The live auditlogs collection keeps the last 90 days (AUDIT_HOT_DAYS). Every
 * night, older entries are MOVED, not deleted, to auditlogs_archive: a
 * zstd-compressed collection with only the two indexes its readers use,
 * instead of the six the live collection keeps. Nothing is lost, and CSD's
 * activity views read both (see archivedAuditQuery below).
 *
 * The move is copy-then-delete, by _id, in small batches: if it stops halfway
 * the next run finishes it, and an entry already copied is skipped, never
 * duplicated.
 */
const mongoose = require("mongoose");

const ARCHIVE = "auditlogs_archive";
const HOT_DAYS = Number(process.env.AUDIT_HOT_DAYS) || 90;
const BATCH = 500;
const DAY = 24 * 60 * 60 * 1000;

const cutoff = (now = Date.now()) => new Date(now - HOT_DAYS * DAY);

const ensured = new WeakMap(); // db -> Promise<archive collection>
const ensureArchive = (db = mongoose.connection.db) => {
  if (!ensured.has(db)) {
    ensured.set(db, (async () => {
      const exists = await db.listCollections({ name: ARCHIVE }, { nameOnly: true }).toArray();
      if (!exists.length) {
        await db.createCollection(ARCHIVE, {
          storageEngine: { wiredTiger: { configString: "block_compressor=zstd" } },
        });
      }
      const col = db.collection(ARCHIVE);
      await col.createIndex({ storeId: 1, timestamp: -1 });
      await col.createIndex({ role: 1, timestamp: -1 });
      return col;
    })().catch((err) => {
      ensured.delete(db);
      throw err;
    }));
  }
  return ensured.get(db);
};

/** Moves entries older than the cutoff. Returns how many moved. */
const archiveOldAuditLogs = async ({ now = Date.now(), db = mongoose.connection.db } = {}) => {
  const archive = await ensureArchive(db);
  const live = db.collection("auditlogs");
  const before = cutoff(now);
  let moved = 0;
  for (;;) {
    const batch = await live.find({ timestamp: { $lt: before } }).sort({ timestamp: 1 }).limit(BATCH).toArray();
    if (!batch.length) break;
    try {
      await archive.insertMany(batch, { ordered: false });
    } catch (err) {
      // 11000 = already in the archive from an earlier, interrupted run.
      const others = (err.writeErrors || []).filter((e) => (e.code ?? e.err?.code) !== 11000);
      if (!err.writeErrors || others.length) throw err;
    }
    // Delete only what is now safely in the archive.
    const ids = batch.map((d) => d._id);
    const copied = await archive.find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray();
    const res = await live.deleteMany({ _id: { $in: copied.map((d) => d._id) } });
    moved += res.deletedCount;
    if (copied.length < ids.length) break; // something did not copy: stop, retry next run
  }
  return moved;
};

/**
 * Read helper for the CSD views: the live collection and the archive as one,
 * newest first. `match` is a plain Mongo filter.
 */
const findAcrossArchive = async ({ match, skip = 0, limit = 50, db = mongoose.connection.db }) => {
  const archive = await ensureArchive(db);
  const live = db.collection("auditlogs");
  const want = skip + limit;
  const [hot, cold] = await Promise.all([
    live.find(match).sort({ timestamp: -1 }).limit(want).toArray(),
    archive.find(match).sort({ timestamp: -1 }).limit(want).toArray(),
  ]);
  return [...hot, ...cold]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(skip, skip + limit);
};

const countAcrossArchive = async ({ match, db = mongoose.connection.db }) => {
  const archive = await ensureArchive(db);
  const [a, b] = await Promise.all([
    db.collection("auditlogs").countDocuments(match),
    archive.countDocuments(match),
  ]);
  return a + b;
};

const distinctAcrossArchive = async ({ field, match, db = mongoose.connection.db }) => {
  const archive = await ensureArchive(db);
  const [a, b] = await Promise.all([
    db.collection("auditlogs").distinct(field, match),
    archive.distinct(field, match),
  ]);
  return [...new Set([...a, ...b])];
};

let timer = null;
const startAuditArchiveScheduler = () => {
  if (timer) return;
  const run = () =>
    archiveOldAuditLogs()
      .then((n) => { if (n) console.log(`[audit-archive] moved ${n} entries older than ${HOT_DAYS} days`); })
      .catch((err) => console.error("[audit-archive] failed:", err.message));
  // Once shortly after start, then every 6 hours. Cheap when there is nothing to move.
  setTimeout(run, 2 * 60 * 1000).unref();
  timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref();
};

module.exports = {
  ARCHIVE,
  HOT_DAYS,
  cutoff,
  archiveOldAuditLogs,
  findAcrossArchive,
  countAcrossArchive,
  distinctAcrossArchive,
  startAuditArchiveScheduler,
};
