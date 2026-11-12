const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("offline sync goes through the live addOrder and dedupes on the offline key", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "routes", "offlineRoute.js"), "utf8");
  assert.match(src, /const \{ addOrder \} = require\("\.\.\/controllers\/orderController"\)/);
  assert.match(src, /const key = `offline:\$\{localId\}`/);
  assert.match(src, /idempotencyKey: key/);
  assert.ok(!/req\.body\.restaurantId|offlineOrder\.restaurantId/.test(src), "never trusts a restaurantId from the client");
  assert.ok(!/findByIdAndUpdate\(orderId, clientOrderData/.test(src), "the client-wins conflict endpoint is gone");
});

test("a synced offline sale keeps the time it was taken (createdAt, clocks, timeline)", () => {
  const { backdate } = require("../routes/offlineRoute");
  const synced = new Date(Date.now() - 1000);
  const placed = new Date(synced.getTime() - 3600000);
  const set = backdate(
    { createdAt: synced, readyDueAt: new Date(synced.getTime() + 20 * 60000), completeDueAt: null, timeline: [{ status: "Completed", timestamp: synced }] },
    placed.toISOString(),
  );
  assert.equal(set.createdAt.getTime(), placed.getTime());
  assert.equal(set.orderDate.getTime(), placed.getTime());
  assert.equal(set.readyDueAt.getTime(), placed.getTime() + 20 * 60000);
  assert.equal(set["timeline.0.timestamp"].getTime(), placed.getTime());
  assert.ok(!("completeDueAt" in set));
  // A clock in the future or a week old is not trusted: only the flags are set.
  assert.deepEqual(backdate({ createdAt: synced }, new Date(Date.now() + 60000).toISOString()), { isOffline: true, syncStatus: "synced" });
  assert.deepEqual(backdate({ createdAt: synced }, "nonsense"), { isOffline: true, syncStatus: "synced" });
  // Written past Mongoose, which drops createdAt from an update.
  const src = fs.readFileSync(path.join(__dirname, "..", "routes", "offlineRoute.js"), "utf8");
  assert.match(src, /Order\.collection\.updateOne\(\{ _id: created\._id \}, \{ \$set: backdate\(created, entry\.placedAt\) \}\)/);
});
