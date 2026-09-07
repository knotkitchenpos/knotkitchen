const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { idempotencyKeyFor } = require("../services/recharge");
const { resolvePlatformGateway } = require("../services/paymentGateway");

/**
 * Money going INTO the Business Balance.
 *
 * The hazard here is not the usual one. A diner's payment belongs to the
 * restaurant, so resolveGateway deliberately prefers the store's own Cashfree
 * account. A balance top-up is the opposite: the money is KnotKitchen's, and
 * running one through the restaurant's account would pay the restaurant its
 * own money and still credit its balance. Free balance, funded by nobody.
 *
 * So: recharges resolve through the PLATFORM gateway, always, and these tests
 * hold that boundary.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

test("REGRESSION: a top-up never resolves a store's own gateway", () => {
  const code = stripComments(SRC("services/recharge.js"));
  assert.match(code, /resolvePlatformGateway/, "recharges must use KnotKitchen's own account");
  assert.ok(
    !/\bresolveGateway\b/.test(code),
    "resolveGateway prefers the STORE's account -- a top-up through it credits balance for money KnotKitchen never received",
  );
});

test("REGRESSION: the webhook verifies a top-up with the platform secret", () => {
  // Otherwise a restaurant holding its own Cashfree secret could sign a
  // top-up event itself and credit its own balance.
  const code = stripComments(SRC("controllers/cashfreeWebhookController.js"));
  assert.match(
    code,
    /recharge \? resolvePlatformGateway\(\) : await resolveGateway/,
    "the secret must follow whose money it is",
  );
});

test("the platform resolver is the platform's, and reports itself as such", () => {
  const gw = resolvePlatformGateway();
  assert.equal(gw.source, "platform");
  assert.equal(gw.provider, "cashfree");
  // Unconfigured must read as disabled rather than as empty-but-usable
  // credentials -- that is how the Razorpay keys looked configured for weeks
  // while blank.
  assert.equal(typeof gw.enabled, "boolean");
});

test("one idempotency key per gateway order", () => {
  assert.equal(idempotencyKeyFor("KKBAL-ABC-1"), "recharge-KKBAL-ABC-1");
  assert.notEqual(idempotencyKeyFor("a"), idempotencyKeyFor("b"));
});

test("SOURCE: the intent is written before the customer leaves", () => {
  // A callback naming a gateway order we never opened has to find nothing.
  // Creating the row on success instead would make every forged event
  // creditable.
  const code = SRC("services/recharge.js");
  const created = code.indexOf("RechargeOrder.create");
  const opened = code.indexOf("cashfree.createOrder");
  assert.ok(created !== -1 && opened !== -1, "anchors moved; retarget this guard");
  assert.ok(created < opened, "the intent must exist before Cashfree is called");
});

test("SOURCE: nothing credits on the client's word", () => {
  const code = stripComments(SRC("services/recharge.js"));
  assert.match(code, /cashfree\.isOrderPaid/, "the gateway is asked, not told");
  assert.match(code, /toPaise\(status\.amount\)/, "credit what was PAID, not what was requested");

  // And the browser-return route re-asks rather than trusting its caller.
  const route = stripComments(SRC("routes/businessBalanceRoute.js"));
  assert.match(route, /finalizeRecharge/, "the verify route goes through the same check");
});

test("REGRESSION: a TEST payment cannot credit a PROD balance", () => {
  const code = stripComments(SRC("services/recharge.js"));
  assert.match(
    code,
    /intent\.environment !== gw\.environment/,
    "sandbox money must not top up a real balance",
  );
});

test("SOURCE: no balance route accepts a restaurantId from the caller", () => {
  // The legacy prototype took it from the body and the path, which let any
  // signed-in user read any restaurant's finances.
  const route = SRC("routes/businessBalanceRoute.js");
  assert.match(route, /const ownRestaurantId = \(req\)/);
  assert.ok(
    !/req\.body\?\.restaurantId|req\.params\.restaurantId/.test(route),
    "the restaurant always comes from the session",
  );
});

test("SOURCE: settling dues cannot fail a top-up that already succeeded", () => {
  const code = SRC("services/recharge.js");
  const after = code.slice(code.indexOf("settlePendingCharges"));
  assert.match(after, /catch \(err\)/, "the credit is not in doubt once it has happened");
});
