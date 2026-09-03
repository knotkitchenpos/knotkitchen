/**
 * Items added to a table that is already mid-meal.
 *
 * Every QR submission used to call Order.create, so a diner ordering a second
 * round got a SECOND kitchen order for one table — two tickets and two POS
 * cards against a single bill. The spec is explicit that additions must update
 * the existing order and never create a new one.
 *
 * Additions now land on that order as item.status "pending" so the till can
 * review just what was added, and PUT /online-orders/:id/items resolves them.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const RESTAURANT_ID = new mongoose.Types.ObjectId().toString();
const ORDER_ID = new mongoose.Types.ObjectId().toString();
const user = { _id: new mongoose.Types.ObjectId().toString(), role: "Owner", restaurantId: RESTAURANT_ID, storeId: "123456" };

/** An order already in the kitchen, plus two items a diner just added. */
const makeOrder = () => ({
  _id: ORDER_ID,
  restaurantId: RESTAURANT_ID,
  outletId: null,
  orderStatus: "In Progress",
  items: [
    { _id: "a1", name: "Biryani", quantity: 1, total: 250, status: "preparing" },
    { _id: "a2", name: "Water", quantity: 1, total: 20, status: "pending" },
    { _id: "a3", name: "Kebab", quantity: 1, total: 300, status: "pending" },
  ],
  bills: { subtotal: 570, tax: 28.5, charges: 0, totalWithTax: 598.5 },
  async save() { return this; },
});

const loadController = (order) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../models/orderModel") {
      return {
        // Honour the filter. A mock that returns the order regardless cannot
        // catch a malformed query - which is exactly how a bad tenant scope
        // reached production and 404'd every request.
        findOne: async (filter = {}) => {
          if (!order) return null;
          if (filter.tenant !== undefined || filter.scope !== undefined) {
            throw new Error("tenantScope wrapper leaked into the query filter");
          }
          if (filter.restaurantId && String(filter.restaurantId) !== String(order.restaurantId)) return null;
          return order;
        },
      };
    }
    if (r === "../services/socket") return { emitOrderStatusChanged: () => {} };
    if (r === "../services/tenantContext") {
      return { resolveTenantFromUser: async () => ({ restaurantId: RESTAURANT_ID, storeId: "123456" }) };
    }
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../controllers/onlineOrderController")];
  const ctrl = require("../controllers/onlineOrderController");
  Module._load = orig;
  return ctrl;
};

const call = async (fn, req) => {
  let err = null; let payload = null;
  const res = { status() { return res; }, json(p) { payload = p; return res; } };
  await fn(req, res, (e) => { err = e; });
  return { err, payload };
};

test("accepting sends ONLY the added items to the kitchen", async () => {
  const order = makeOrder();
  const { resolveAddedItems } = loadController(order);

  const { err } = await call(resolveAddedItems, {
    user, params: { id: ORDER_ID }, body: { action: "accept" },
  });

  assert.equal(err, null, err && err.message);
  assert.equal(order.items.length, 3, "nothing is removed on accept");
  assert.deepEqual(
    order.items.map((i) => i.status),
    ["preparing", "preparing", "preparing"],
    "the pending additions join the ticket",
  );
});

test("rejecting removes the added items and nothing else", async () => {
  const order = makeOrder();
  const { resolveAddedItems } = loadController(order);

  await call(resolveAddedItems, { user, params: { id: ORDER_ID }, body: { action: "reject" } });

  assert.equal(order.items.length, 1, "only the already-cooking item survives");
  assert.equal(order.items[0].name, "Biryani");
});

test("rejecting drops the bill back to what is actually being made", async () => {
  const order = makeOrder();
  const { resolveAddedItems } = loadController(order);

  await call(resolveAddedItems, { user, params: { id: ORDER_ID }, body: { action: "reject" } });

  assert.equal(order.bills.subtotal, 250, "the rejected items leave the total");
  // 5% of the original 570/28.5 rate, applied to the new subtotal.
  assert.equal(order.bills.tax, 12.5);
  assert.equal(order.bills.totalWithTax, 262.5);
});

test("the order itself is never replaced — additions stay on one ticket", async () => {
  const order = makeOrder();
  const before = order._id;
  const { resolveAddedItems } = loadController(order);
  await call(resolveAddedItems, { user, params: { id: ORDER_ID }, body: { action: "accept" } });
  assert.equal(order._id, before, "same order id after resolving additions");
});

test("an order with nothing pending is refused rather than silently touched", async () => {
  const order = makeOrder();
  order.items = order.items.filter((i) => i.status !== "pending");
  const { resolveAddedItems } = loadController(order);

  const { err } = await call(resolveAddedItems, {
    user, params: { id: ORDER_ID }, body: { action: "accept" },
  });
  assert.equal(err?.status, 409);
});

test("an unknown action is rejected", async () => {
  const { resolveAddedItems } = loadController(makeOrder());
  const { err } = await call(resolveAddedItems, {
    user, params: { id: ORDER_ID }, body: { action: "whatever" },
  });
  assert.equal(err?.status, 400);
});

test("another tenant's order cannot be resolved", async () => {
  // tenantScope is what constrains the lookup; no match means no order.
  const { resolveAddedItems } = loadController(null);
  const { err } = await call(resolveAddedItems, {
    user, params: { id: ORDER_ID }, body: { action: "accept" },
  });
  assert.equal(err?.status, 404);
});
