/**
 * A diner gives their name and phone once — on the scan that opens the table.
 *
 * The QR page used to ask for Name, Phone and Number of People on EVERY order,
 * including when adding to a table that was already running: the second diner
 * to scan was asked again, and whatever they typed overwrote the details of
 * the person who opened the table.
 *
 * Now the details are required when a session is CREATED, and not asked for
 * (or accepted) at all once one is open. Guest count is no longer collected
 * from the diner.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { validateCapacity } = require("../controllers/tableSessionController");

const QR_ROUTE = fs.readFileSync(path.join(__dirname, "..", "controllers", "qrController.js"), "utf8");

/** The block that runs only when a scan OPENS a table. */
const creationBlock = (() => {
  const start = QR_ROUTE.indexOf("let created = false;");
  return QR_ROUTE.slice(start, QR_ROUTE.indexOf("created = true;", start));
})();

/** The block that runs when a scan JOINS a session already open. */
const reuseBlock = (() => {
  const start = QR_ROUTE.indexOf("if (customerCount) { validateCapacity");
  return QR_ROUTE.slice(start, start + 400);
})();

test("REGRESSION: opening a table requires a name", () => {
  assert.match(creationBlock, /Please enter your name/, "name must be enforced server-side");
});

test("REGRESSION: opening a table requires a valid 10-digit phone", () => {
  // Substring rather than regex: the pattern being asserted on is itself a
  // regex, and escaping one inside another reads terribly.
  assert.ok(
    creationBlock.includes("{10}"),
    "the phone must be length-checked, not merely accepted",
  );
  assert.ok(creationBlock.includes(".test(phone)"), "and the check must actually run");
  assert.match(creationBlock, /10-digit phone number/);
});

test("REGRESSION: the details are enforced ONLY when the session is created", () => {
  // If this check moved outside the creation branch, a diner joining an open
  // table would be asked for details again.
  const beforeCreation = QR_ROUTE.slice(
    QR_ROUTE.indexOf("const addSessionItems = async"),
    QR_ROUTE.indexOf("let created = false;"),
  );
  assert.ok(
    !/Please enter your name/.test(beforeCreation),
    "the name check must sit inside the !session branch, not before it",
  );
});

test("REGRESSION: joining an open session never demands details", () => {
  assert.ok(!/Please enter your name/.test(reuseBlock), "a later scan must not be asked");
  assert.ok(!/10-digit/.test(reuseBlock), "nor for a phone");
});

test("joining an open session still accepts details if they are sent", () => {
  // The till may fill in a walk-in's details later; that path stays open.
  assert.match(reuseBlock, /session\.customerName = customerName/);
  assert.match(reuseBlock, /session\.customerPhone = customerPhone/);
});

// ---- guest count ------------------------------------------------------

test("REGRESSION: a missing guest count defaults to 1 rather than failing", () => {
  // The diner is no longer asked, so nothing is sent. If this threw, every
  // first order would break.
  const table = { capacity: 4, tableNumber: 7 };
  assert.equal(validateCapacity(table, undefined), 1);
  assert.equal(validateCapacity(table, null), 1);
  assert.equal(validateCapacity(table, ""), 1);
  assert.equal(validateCapacity(table, 0), 1);
});

test("a real guest count from the till is still honoured and capped", () => {
  const table = { capacity: 4, tableNumber: 7 };
  assert.equal(validateCapacity(table, 3), 3);
  assert.throws(() => validateCapacity(table, 5), /maximum capacity of 4/);
});

// ---- the customer-facing page ----------------------------------------

const PAGE = fs.readFileSync(
  path.join(__dirname, "..", "..", "pos-frontend", "src", "pages", "OrderOnline.jsx"),
  "utf8",
);

test("REGRESSION: the Number of People field is gone from the QR page", () => {
  assert.ok(!/placeholder="Guests"/.test(PAGE), "the guests input must be removed");
  assert.ok(!/cust\.guests/.test(PAGE), "and its state with it");
  assert.ok(!/customerCount:/.test(PAGE), "and it must not be sent");
});

test("REGRESSION: the page asks for details only when there is no session", () => {
  assert.match(PAGE, /\{session \? \(/, "the details block is conditional on the session");
  assert.match(PAGE, /Adding to the open order on/, "a returning scan is told what it joined");
});

test("REGRESSION: a later scan does not resend details over the open session's", () => {
  assert.match(
    PAGE,
    /\.\.\.\(session[\s\S]{0,80}\?\s*\{\}/,
    "customerName/Phone must be omitted when a session already exists",
  );
});
