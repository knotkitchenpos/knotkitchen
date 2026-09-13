const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Adding a dish to a table that is already eating.
 *
 * A diner scans the QR, orders, and then asks the waiter for one more thing.
 * There was no way to ring that in. Manage Tables → Add Item sent the biller
 * to the menu, Finish asked which table, and the table it wanted was the one
 * the party was already sitting at -- which the server refuses, because it is
 * occupied. The same wall stood in front of a table order started at the till.
 *
 * The endpoint for appending to a live session has existed since table
 * ordering shipped. Nothing in the POS ever called it: every table finish went
 * to createTableSession, which by definition cannot touch a table that has
 * one. That is the whole bug, and it is why these tests are about which
 * function the screens call.
 */

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const FE = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", ...p), "utf8");

test("the server offers a way to add to a live session", () => {
  const routes = SRC("routes", "tableSessionRoute.js");
  assert.match(routes, /router\.route\("\/:id\/items"\)\.post\(isVerifiedUser, addItemsToExistingSession\)/);
});

test("adding to a live session does not start a second one", () => {
  // A new session on an occupied table is exactly what the server refuses, so
  // an append that quietly created one would fail the same way.
  const ctrl = SRC("controllers", "tableSessionController.js");
  const block = ctrl.slice(
    ctrl.indexOf("const addItemsToExistingSession"),
    ctrl.indexOf("const addItemsToExistingSession") + 4000,
  );
  assert.match(block, /session\.items\.push\(\.\.\.validatedItems\)/, "the items join the session");
  assert.match(block, /recalculateSessionBill\(session\)/, "and the bill follows them");
  assert.ok(
    !/new TableSession\(|TableSession\.create\(/.test(block),
    "appending must never mint a session",
  );
});

test("the till calls the append endpoint rather than always creating", () => {
  const panel = FE("src", "components", "pos", "OrderPanel.jsx");

  assert.match(panel, /addItemsToTableSession/, "the append endpoint must be wired up at all");
  assert.match(
    panel,
    /if \(activeSessionId\) return appendToSession\(activeSessionId\)/,
    "a cart already on a table must not be asked which table",
  );
  assert.match(
    panel,
    /const existing = table\.session\?\._id \|\| table\.activeSessionId \|\| ""/,
    "and a table picked from the list may already be running an order",
  );
});

test("Manage Tables hands the session over when it sends the biller to the menu", () => {
  // Without this the menu has no idea the cart belongs to a table, and Finish
  // falls back to asking for one.
  const tables = FE("src", "pages", "Tables.jsx");
  const block = tables.slice(tables.indexOf("onAddItem={"), tables.indexOf("onAddItem={") + 1200);
  assert.match(block, /getSessionIdFromTable\(sessionTable\)/);
  assert.match(block, /dispatch\(setSessionId\(activeSessionId\)\)/);
  assert.match(block, /navigate\("\/menu"\)/);
});

test("REGRESSION: a table with a live order is selectable, not greyed out", () => {
  // Every taken table was disabled, so the one table the biller wanted was the
  // one they could not press. Occupied is not one state: a party mid-meal can
  // be sent another dish, a table being cleared cannot.
  const modal = FE("src", "components", "pos", "TableModal.jsx");

  assert.match(modal, /const canAddTo = \(t\) => Boolean\(sessionIdOf\(t\)\)/);
  assert.match(
    modal,
    /const off = isOccupied\(t\) && !addTo/,
    "only a taken table with no live order stays unpickable",
  );
  assert.match(modal, /"Add to order"/, "and it says so on the tile");
  assert.match(modal, /activeSessionId: sessionIdOf\(picked\)/, "the id is handed to the caller");
});

test("a party being added to is not asked for its head count again", () => {
  // customerCount re-validates the table's capacity and overwrites the count
  // the party was seated with, so sending one on an append is a way to fail a
  // valid order.
  const modal = FE("src", "components", "pos", "TableModal.jsx");
  assert.match(modal, /guests: adding \? 0 : g/);

  const panel = FE("src", "components", "pos", "OrderPanel.jsx");
  assert.match(panel, /\.\.\.\(customerCount \? \{ customerCount \} : \{\}\)/);
});

test("REGRESSION: a round added at the till joins the table's open order", () => {
  // QR order first, then Add Item at the till, showed as TWO orders for one
  // table: every POS session path created a fresh Order per round, while the
  // QR route appended to the open one.
  const ctrl = SRC("controllers", "tableSessionController.js");
  const helper = ctrl.slice(ctrl.indexOf("const addRoundToKitchenOrder"), ctrl.indexOf("const announceKitchenOrder"));
  assert.match(helper, /Order\.findOne\(\s*\{\s*tableSessionId: session\._id/);
  assert.match(helper, /orderStatus: \{ \$nin: \[\.\.\.SETTLED_STATUSES, \.\.\.CANCELLED_STATUSES\] \}/);
  assert.match(helper, /order\.items\.push\(\.\.\.lines\)/);

  // The helper is the only place a table order is created.
  assert.equal((ctrl.match(/Order\.create\(/g) || []).length, 1);
  assert.equal((ctrl.match(/await addRoundToKitchenOrder\(/g) || []).length, 2);

  // An appended round refreshes the tills instead of popping a "new order".
  assert.match(ctrl, /const emit = appended \? emitOrderStatusChanged : emitOrderCreated/);
});
