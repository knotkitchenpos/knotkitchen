const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { splitShares } = require("../services/recharge");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("a shared top-up credits each store what it was given; a short payment is shared in proportion, never more than paid", () => {
  const splits = [{ amountPaise: 300000 }, { amountPaise: 150000 }, { amountPaise: 50000 }];
  assert.deepEqual(splitShares(500000, splits), [300000, 150000, 50000]);
  const short = splitShares(499999, splits);
  assert.equal(short.reduce((a, b) => a + b, 0), 499999, "every paisa paid is credited, no more");
  assert.deepEqual(short.slice(0, 2), [299999, 149999]);
});

test("wiring: each share has its own idempotency key and store; only the partner who opened it can verify it", () => {
  const svc = src("services/recharge.js");
  assert.match(svc, /if \(intent\.purpose === "SPLIT"\) \{/);
  assert.match(svc, /idempotencyKey: `\$\{idempotencyKeyFor\(gatewayOrderId\)\}-\$\{split\.restaurantId\}`/);
  assert.match(svc, /restaurantId: split\.restaurantId,\n\s+kind: "RECHARGE"/);
  // Every store is held to its own minimum and closed state.
  assert.match(svc, /for \(const x of list\) \{\n\s+if \(await closedForTopUp\(x\.restaurantId\)\)/);
  assert.match(svc, /await minimumTopUpPaise\(x\.restaurantId\)/);
  const routes = src("routes/partnerRoute.js");
  assert.match(routes, /RechargeOrder\.findOne\(\{ gatewayOrderId, purpose: "SPLIT", partnerId: req\.partner\._id \}\)/);
  assert.match(routes, /const owner = await ownerForLink\(await linkFor\(req\.partner, x\?\.storeId\)\);/);
});
