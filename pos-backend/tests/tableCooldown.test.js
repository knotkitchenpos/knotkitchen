const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_COOLDOWN_MINUTES,
  cooldownMinutesFor,
  buildCooldownUpdate,
} = require("../services/tableCooldownService");

/**
 * Freeing a table after payment.
 *
 * A settled table used to rest in `cleaning` for a configurable wait. That is
 * gone: the table is free the moment the bill is settled, so the next party
 * can be seated straight away.
 *
 * Two things this must NOT have broken, and both are tested below:
 *
 *   `cleaning` is still a status staff set by hand from Manage Table. Only the
 *   automatic hold went; the control did not.
 *
 *   Tables stamped with a deadline BEFORE this change must still be released.
 *   Nothing sets one any more, so without the sweep they would sit in
 *   `cleaning` forever.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("REGRESSION: a settled table is available immediately", async () => {
  const update = await buildCooldownUpdate("any-restaurant");
  assert.equal(update.status, "available");
  assert.equal(update.availableAt, null, "no deadline, because there is no wait");
});

test("the wait is zero for everyone", async () => {
  assert.equal(DEFAULT_COOLDOWN_MINUTES, 0);
  assert.equal(await cooldownMinutesFor("any-restaurant"), 0);
  assert.equal(await cooldownMinutesFor(), 0, "with no restaurant either");
});

test("a settled table is cleared of its order and its guests", async () => {
  const update = await buildCooldownUpdate("any-restaurant");
  assert.equal(update.currentOrderId, null);
  assert.equal(update.currentOccupancy, 0);
});

test("no per-restaurant setting can reintroduce a wait", async () => {
  // The Manage Table control is gone; this makes sure the service cannot be
  // talked back into holding a table by any argument.
  for (const arg of [null, undefined, "rest_1", 0, { cooldownMinutes: 30 }]) {
    const update = await buildCooldownUpdate(arg);
    assert.equal(update.status, "available", `argument ${JSON.stringify(arg)}`);
  }
});

test("REGRESSION: a table left in cleaning by the old behaviour is still released", () => {
  // Nothing stamps `availableAt` any more, so these rows have no other way
  // out. Removing the sweep would strand every table mid-cooldown at the
  // moment this shipped.
  const src = SRC("services/tableCooldownService.js");
  assert.match(src, /status: "cleaning"/, "the sweep still looks for them");
  assert.match(src, /availableAt: \{ \$ne: null, \$lte: now \}/);
  assert.match(src, /startTableCooldownSweeper/);
});

test("REGRESSION: a table staff marked cleaning by hand is left alone", () => {
  // It carries no deadline, so the sweep's `availableAt: { $ne: null }` skips
  // it and it stays until someone clears it. Freeing those automatically
  // would take away a control people use during service.
  const src = SRC("services/tableCooldownService.js");
  assert.match(src, /availableAt: \{ \$ne: null/, "a hand-set cleaning table has no deadline");

  // And the status is still accepted from the POS and the CSD.
  assert.match(SRC("controllers/tableController.js"), /"available", "occupied", "reserved", "cleaning"/);
  assert.match(SRC("models/tableModel.js"), /enum: \["available", "occupied", "reserved", "cleaning"\]/);
});

test("SOURCE: the settle response no longer promises a wait", () => {
  const src = SRC("controllers/tableSessionController.js");
  assert.match(src, /Table is available again/);
  assert.ok(
    !/Table frees up in/.test(src),
    "telling an operator to wait when there is no wait is worse than saying nothing",
  );
});

test("SOURCE: the dead Manage Table control is gone", () => {
  // A setting that no longer does anything is worse than no setting: someone
  // changes it and nothing happens.
  const tables = SRC("../pos-frontend/src/pages/Tables.jsx");
  assert.ok(!/Free table after payment/.test(tables), "the input is removed");
  assert.ok(!/cooldownMut|cooldownInput/.test(tables), "and its mutation and state with it");

  for (const page of ["../pos-frontend/src/pages/Tables.jsx", "../pos-frontend/src/pages/Orders.jsx"]) {
    assert.ok(!/frees up/.test(SRC(page)), `${page} still promises a wait`);
  }
});
