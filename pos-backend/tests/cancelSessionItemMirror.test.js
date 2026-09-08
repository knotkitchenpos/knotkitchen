const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { findCancelTarget } = require("../controllers/tableSessionController");

/**
 * Cancelling a dish from Manage Tables, and the Orders screen agreeing.
 *
 * The bill was always right -- recalculateSessionBill drops cancelled items
 * and saves -- but the Orders section went on showing the dish at full price.
 * Two independent reasons, and the old tests caught neither because they were
 * source guards (`assert.match(fn, /orderItem.status = "cancelled"/)`), which
 * pass whether or not the code ever runs.
 *
 *   the mirror was gated on `item.orderId`, a link the model calls optional
 *   ("internal kitchen order if any"), so an item without one skipped it
 *
 *   Orders.jsx rendered no item status at all, so even a perfect mirror was
 *   invisible on the screen the report was about
 */

// A stand-in for a Mongoose order: `items.id()` is the only method used.
const mkOrder = (_id, items) => {
  const arr = items.map((i) => ({ status: "pending", ...i }));
  arr.id = (id) => arr.find((i) => String(i._id) === String(id)) || null;
  return { _id, items: arr };
};

test("REGRESSION: an item with no orderId still finds its line", () => {
  // The whole bug. `orderId` is optional, and gating on it meant the Orders
  // screen kept a cancelled dish at full price with no way to notice.
  const orders = [mkOrder("o1", [{ _id: "a", name: "Sandwich" }])];
  const line = findCancelTarget({ name: "Sandwich" }, orders);
  assert.equal(line, orders[0].items[0]);
});

test("the exact KDS line wins over anything matched by name", () => {
  const orders = [
    mkOrder("o1", [{ _id: "a", name: "Coffee" }]),
    mkOrder("o2", [{ _id: "b", name: "Coffee" }]),
  ];
  const line = findCancelTarget({ name: "Coffee", kdsItemId: "b" }, orders);
  assert.equal(line._id, "b", "round two's coffee was the one pulled");
});

test("REGRESSION: the round it was added in beats an earlier round's copy", () => {
  // Two rounds, same dish, no kdsItemId. Matching purely by name would cancel
  // round one's -- taking a cooked plate off the pass and leaving the wrong
  // line on the ticket.
  const orders = [
    mkOrder("o1", [{ _id: "a", name: "Coffee" }]),
    mkOrder("o2", [{ _id: "b", name: "Coffee" }]),
  ];
  const line = findCancelTarget({ name: "Coffee", orderId: "o2" }, orders);
  assert.equal(line._id, "b");
});

test("an already-cancelled line is never picked twice", () => {
  // Cancelling the second of two identical dishes must not re-cancel the
  // first, which would leave one paid-for dish uncooked.
  const orders = [
    mkOrder("o1", [
      { _id: "a", name: "Coffee", status: "cancelled" },
      { _id: "b", name: "Coffee" },
    ]),
  ];
  const line = findCancelTarget({ name: "Coffee" }, orders);
  assert.equal(line._id, "b");
});

test("a dish on no kitchen order at all resolves to nothing, quietly", () => {
  assert.equal(findCancelTarget({ name: "Ghost" }, []), null);
  assert.equal(
    findCancelTarget({ name: "Ghost" }, [mkOrder("o1", [{ _id: "a", name: "Tea" }])]),
    null,
  );
});

test("a stale orderId falls back to the round that actually holds the dish", () => {
  // The link points at an order that no longer carries the line; the dish is
  // still on the table and still has to come off the ticket.
  const orders = [mkOrder("o2", [{ _id: "b", name: "Sandwich" }])];
  const line = findCancelTarget({ name: "Sandwich", orderId: "o-deleted" }, orders);
  assert.equal(line._id, "b");
});

// ---------------------------------------------------------------------------
// The two call-site behaviours the pure function cannot express
// ---------------------------------------------------------------------------

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

test("REGRESSION: the mirror is found by session, not only by orderId", () => {
  const src = SRC("controllers", "tableSessionController.js");
  const at = src.indexOf("const sessionOrders = await Order.find({");
  assert.notEqual(at, -1, "anchor moved; retarget this guard");
  const block = src.slice(at, at + 400);
  assert.match(block, /tableSessionId: session\._id/, "every table order carries this");
  assert.ok(
    !/^\s*if \(item\.orderId\) \{/m.test(src),
    "gating the whole mirror on an optional link is the bug being fixed",
  );
});

test("REGRESSION: Orders.jsx can actually show a cancelled line", () => {
  // It rendered name, quantity and price and nothing else, so a cancellation
  // that mirrored perfectly still looked like a live dish at full price.
  const page = SRC("..", "pos-frontend", "src", "pages", "Orders.jsx");
  assert.match(page, /const isVoided = it\.status === "cancelled"/);
  assert.match(page, /line-through/);
  assert.match(page, /Cancelled\{it\.cancelReason/);
  assert.match(
    page,
    /Order Items \(\{\(selected\.items \|\| \[\]\)\.filter\(\(it\) => it\.status !== "cancelled"\)\.length\}\)/,
    "the count must not include dishes that were pulled",
  );
});
