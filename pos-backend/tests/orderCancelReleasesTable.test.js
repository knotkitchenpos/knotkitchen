const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Cancelling an order frees the table.
 *
 * Cancelling wrote Order.orderStatus and stopped. The table session and the
 * Table itself were never told, so the Orders screen said "Cancelled" while
 * Manage Tables kept the table occupied and the diner's QR page kept the
 * dishes. Nothing else revisits those records, so the table stayed blocked
 * until a human cleared it by hand.
 *
 * The release is deliberately conditional: a table mid-meal on a second round
 * must NOT be handed to the next party because one round was voided.
 */

const ORDER_ID = "o1";

const makeSession = (items, status = "OCCUPIED") => ({
  _id: "sess1",
  sessionCode: "S-1",
  status,
  restaurantId: "r1",
  outletId: null,
  tableId: "t1",
  items,
  bills: { subtotal: 0, tax: 0, charges: 0, totalWithTax: 0 },
  timeline: [],
  async save() {
    return this;
  },
});

/**
 * Loads the controller with every collaborator replaced. The interception
 * stays installed for the CALL, not only the require: the table release and
 * the bill recalculation both reach for models while running.
 */
const load = ({ session, otherLive = 0, tableUpdates, emits }) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../models/tableSessionModel") return { findOne: async () => session };
    if (r === "../models/orderModel") return { countDocuments: async () => otherLive };
    if (r === "../models/tableModel") {
      return {
        findOneAndUpdate: async (filter, update) => {
          tableUpdates.push({ filter, update });
          return null;
        },
      };
    }
    if (r === "../services/tableCooldownService") {
      return {
        buildCooldownUpdate: async () => ({
          status: "available",
          availableAt: null,
          currentOrderId: null,
          currentOccupancy: 0,
        }),
      };
    }
    if (r === "../services/gst") return { resolveGstForRestaurant: async () => ({ rate: 0 }) };
    if (r === "../services/socket") {
      return {
        emitOrderCreated: () => {},
        emitOrderStatusChanged: () => {},
        emitTableSessionUpdated: (p) => emits.push(p.reason),
      };
    }
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../controllers/tableSessionController")];
  const ctrl = require("../controllers/tableSessionController");
  return {
    ctrl,
    restore() {
      Module._load = orig;
      delete require.cache[require.resolve("../controllers/tableSessionController")];
    },
  };
};

const run = async (opts, order) => {
  const { ctrl, restore } = load(opts);
  try {
    return await ctrl.releaseSessionForCancelledOrder(order, "POS");
  } finally {
    restore();
  }
};

test("REGRESSION: cancelling the only order frees the table", async () => {
  const session = makeSession([
    { name: "Juice", quantity: 1, price: 178, total: 178, status: "preparing", orderId: ORDER_ID },
  ]);
  const tableUpdates = [];
  const emits = [];

  await run({ session, otherLive: 0, tableUpdates, emits }, { _id: ORDER_ID, tableSessionId: "sess1" });

  assert.equal(session.items[0].status, "cancelled", "the diner's page reads this");
  assert.equal(session.status, "CLOSED");
  assert.equal(tableUpdates.length, 1, "the table was never released before");
  assert.equal(tableUpdates[0].update.status, "available");
  assert.equal(tableUpdates[0].update.currentOrderId, null);
  assert.deepEqual(emits, ["order_cancelled_table_freed"]);
});

test("a table still mid-meal is NOT freed", async () => {
  // Round two is cooking. Handing this table to the next party would seat
  // them on top of a live meal.
  const session = makeSession([
    { name: "Juice", quantity: 1, price: 178, total: 178, status: "preparing", orderId: ORDER_ID },
    { name: "Coffee", quantity: 1, price: 100, total: 100, status: "preparing", orderId: "o2" },
  ]);
  const tableUpdates = [];
  const emits = [];

  await run({ session, otherLive: 1, tableUpdates, emits }, { _id: ORDER_ID, tableSessionId: "sess1" });

  assert.equal(session.items[0].status, "cancelled", "only the cancelled order's line goes");
  assert.equal(session.items[1].status, "preparing");
  assert.equal(session.status, "OCCUPIED", "the session stays open");
  assert.equal(tableUpdates.length, 0, "and the table stays occupied");
  assert.deepEqual(emits, ["order_cancelled"]);
});

test("items written before orderId existed still come off the only order", async () => {
  // Legacy sessions have unlinked items. With no other live order they can
  // only belong to this one, so leaving them would block the table forever.
  const session = makeSession([
    { name: "Juice", quantity: 1, price: 178, total: 178, status: "preparing" },
  ]);
  const tableUpdates = [];
  const emits = [];

  await run({ session, otherLive: 0, tableUpdates, emits }, { _id: ORDER_ID, tableSessionId: "sess1" });

  assert.equal(session.items[0].status, "cancelled");
  assert.equal(tableUpdates.length, 1, "the table is freed");
});

test("unlinked items are left alone when another order is live", async () => {
  // The opposite case: they cannot be attributed, so guessing would cancel a
  // dish the kitchen is still cooking for someone at the table.
  const session = makeSession([
    { name: "Juice", quantity: 1, price: 178, total: 178, status: "preparing" },
  ]);
  const tableUpdates = [];
  const emits = [];

  await run({ session, otherLive: 1, tableUpdates, emits }, { _id: ORDER_ID, tableSessionId: "sess1" });

  assert.equal(session.items[0].status, "preparing");
  assert.equal(tableUpdates.length, 0);
});

test("a settled session is never reopened or re-freed", async () => {
  const session = makeSession(
    [{ name: "Juice", quantity: 1, price: 178, total: 178, status: "preparing", orderId: ORDER_ID }],
    "PAID",
  );
  const tableUpdates = [];
  const emits = [];

  const out = await run({ session, otherLive: 0, tableUpdates, emits }, { _id: ORDER_ID, tableSessionId: "sess1" });

  assert.equal(out, null);
  assert.equal(session.items[0].status, "preparing", "paid history is not rewritten");
  assert.equal(tableUpdates.length, 0);
});

test("an order with no table session does nothing", async () => {
  // Takeaway and delivery cancel through the same endpoint.
  const tableUpdates = [];
  const emits = [];
  const out = await run({ session: null, otherLive: 0, tableUpdates, emits }, { _id: ORDER_ID, tableSessionId: null });
  assert.equal(out, null);
  assert.deepEqual(emits, []);
});

// ---------------------------------------------------------------------------
// The call sites
// ---------------------------------------------------------------------------

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

test("REGRESSION: every cancel route releases the table", () => {
  // One helper, called from each route. Cancelling from the Orders screen and
  // cancelling from the QR popup are different endpoints, and only fixing the
  // one in the report would leave the other still blocking tables.
  for (const file of ["controllers/orderController.js", "controllers/onlineOrderController.js"]) {
    assert.match(
      SRC(...file.split("/")),
      /releaseSessionForCancelledOrder\(order, req\.user\?\.name \|\| "POS"\)/,
      `${file} cancels an order without freeing the table`,
    );
  }
});

test("REGRESSION: the new-order popup acts on the id the payload actually carries", () => {
  // emitOrderCreated sends `orderId`. The popup read `_id`, which was never on
  // the payload, so both buttons silently dismissed and the order was untouched.
  const popup = SRC("..", "pos-frontend", "src", "components", "dashboard", "NewOrderPopup.jsx");
  assert.match(popup, /current\?\.orderId \|\| current\?\._id \|\| current\?\.id/);

  const socket = SRC("services", "socket.js");
  assert.match(socket, /orderId: String\(order\._id\),/, "which is what the emitter sends");
  // The only `_id` in that payload belongs to the TABLE, not the order --
  // which is exactly why reading `current._id` found nothing.
  const created = socket.slice(socket.indexOf("const emitOrderCreated"), socket.indexOf("const emitOrderStatusChanged"));
  assert.ok(!/^ {4}_id:/m.test(created), "no top-level _id -- the popup must not expect one");
  assert.match(created, /_id: tableDoc\._id,/, "the nested one is the table's");
});
