const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Releasing a table by hand.
 *
 * A party that cancels its whole order leaves the session at a zero total.
 * "Complete Order & Take Payment" is disabled at zero, so the table could not
 * be settled -- and there was no other control anywhere that would free it.
 * The table stayed occupied, with nothing that could ever clear it.
 *
 * Two holes, fixed together:
 *
 *   1. Cancelling an order whose table has no SESSION freed nothing. A
 *      dine-in order typed at the till, and the legacy single-shot QR route,
 *      both stamp `table` and mark it occupied without opening one.
 *
 *   2. Even with both automatic paths working, a table stranded by an older
 *      order needed a manual way out. That is `PUT /api/table/:id/release`.
 *
 * The release deliberately refuses while a live order still has dishes on it:
 * somebody is sitting there, and handing that table to the next party would
 * seat them on top of a running bill.
 */

const TABLE_ID = "t1";
const RESTAURANT_ID = "507f1f77bcf86cd799439011";

const makeTable = (over = {}) => ({
  _id: TABLE_ID,
  tableNumber: 1,
  displayId: "GF1",
  status: "occupied",
  currentOrderId: "o-old",
  currentOccupancy: 2,
  restaurantId: RESTAURANT_ID,
  outletId: null,
  ...over,
});

const makeSession = (over = {}) => ({
  _id: "sess1",
  status: "OCCUPIED",
  tableId: TABLE_ID,
  timeline: [],
  async save() {
    return this;
  },
  ...over,
});

/**
 * Loads the controller with every collaborator replaced, and keeps the
 * interception installed for the CALL: the order lookup, the cooldown update
 * and the socket emit all reach for modules while running.
 */
const load = ({ table, session, orders = [], tableUpdates, emits }) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../models/tableModel") {
      return {
        findOne: async () => table,
        findOneAndUpdate: async (filter, update) => {
          tableUpdates.push({ filter, update });
          return { ...table, ...update };
        },
      };
    }
    if (r === "../models/tableSessionModel") return { findOne: async () => session };
    if (r === "../models/orderModel") {
      return { find: () => ({ select: async () => orders }) };
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
    if (r === "../services/socket") {
      return { emitTableSessionUpdated: (p) => emits.push(p.reason) };
    }
    if (r === "../services/auditService") return { logActivity: async () => {} };
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../controllers/tableController")];
  const ctrl = require("../controllers/tableController");
  return {
    ctrl,
    restore() {
      Module._load = orig;
      delete require.cache[require.resolve("../controllers/tableController")];
    },
  };
};

/** Runs the handler and reports whichever of res/next it reached. */
const run = async (opts) => {
  const { ctrl, restore } = load(opts);
  const out = { status: 0, body: null, error: null };
  const res = {
    status(code) {
      out.status = code;
      return this;
    },
    json(obj) {
      out.body = obj;
    },
  };
  try {
    await ctrl.releaseTable(
      { params: { id: RESTAURANT_ID }, user: { restaurantId: RESTAURANT_ID, _id: "u1", name: "Asha" } },
      res,
      (err) => {
        out.error = err;
      },
    );
  } finally {
    restore();
  }
  return out;
};

test("REGRESSION: a table whose order was cancelled can be released", async () => {
  const table = makeTable();
  const session = makeSession();
  const tableUpdates = [];
  const emits = [];

  const out = await run({
    table,
    session,
    orders: [],
    tableUpdates,
    emits,
  });

  assert.equal(out.error, null);
  assert.equal(out.status, 200);
  assert.equal(session.status, "CLOSED", "the session goes with the table");
  assert.equal(tableUpdates.length, 1);
  assert.equal(tableUpdates[0].update.status, "available");
  assert.equal(tableUpdates[0].update.currentOrderId, null, "a stale order id is what kept it looking busy");
  assert.equal(tableUpdates[0].update.currentOccupancy, 0);
  assert.deepEqual(emits, ["table_released"]);
});

test("REGRESSION: a table stranded with NO session at all is still released", async () => {
  // The case with no way out before: nothing to close, so nothing to click.
  const table = makeTable();
  const tableUpdates = [];
  const emits = [];

  const out = await run({ table, session: null, orders: [], tableUpdates, emits });

  assert.equal(out.error, null);
  assert.equal(tableUpdates.length, 1, "the table is freed without a session");
  assert.equal(out.body.data.status, "available");
});

test("a table still mid-meal is NOT released", async () => {
  // Somebody is sitting there. Releasing would seat the next party on top of
  // a running bill.
  const table = makeTable();
  const session = makeSession();
  const tableUpdates = [];
  const emits = [];

  const out = await run({
    table,
    session,
    orders: [{ _id: "o1", items: [{ status: "preparing" }] }],
    tableUpdates,
    emits,
  });

  assert.equal(out.status, 0, "it never reached a response");
  assert.equal(out.error?.status, 409);
  assert.match(out.error.message, /Settle or cancel it first/);
  assert.equal(session.status, "OCCUPIED", "the session is untouched");
  assert.deepEqual(tableUpdates, [], "and so is the table");
});

test("an order whose dishes were all pulled does not block the release", async () => {
  // This is the reported case: every item cancelled one at a time, total ₹0.
  const table = makeTable();
  const tableUpdates = [];
  const emits = [];

  const out = await run({
    table,
    session: makeSession(),
    orders: [{ _id: "o1", items: [{ status: "cancelled" }, { status: "cancelled" }] }],
    tableUpdates,
    emits,
  });

  assert.equal(out.error, null);
  assert.equal(tableUpdates.length, 1);
});

test("a table that is not this restaurant's is not found", async () => {
  const out = await run({ table: null, session: null, orders: [], tableUpdates: [], emits: [] });
  assert.equal(out.error?.status, 404);
});

// ---------------------------------------------------------------------------
// The automatic path, for an order that never had a session
// ---------------------------------------------------------------------------

const loadSessionCtrl = ({ otherLive = 0, liveSession = null, tableUpdates }) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../models/tableSessionModel") {
      return { findOne: async () => liveSession };
    }
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
        emitTableSessionUpdated: () => {},
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

const releaseNoSession = async (opts, order) => {
  const { ctrl, restore } = loadSessionCtrl(opts);
  try {
    return await ctrl.releaseSessionForCancelledOrder(order, "POS");
  } finally {
    restore();
  }
};

test("REGRESSION: cancelling a table order that has no session still frees the table", async () => {
  // A dine-in order typed at the till marks the table occupied without ever
  // opening a session. Cancelling it used to free nothing at all.
  const tableUpdates = [];
  await releaseNoSession(
    { otherLive: 0, liveSession: null, tableUpdates },
    { _id: "o1", table: TABLE_ID, restaurantId: RESTAURANT_ID, tableSessionId: null },
  );
  assert.equal(tableUpdates.length, 1);
  assert.equal(tableUpdates[0].update.status, "available");
});

test("another live order on that table keeps it occupied", async () => {
  const tableUpdates = [];
  await releaseNoSession(
    { otherLive: 1, liveSession: null, tableUpdates },
    { _id: "o1", table: TABLE_ID, restaurantId: RESTAURANT_ID, tableSessionId: null },
  );
  assert.deepEqual(tableUpdates, []);
});

test("a party sitting there under their own session keeps it occupied", async () => {
  const tableUpdates = [];
  await releaseNoSession(
    { otherLive: 0, liveSession: makeSession(), tableUpdates },
    { _id: "o1", table: TABLE_ID, restaurantId: RESTAURANT_ID, tableSessionId: null },
  );
  assert.deepEqual(tableUpdates, [], "that session is not ours to close");
});

test("an order with no table at all does nothing", async () => {
  // Takeaway and delivery cancel through the same helper.
  const tableUpdates = [];
  const out = await releaseNoSession(
    { otherLive: 0, liveSession: null, tableUpdates },
    { _id: "o1", table: null, restaurantId: RESTAURANT_ID, tableSessionId: null },
  );
  assert.equal(out, null);
  assert.deepEqual(tableUpdates, []);
});

// ---------------------------------------------------------------------------
// The wiring
// ---------------------------------------------------------------------------

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

test("the route is mounted, and takes the ordinary table permission", () => {
  const route = SRC("routes", "tableRoute.js");
  assert.match(
    route,
    /router\.route\("\/:id\/release"\)\.put\(isVerifiedUser, requirePermission\("TABLE_UPDATE"\), releaseTable\);/,
  );
  // Declared before the bare "/:id" PUT, or that one swallows it.
  assert.ok(
    route.indexOf('"/:id/release"') < route.indexOf('router.route("/:id").put'),
    "a generic /:id route declared first would capture /release",
  );
});

test("REGRESSION: the operator can reach it, including with no session", () => {
  const modal = SRC("..", "pos-frontend", "src", "components", "tables", "SessionDetailModal.jsx");

  // This used to `return null` with no session, so a stranded table opened
  // nothing at all when clicked.
  assert.ok(!/if \(!session\) return null;/.test(modal), "the modal must render without a session");
  assert.match(modal, /\{releaseBusy \? "Releasing…" : "Release Table"\}/);

  // The zero-total case is exactly the one that needs the release, so the
  // release button must NOT sit behind the same total check.
  const complete = modal.slice(modal.indexOf("{onComplete"), modal.indexOf("{onRelease"));
  assert.match(complete, /totalWithTax > 0/, "payment still requires an amount");
  const release = modal.slice(modal.indexOf("{onRelease"));
  assert.ok(!/totalWithTax/.test(release), "a zero total is the reason to release, not a bar to it");

  const page = SRC("..", "pos-frontend", "src", "pages", "Tables.jsx");
  assert.match(page, /onRelease=\{handleReleaseTable\}/);
  assert.match(page, /mutationFn: \(tableId\) => releaseTable\(tableId\)/);
  assert.match(page, /window\.confirm\(`Release Table/, "one click must not free a table");
});
