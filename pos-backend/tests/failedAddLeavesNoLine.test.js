const { test } = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const inventory = require("../services/inventory");

/**
 * N014. A table round is saved inside a transaction; when the add then failed
 * the round was rolled back, but stock depletion had already been queued for
 * it and wrote `items.N.stockDepleted` onto the empty slot: a nameless ₹0 line
 * on the order, receipt and Reports, which then failed every later save.
 */
const depleteHook = () => Order.schema.s.hooks._posts.get("save").find((h) => h.fn.name === "depleteStock").fn;
const tick = () => new Promise((r) => setImmediate(r));

test("a rolled-back round is never depleted; a committed one is, once", async () => {
  const calls = [];
  const real = inventory.depleteOrder;
  inventory.depleteOrder = async (doc) => { calls.push(doc.items.length); };
  try {
    for (const end of ["TRANSACTION_ABORTED", "TRANSACTION_COMMITTED"]) {
      const tx = Object.assign(new EventEmitter(), { inTransaction: () => true, transaction: { state: "TRANSACTION_IN_PROGRESS" } });
      const order = new Order({ items: [{ name: "Paneer Tikka", price: 100, total: 100 }] });
      order.$session = () => tx;
      depleteHook().call(order, order);
      await tick();
      assert.deepEqual(calls, [], "nothing before the transaction ends");
      tx.transaction.state = end;
      tx.emit("ended", tx);
      await tick();
    }
    assert.deepEqual(calls, [1], "only the committed round");
  } finally {
    inventory.depleteOrder = real;
  }
});

test("a nameless line already on an order is not shown and does not block its next save", async () => {
  const order = Order.hydrate({
    _id: new mongoose.Types.ObjectId(),
    orderStatus: "Preparing",
    items: [{ _id: new mongoose.Types.ObjectId(), name: "Paneer Tikka", price: 100, total: 100 }, { stockDepleted: true }],
  });
  assert.equal(order.toObject().items.length, 1);
  assert.equal(order.validateSync(), undefined);
});
