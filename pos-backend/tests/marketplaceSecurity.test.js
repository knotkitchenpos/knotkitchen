/**
 * The marketplace webhook used to accept any body from anyone and announce
 * the order to every connected till of every restaurant. Now:
 *   - the bridge must send x-marketplace-secret matching MARKETPLACE_WEBHOOK_SECRET
 *   - no secret configured = the webhook is closed
 *   - a new order is announced only to its own restaurant's tills
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

const load = (secret) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../config/config") return { marketplaceWebhookSecret: secret };
    if (r === "../models/orderModel") return function Order() {};
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../controllers/marketplaceController")];
  const ctrl = require("../controllers/marketplaceController");
  Module._load = orig;
  return ctrl;
};

const call = async (fn, req) => {
  let status = null;
  let err = null;
  const res = { status: (c) => ((status = c), res), json: () => {} };
  await fn(req, res, (e) => (err = e));
  return { status, err };
};

test("webhook is closed when no secret is configured", async () => {
  const { webhookMarketplaceOrder } = load("");
  const { err } = await call(webhookMarketplaceOrder, { headers: {}, body: { order: {} } });
  assert.equal(err?.status, 503);
});

test("webhook rejects a wrong or missing secret", async () => {
  const { webhookMarketplaceOrder } = load("s3cret");
  assert.equal((await call(webhookMarketplaceOrder, { headers: {}, body: { order: {} } })).err?.status, 401);
  assert.equal(
    (await call(webhookMarketplaceOrder, { headers: { "x-marketplace-secret": "wrong!" }, body: { order: {} } })).err?.status,
    401,
  );
});

test("webhook with the right secret still needs a restaurantId", async () => {
  const { webhookMarketplaceOrder } = load("s3cret");
  const { err } = await call(webhookMarketplaceOrder, {
    headers: { "x-marketplace-secret": "s3cret" },
    body: { order: { items: [] } },
  });
  assert.equal(err?.status, 400);
});

test("a new order is announced only to its own restaurant", () => {
  const { sseClients, broadcastNewOrder } = load("s3cret");
  const heard = [];
  const client = (restaurantId) => ({ restaurantId, res: { write: (d) => heard.push([restaurantId, d]), end() {} } });
  sseClients.add(client("aaa"));
  sseClients.add(client("bbb"));
  broadcastNewOrder({ restaurantId: "aaa", orderNumber: 1 });
  assert.deepEqual(heard.map(([r]) => r), ["aaa"]);
});

test("unscoped inline routes are not mounted", () => {
  const fs = require("fs");
  const path = require("path");
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  for (const p of ["loyalty", "analytics", "notification", "offline", "plugin"]) {
    assert.ok(!app.includes(`app.use("/api/${p}"`), `/api/${p} must stay unmounted until tenant-scoped`);
  }
});
