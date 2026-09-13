const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Call Waiter on the table QR page, and the alert it raises on the till.
 *
 * The header carried Request Bill; the diner wanted a person. The till side
 * existed already (socket event, popup, repeating beep), but a call only
 * arrived as a live event -- a till that reloaded, or whose socket had
 * dropped at that moment, never heard it while the table kept waiting.
 */

const FE = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", "src", ...p), "utf8");

test("the QR header offers Call Waiter, not Request Bill", () => {
  const page = FE("pages", "OrderOnline.jsx");
  const header = page.slice(page.indexOf("Sticky brand header"), page.indexOf("Search + tabs"));
  assert.match(header, /onClick=\{callWaiter\}/);
  assert.match(header, /Call Waiter/);
  assert.ok(!/Request Bill|onClick=\{requestBill\}/.test(header), "Request Bill is gone from the header");
  assert.match(page, /await qrCallWaiter\(token\)/);
});

test("the table name sits under the store name", () => {
  const page = FE("pages", "OrderOnline.jsx");
  const header = page.slice(page.indexOf("Sticky brand header"), page.indexOf("Search + tabs"));
  assert.ok(header.indexOf("{brandName}") < header.indexOf("{tableName}"));
});

test("the till beeps until acknowledged, and recovers calls it missed", () => {
  const popup = FE("components", "dashboard", "WaiterCallPopup.jsx");
  assert.match(popup, /useAlertBeep\(calls\.length > 0\)/);
  assert.match(popup, /socket\.on\("waiter:called", onCalled\)/);
  assert.match(popup, /dismissWaiterCall\(call\.tableId\)/);
  // Restored from the Table rows on every (re)connect.
  assert.match(popup, /\.filter\(\(t\) => t\?\.waiterCallActive\)/);
  assert.match(popup, /restore\(\);/);
});
