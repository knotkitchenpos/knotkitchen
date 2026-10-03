/**
 * The marketplace webhook used to accept any body from anyone and announce
 * the order to every connected till of every restaurant. Now:
 *   - the bridge must send x-marketplace-secret matching MARKETPLACE_WEBHOOK_SECRET
 *   - no secret configured = the webhook is closed
 *   - a new order is announced only to its own restaurant's tills
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { AWAITING_ACCEPTANCE } = require("../constants/orderStatus");

const load = (secret, Order = function Order() {}) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../config/config") return { marketplaceWebhookSecret: secret };
    if (r === "../models/orderModel") return Order;
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

test("SECURITY: a manual order takes only the order's details from the body", async () => {
  // A spread body could stamp a "paid" platform fee that a cancel then
  // credits to the wallet, or hide a table's real fee behind a fake one.
  const made = [];
  function Order(doc) {
    made.push(doc);
    this.save = async () => {};
  }
  const { manualMarketplaceOrder, webhookMarketplaceOrder } = load("s3cret", Order);
  const forged = {
    bills: { totalWithTax: 50, platformFee: 999 },
    platformCharge: { status: "PAID", totalPaise: 10000000 },
    tableSessionId: "64c000000000000000000001",
    source: "QR",
    orderStatus: "Completed",
    paymentData: { gatewayOrderId: "x" },
    payments: [{ status: "paid", amount: 50 }],
    idempotencyKey: "k",
    restaurantId: "someone-else",
  };
  const { status, err } = await call(manualMarketplaceOrder, {
    user: { _id: "u1", restaurantId: "r1" },
    body: { items: [{ name: "Naan", quantity: 1, price: 50, total: 50 }], ...forged },
  });
  assert.equal(err, null);
  assert.equal(status, 201);
  const [doc] = made;
  assert.deepEqual(doc.bills, { totalWithTax: 50 });
  for (const k of ["platformCharge", "tableSessionId", "source", "paymentData", "payments", "idempotencyKey"]) {
    assert.equal(doc[k], undefined, k);
  }
  assert.deepEqual([doc.orderStatus, doc.restaurantId, doc.marketplace, doc.items.length], [AWAITING_ACCEPTANCE, "r1", "Manual", 1]);

  // The bridge is trusted with the order, never with KnotKitchen's fee.
  await call(webhookMarketplaceOrder, {
    headers: { "x-marketplace-secret": "s3cret" },
    body: { order: { ...forged, restaurantId: "64b000000000000000000001" } },
  });
  assert.equal(made[1].platformCharge, undefined);
  assert.equal(made[1].bills.platformFee, 0);
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
  for (const p of ["loyalty", "analytics", "notification", "plugin"]) {
    assert.ok(!app.includes(`app.use("/api/${p}"`), `/api/${p} must stay unmounted until tenant-scoped`);
  }
});
