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
