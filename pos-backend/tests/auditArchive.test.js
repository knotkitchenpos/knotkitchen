/**
 * services/auditArchive against a real MongoDB: old entries move (never get
 * lost or duplicated), recent ones stay, and the CSD read helpers see both.
 *
 * Needs a database: set KK_TEST_MONGO_URI (e.g. mongodb://127.0.0.1:27017).
 * Skipped without one, so CI (no database) is unaffected. Uses its own
 * throwaway database and drops it afterwards.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { MongoClient, ObjectId } = require("mongodb");

const URI = process.env.KK_TEST_MONGO_URI;
const DB = `kk_audit_archive_test_${process.pid}`;

test("audit archive", { skip: !URI && "set KK_TEST_MONGO_URI to run" }, async (t) => {
  const client = await MongoClient.connect(URI);
  const db = client.db(DB);
  const { archiveOldAuditLogs, findAcrossArchive, countAcrossArchive, distinctAcrossArchive, ARCHIVE } = require("../services/auditArchive");
  const day = 864e5;
  const now = Date.now();
  const rows = [];
  for (let i = 0; i < 1203; i++) rows.push({ _id: new ObjectId(), storeId: "100001", role: i % 3 ? "Owner" : "csd:admin", action: i % 2 ? "Accessed Reports" : "CSD_LOGIN", timestamp: new Date(now - (200 - (i % 200)) * day) });
  await db.collection("auditlogs").insertMany(rows);
  const old = rows.filter((r) => r.timestamp < new Date(now - 90 * day)).length;

  t.after(async () => { await db.dropDatabase(); await client.close(); });

  await t.test("moves only entries older than 90 days, in batches", async () => {
    const moved = await archiveOldAuditLogs({ now, db });
    assert.equal(moved, old);
    assert.equal(await db.collection("auditlogs").countDocuments(), rows.length - old);
    assert.equal(await db.collection(ARCHIVE).countDocuments(), old);
  });

  await t.test("the archive is zstd-compressed with two indexes", async () => {
    const [info] = await db.listCollections({ name: ARCHIVE }).toArray();
    assert.match(JSON.stringify(info.options), /zstd/);
    assert.equal((await db.collection(ARCHIVE).indexes()).length, 3); // _id + 2
  });

  await t.test("a second run moves nothing and duplicates nothing", async () => {
    assert.equal(await archiveOldAuditLogs({ now, db }), 0);
    assert.equal(await db.collection(ARCHIVE).countDocuments(), old);
  });

  await t.test("an interrupted run (copied but not deleted) is finished, not duplicated", async () => {
    const extra = { _id: new ObjectId(), storeId: "100001", role: "Owner", action: "X", timestamp: new Date(now - 300 * day) };
    await db.collection("auditlogs").insertOne(extra);
    await db.collection(ARCHIVE).insertOne(extra); // as if the delete never ran
    assert.equal(await archiveOldAuditLogs({ now, db }), 1);
    assert.equal(await db.collection(ARCHIVE).countDocuments({ _id: extra._id }), 1);
    assert.equal(await db.collection("auditlogs").countDocuments({ _id: extra._id }), 0);
  });

  await t.test("CSD reads see the live entries and the archive as one, newest first", async () => {
    const match = { role: /^csd:/ };
    const total = await countAcrossArchive({ match, db });
    assert.equal(total, rows.filter((r) => r.role === "csd:admin").length);
    const page = await findAcrossArchive({ match, skip: 0, limit: 500, db });
    assert.equal(page.length, Math.min(500, total));
    for (let i = 1; i < page.length; i++) assert.ok(page[i - 1].timestamp >= page[i].timestamp);
    const last = await findAcrossArchive({ match, skip: total - 3, limit: 50, db });
    assert.equal(last.length, 3);
    assert.ok(last[2].timestamp < new Date(now - 90 * day), "the oldest come from the archive");
    assert.deepEqual((await distinctAcrossArchive({ field: "action", match, db })).sort(), ["Accessed Reports", "CSD_LOGIN"].filter((a) => rows.some((r) => r.role === "csd:admin" && r.action === a)).sort());
  });
});
