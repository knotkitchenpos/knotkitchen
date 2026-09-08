const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

/**
 * A decision taken on the kitchen order reaching the table session.
 *
 * The Order and the TableSession are two records of the same meal, read by
 * different screens: the till's ticket reads the Order, while Manage Tables
 * and the diner's own phone read the Session. Accepting or rejecting added
 * items only ever wrote to the Order, so the operator watched the dish leave
 * the ticket while the table's bill and the customer's screen kept it --
 * indefinitely, because nothing else ever revisited those lines.
 */

const RESTAURANT_ID = new mongoose.Types.ObjectId().toString();
const ORDER_ID = new mongoose.Types.ObjectId().toString();
const SESSION_ID = new mongoose.Types.ObjectId().toString();
const user = {
  _id: new mongoose.Types.ObjectId().toString(),
  role: "Owner",
  restaurantId: RESTAURANT_ID,
  storeId: "1",
};

const makeSession = (status = "OCCUPIED") => ({
  _id: SESSION_ID,
  sessionCode: "S-1",
  status,
  restaurantId: RESTAURANT_ID,
  outletId: null,
  tableId: "t1",
  items: [
    { _id: "s1", name: "Biryani", quantity: 1, total: 250, status: "preparing", kdsItemId: "a1" },
    { _id: "s2", name: "Water", quantity: 1, total: 20, status: "pending", kdsItemId: "a2" },
    { _id: "s3", name: "Kebab", quantity: 1, total: 300, status: "pending", kdsItemId: "a3" },
  ],
  bills: { subtotal: 570, tax: 0, charges: 0, totalWithTax: 570 },
});

const makeOrder = () => ({
  _id: ORDER_ID,
  restaurantId: RESTAURANT_ID,
  outletId: null,
  table: "t1",
  tableSessionId: SESSION_ID,
  orderStatus: "In Progress",
  items: [
    { _id: "a1", name: "Biryani", quantity: 1, total: 250, status: "preparing" },
    { _id: "a2", name: "Water", quantity: 1, total: 20, status: "pending" },
    { _id: "a3", name: "Kebab", quantity: 1, total: 300, status: "pending" },
  ],
  bills: { subtotal: 570, tax: 0, charges: 0, totalWithTax: 570 },
  async save() {
    return this;
  },
});

/**
 * Unlike the loader in addedItemsFlow, this one keeps the interception
 * installed for the duration of the CALL: the session lookup and the bill
 * recalculation are required lazily inside the controller (tableSession's
 * controller requires this one back), so restoring Module._load before
 * calling would reach the real mongoose models.
 */
const withMocks = async ({ order, session, emits }, fn) => {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (r === "../models/orderModel") return { findOne: async () => order };
    if (r === "../models/tableSessionModel") return { findOne: async () => session };
    if (r === "./tableSessionController") {
      return {
        recalculateSessionBill: async (s) => {
          const live = s.items.filter((i) => i.status !== "cancelled");
          s.bills.subtotal = live.reduce((a, i) => a + i.total, 0);
          s.bills.totalWithTax = s.bills.subtotal;
          return s;
        },
      };
    }
    if (r === "../services/socket") {
      return {
        emitOrderStatusChanged: () => emits.push("order"),
        emitTableSessionUpdated: () => emits.push("session"),
      };
    }
    if (r === "../services/tenantContext") {
      return { resolveTenantFromUser: async () => ({ restaurantId: RESTAURANT_ID, storeId: "1" }) };
    }
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../controllers/onlineOrderController")];
  const ctrl = require("../controllers/onlineOrderController");
  try {
    return await fn(ctrl);
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve("../controllers/onlineOrderController")];
  }
};

const call = async (fn, req) => {
  let err = null;
  const res = {
    status() {
      return res;
    },
    json() {
      return res;
    },
  };
  await fn(req, res, (e) => {
    err = e;
  });
  return err;
};

test("REGRESSION: rejecting an addition cancels it on the SESSION too", async () => {
  const order = makeOrder();
  const session = makeSession();
  const emits = [];

  await withMocks({ order, session, emits }, (ctrl) =>
    call(ctrl.resolveAddedItems, { user, params: { id: ORDER_ID }, body: { action: "reject" } }),
  );

  assert.deepEqual(
    session.items.map((i) => i.status),
    ["preparing", "cancelled", "cancelled"],
    "Manage Tables and the diner's phone read this, and it never changed",
  );
  assert.equal(session.bills.totalWithTax, 250, "and the table's bill falls back");
});

test("accepting an addition moves the SESSION lines to preparing", async () => {
  const order = makeOrder();
  const session = makeSession();
  const emits = [];

  await withMocks({ order, session, emits }, (ctrl) =>
    call(ctrl.resolveAddedItems, { user, params: { id: ORDER_ID }, body: { action: "accept" } }),
  );

  assert.deepEqual(session.items.map((i) => i.status), ["preparing", "preparing", "preparing"]);
  assert.equal(session.bills.totalWithTax, 570, "nothing leaves the bill on accept");
});

test("cancelling one item leaves the other on the session", async () => {
  const order = makeOrder();
  const session = makeSession();
  const emits = [];

  await withMocks({ order, session, emits }, (ctrl) =>
    call(ctrl.resolveAddedItems, {
      user,
      params: { id: ORDER_ID },
      body: { action: "reject", itemIds: ["a3"] },
    }),
  );

  assert.deepEqual(session.items.map((i) => i.status), ["preparing", "pending", "cancelled"]);
  assert.equal(session.bills.totalWithTax, 270);
});

test("both screens are told: the order room AND the session room", async () => {
  // Manage Tables invalidates on "tableSessionUpdated" and always did --
  // nothing in the backend had ever emitted it.
  const emits = [];
  await withMocks({ order: makeOrder(), session: makeSession(), emits }, (ctrl) =>
    call(ctrl.resolveAddedItems, { user, params: { id: ORDER_ID }, body: { action: "reject" } }),
  );
  assert.deepEqual(emits, ["order", "session"]);
});

test("a settled session is never rewritten", async () => {
  // The money is taken; the bill is history. The order can still be tidied,
  // but the session it was paid against must not move.
  const session = makeSession("PAID");
  const before = session.items.map((i) => i.status);
  const emits = [];

  await withMocks({ order: makeOrder(), session, emits }, (ctrl) =>
    call(ctrl.resolveAddedItems, { user, params: { id: ORDER_ID }, body: { action: "reject" } }),
  );

  assert.deepEqual(session.items.map((i) => i.status), before);
});

test("an order with no session still resolves rather than throwing", async () => {
  // Takeaway and delivery orders have no table session at all.
  const order = makeOrder();
  order.tableSessionId = null;
  const emits = [];

  const err = await withMocks({ order, session: null, emits }, (ctrl) =>
    call(ctrl.resolveAddedItems, { user, params: { id: ORDER_ID }, body: { action: "reject" } }),
  );

  assert.equal(err, null);
  assert.deepEqual(emits, ["order"], "no session event when there is no session");
});

// ---------------------------------------------------------------------------
// The QR link, and the components a diner chose
// ---------------------------------------------------------------------------

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

test("REGRESSION: a settled session's code no longer buys write access", () => {
  // The QR on the table is permanent, so the link is permanent. What must
  // expire is the diner's claim on a SESSION -- otherwise a tab left open
  // after the bill was paid posts dishes onto the next customer's ticket.
  const src = SRC("routes", "qrRoute.js");
  assert.match(src, /const claimedCode = String\(req\.body\?\.sessionCode \|\| ""\)\.trim\(\);/);
  assert.match(src, /claimedCode && claimedCode !== session\.sessionCode/);
  assert.match(src, /scan the QR code again/i, "and the diner is told what to do");

  // A fresh scan sends no code and must still be able to join.
  assert.ok(
    /if \(claimedCode &&/.test(src),
    "an absent code is not a mismatch -- that would break every first scan",
  );
});

test("the diner's page sends the session it believes it is in", () => {
  const page = SRC("..", "pos-frontend", "src", "pages", "OrderOnline.jsx");
  assert.match(page, /sessionCode: session\.sessionCode/);
  assert.match(page, /e\.response\?\.status === 409/, "and recovers when it is refused");
});

test("REGRESSION: components survive onto the session item", () => {
  // calculateUnitPrice returned variant, addons and modifiers; enrichItems
  // destructured all three, priced them into unitPrice, and stored only
  // `modifiers`. The diner paid for an add-on that nothing displayed.
  const src = SRC("controllers", "tableSessionController.js");
  assert.match(src, /const components = \[\.\.\.\(addons \|\| \[\]\), \.\.\.\(modifiers \|\| \[\]\)\];/);
  assert.match(src, /modifiers: components,/);
  // The variant REPLACES the base price, so it must not join an additive
  // list -- OrderPanel derives a base by subtracting exactly that list.
  assert.match(src, /variant\?\.name \? `\$\{item\.name\} \(\$\{variant\.name\}\)` : item\.name/);
});

test("every surface that shows a line shows its components", () => {
  const surfaces = {
    "pos-frontend/src/components/tables/SessionDetailModal.jsx": /item\.modifiers\.map\(\(m\) => m\.name\)/,
    "pos-frontend/src/utils/printReceipt.js": /item\.modifiers \|\| \[\]/,
    "pos-frontend/src/components/invoice/Invoice.jsx": /item\.modifiers/,
  };
  for (const [file, re] of Object.entries(surfaces)) {
    assert.match(SRC("..", ...file.split("/")), re, `${file} drops the components`);
  }
  // ...and the e-bill, which was the only one that ever showed them.
  assert.match(SRC("controllers", "publicReceiptController.js"), /i\.modifiers \|\| \[\]/);
});

test("REGRESSION: an appended kitchen line is linked from the right end", () => {
  // Both indexes count back from the end of their own list. Using items[idx]
  // on an APPEND linked every session item to a dish from an earlier round,
  // so cancelling one struck the wrong dish off the ticket.
  const src = SRC("routes", "qrRoute.js");
  assert.match(src, /const kitchenStartIdx = kitchenOrderDoc\.items\.length - validatedItems\.length;/);
  assert.match(src, /kitchenOrderDoc\.items\[kitchenStartIdx \+ idx\]\?\._id/);
  assert.ok(
    !/si\.kdsItemId = kitchenOrderDoc\.items\[idx\]/.test(src),
    "the un-offset form is the bug",
  );
});
