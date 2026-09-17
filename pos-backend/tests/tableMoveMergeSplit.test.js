const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { validateSplits, splitLabel } = require("../services/splitPayment");

test("a split must add up to the bill, with counter methods only", () => {
  assert.equal(validateSplits([{ method: "cash", amount: 500 }, { method: "upi", amount: 300 }], 800).ok, true);
  assert.equal(validateSplits([{ method: "cash", amount: 500 }, { method: "upi", amount: 299 }], 800).ok, false);
  assert.equal(validateSplits([{ method: "cash", amount: 800 }], 800).ok, false, "one part is not a split");
  assert.equal(validateSplits([{ method: "cash", amount: 500 }, { method: "online", amount: 300 }], 800).ok, false);
  assert.equal(validateSplits([{ method: "cash", amount: 0 }, { method: "upi", amount: 800 }], 800).ok, false);
  // Paisa rounding does not block an exact split.
  assert.equal(validateSplits([{ method: "cash", amount: 33.33 }, { method: "upi", amount: 33.33 }, { method: "card", amount: 33.34 }], 100).ok, true);
});

test("the split reads on the order as each part and its method", () => {
  const { parts } = validateSplits([{ method: "CASH", amount: 500 }, { method: "UPI", amount: 300 }], 800);
  assert.equal(splitLabel(parts, (m) => ({ CASH: "Cash", UPI: "UPI" })[m]), "Split (Cash ₹500.00 + UPI ₹300.00)");
});

test("move and merge routes exist and the payment path handles SPLIT parts", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "tableSessionRoute.js"), "utf8");
  assert.match(routes, /"\/:id\/move"\)\.post\(isVerifiedUser, moveSession\)/);
  assert.match(routes, /"\/:id\/merge"\)\.post\(isVerifiedUser, mergeSessions\)/);
  const ctrl = fs.readFileSync(path.join(__dirname, "..", "controllers", "tableSessionController.js"), "utf8");
  assert.match(ctrl, /validateSplits\(req\.body\.splits, payableAmount\)/);
  assert.match(ctrl, /PaymentTransaction\.create\(\n\s+parts\.map/, "one ledger entry per part");
  // A move rewrites the kitchen orders' table; a merge re-parents them.
  assert.match(ctrl, /\{ tableSessionId: session\._id, isDeleted: \{ \$ne: true \} \}, \{ \$set: \{ table: target\._id \} \}/);
  assert.match(ctrl, /\$set: \{ tableSessionId: target\._id, table: target\.tableId \}/);
});
