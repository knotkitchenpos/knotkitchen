/**
 * services/storageWatch: CSD admins hear when the disk is filling, once a day.
 * Uses a real database when KK_TEST_MONGO_URI is set; skipped otherwise.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const URI = process.env.KK_TEST_MONGO_URI;

test("storage watch", { skip: !URI && "set KK_TEST_MONGO_URI to run" }, async (t) => {
  await mongoose.connect(URI, { dbName: `kk_storage_watch_test_${process.pid}` });
  const db = mongoose.connection.db;
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  await db.collection("csdstaffs").insertMany([
    { role: "admin", status: "active" },
    { role: "staff", status: "active" },
    { role: "admin", status: "disabled" },
  ]);
  const { check } = require("../services/storageWatch");
  const sent = [];
  const notify = async (msg, opts) => { sent.push({ msg, opts }); };
  const full = (pct) => () => ({ total: 100 * 1024 ** 3, free: (100 - pct) * 1024 ** 3, usedPct: pct });
  const now = Date.now();

  await t.test("below the line: nothing is sent", async () => {
    const r = await check({ db, disk: full(60), notify, now });
    assert.equal(r.warned, false);
    assert.equal(sent.length, 0);
  });

  await t.test("at 80%: active admins only are told, with the numbers", async () => {
    const r = await check({ db, disk: full(80), notify, now });
    assert.equal(r.warned, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].msg.title, /80% full/);
    assert.match(sent[0].msg.body, /20\.0 GB free of 100\.0 GB/);
    assert.equal(sent[0].opts.staffIds.length, 1);
  });

  await t.test("not again the same day, again the next", async () => {
    await check({ db, disk: full(82), notify, now: now + 60 * 60 * 1000 });
    assert.equal(sent.length, 1);
    await check({ db, disk: full(82), notify, now: now + 25 * 60 * 60 * 1000 });
    assert.equal(sent.length, 2);
  });
});
