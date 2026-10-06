const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { runAddOrder, OWNER } = require("./addOrderHarness");

// 50 off 200, no GST configured in a unit test.
const body = { orderType: "collection", paymentMethod: "cash", bills: { subtotal: 200, total: 150, discount: 50, tax: 0, totalWithTax: 150 } };
const STAFF = { ...OWNER, role: "Staff" };

test("REGRESSION: a discount by staff needs the Security PIN", async () => {
  // Any discount up to 100% went through with no PIN, while a void needed one.
  const out = await runAddOrder({ body, user: STAFF });
  assert.equal(out.error?.status, 403);
  assert.equal(out.error?.code, "PIN_REQUIRED", "the POS prompts for the PIN and retries on this code");
  assert.equal(out.saved.length, 0);
  assert.equal(out.customerWrites, 0);
});

test("the owner discounts without a PIN; no discount needs none; offline sync is exempt", async () => {
  assert.equal((await runAddOrder({ body, user: OWNER })).status, 201);
  const full = { ...body, bills: { subtotal: 200, total: 200, tax: 0, totalWithTax: 200 } };
  assert.equal((await runAddOrder({ body: full, user: STAFF })).status, 201);
  // The sale already happened offline, and a PIN token has expired by sync time.
  assert.equal((await runAddOrder({ body, user: STAFF, idempotencyKey: "offline:x1" })).status, 201);
});

test("a live Idempotency-Key header does not earn the offline exemption", async () => {
  const out = await runAddOrder({ body, user: STAFF, headers: { "Idempotency-Key": "x2" } });
  assert.equal(out.error?.code, "PIN_REQUIRED");
});

test("SOURCE: the PIN helpers are shared with requireProtectedAction", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "middlewares", "requirePermission.js"), "utf8");
  assert.match(src, /module\.exports = \{[^}]*hasPinAuthorization,[^}]*pinRequired,/s);
});
