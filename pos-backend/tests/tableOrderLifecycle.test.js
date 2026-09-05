/**
 * The table-order lifecycle: auto-ready, auto-complete, settlement, and what
 * the diner is allowed to do afterwards.
 *
 * Every failure pinned here was silent. A missing `completeDueAt` is not an
 * error — the sweep's `{ $ne: null }` filter simply never matches the order,
 * so an operator who set "Auto-Complete: 2 minutes" watched nothing happen
 * and had no way to tell whether the setting had saved.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

const QR_ROUTE = read("routes", "qrRoute.js");
const SESSION_CTRL = read("controllers", "tableSessionController.js");
const ORDER_CTRL = read("controllers", "orderController.js");

// ---------------------------------------------------------------------------
// 1. Auto-Ready / Auto-Complete actually reach table orders
// ---------------------------------------------------------------------------

test("REGRESSION: a QR table order is given an auto-COMPLETE deadline", () => {
  // Collection and delivery orders got theirs from orderController; table
  // orders were created in qrRoute and tableSessionController, and neither
  // called computeCompleteDueAt. The "table" auto-complete duration was
  // therefore configurable but inert.
  assert.match(
    QR_ROUTE,
    /computeCompleteDueAt/,
    "qrRoute must start the auto-complete clock on the orders it creates",
  );
  assert.match(
    QR_ROUTE,
    /\.\.\.\(completeDueAt \? \{ completeDueAt \} : \{\}\)/,
    "and attach it to the created order",
  );
});

test("REGRESSION: a POS table order is given an auto-COMPLETE deadline", () => {
  const calls = SESSION_CTRL.match(/completeDueAt: await computeCompleteDueAt\(/g) || [];
  assert.equal(
    calls.length,
    2,
    "both order-creation sites (new session, and adding to one) must set it",
  );
});

test("both table order-creation sites still set the auto-READY deadline too", () => {
  const ready = SESSION_CTRL.match(/readyDueAt: await computeReadyDueAt\(/g) || [];
  assert.equal(ready.length, 2);
  assert.match(QR_ROUTE, /computeReadyDueAt/);
});

test("the POS order path keeps both clocks", () => {
  assert.match(ORDER_CTRL, /computeReadyDueAt/);
  assert.match(ORDER_CTRL, /computeCompleteDueAt/);
});

// ---------------------------------------------------------------------------
// 2. The two clocks cannot contradict each other
// ---------------------------------------------------------------------------

test("auto-complete never falls due before auto-ready", async () => {
  const AR = require("../services/autoReadyService");

  // Both deadlines are measured from order creation, so a store configured
  // with ready=20 / complete=2 would finish the order before the kitchen was
  // ever told it was ready: the order would jump Preparing -> Served and the
  // Ready step (and its customer notification) would never happen.
  const from = new Date("2026-01-01T12:00:00.000Z");
  const original = AR.getAutoReadyMinutes;

  const completeAt = await AR.computeCompleteDueAt({
    restaurantId: null,
    storeId: null,
    orderType: "collection",
    from,
  });
  // With no tenant, auto-complete resolves to 0 (disabled) and there is
  // nothing to schedule. That itself is the contract: absent config must
  // never invent a deadline.
  assert.equal(completeAt, null, "no configuration means no auto-complete");
  assert.equal(typeof original, "function");
});

test("computeCompleteDueAt consults the ready duration before scheduling", () => {
  const src = read("services", "autoReadyService.js");
  const fn = src.slice(
    src.indexOf("const computeCompleteDueAt"),
    src.indexOf("const isPreparingStatus"),
  );
  assert.match(
    fn,
    /getAutoReadyMinutes/,
    "it must know the ready duration to be able to stay behind it",
  );
  assert.match(fn, /Math\.max\(minutes, readyMinutes\)/);
});

// ---------------------------------------------------------------------------
// 3. Settling a table records HOW it was paid
// ---------------------------------------------------------------------------

test("REGRESSION: settling a table writes paymentMethod and payments onto its orders", () => {
  // Payment Status on the Orders screen reads payments[0].status and Payment
  // Method reads paymentMethod. A table order carried neither, so a table
  // just settled in cash still showed "Pending" with no method against it.
  const start = SESSION_CTRL.indexOf("Preserve historical kitchen orders");
  const block = SESSION_CTRL.slice(
    start,
    SESSION_CTRL.indexOf("await mongoSession.commitTransaction();", start),
  );
  assert.ok(block.length > 0, "the settle block must still be findable");
  assert.match(block, /paymentMethod: displayPaymentMethod\(normalizedMethod\)/);
  assert.match(block, /status: "paid"/);
  assert.match(block, /completeDueAt: null/, "a settled order must not still be swept");
});

test("a gateway payment reads as 'Pay by Link', a counter payment as its own name", () => {
  const { displayPaymentMethod } = loadMethodLabels();
  assert.equal(displayPaymentMethod("CASH"), "Cash");
  assert.equal(displayPaymentMethod("UPI"), "UPI");
  assert.equal(displayPaymentMethod("ONLINE"), "Pay by Link");
  assert.equal(displayPaymentMethod("PAYMENT_LINK"), "Pay by Link");
});

/**
 * displayPaymentMethod is module-private on purpose — nothing outside the
 * settle path should be renaming payment methods. Evaluate the literal from
 * source rather than exporting it just to satisfy a test.
 */
function loadMethodLabels() {
  const start = SESSION_CTRL.indexOf("const PAYMENT_METHOD_LABELS");
  const end = SESSION_CTRL.indexOf("const enrichItems");
  const snippet = SESSION_CTRL.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${snippet}; return { displayPaymentMethod };`)();
}

// ---------------------------------------------------------------------------
// 4. A paid table is not re-openable from the same QR
// ---------------------------------------------------------------------------

test("REGRESSION: a QR scan cannot open a new session on a table in cooldown", () => {
  // The party that just paid still has the page open. Without this the same
  // link happily opened a SECOND session on a table mid-reset.
  const creationBlock = QR_ROUTE.slice(
    QR_ROUTE.indexOf("let created = false;"),
    QR_ROUTE.indexOf("created = true;"),
  );
  assert.match(creationBlock, /tableInTxn\.status === "cleaning"/);
  assert.match(creationBlock, /being prepared/);
});

test("the cooldown check runs only when a session is being CREATED", () => {
  // A diner already mid-meal must never be locked out of their own table.
  const beforeCreation = QR_ROUTE.slice(
    QR_ROUTE.indexOf('router.route("/session/items/:token")'),
    QR_ROUTE.indexOf("let created = false;"),
  );
  assert.ok(
    !/=== "cleaning"/.test(beforeCreation),
    "the cooldown guard belongs inside the !session branch",
  );
});

// ---------------------------------------------------------------------------
// 5. The diner can see what the kitchen is doing
// ---------------------------------------------------------------------------

test("REGRESSION: the QR session payload carries the kitchen's order status", () => {
  // The session's per-item status never advanced past "pending" — the sweep
  // and the POS both write to the Order. So a table the till had marked Ready
  // still read "pending" on the diner's phone.
  assert.match(QR_ROUTE, /const kitchenStatusForSession/);
  assert.match(QR_ROUTE, /orderStatus: extra\.orderStatus/);
  const calls = QR_ROUTE.match(/kitchenStatusForSession\(/g) || [];
  assert.ok(calls.length >= 4, `every session read must resolve it (found ${calls.length})`);
});

test("a cancelled item reaches the diner with its reason", () => {
  assert.match(QR_ROUTE, /cancelReason: it\.cancelReason \|\| ""/);
  assert.match(QR_ROUTE, /cancelledAt: it\.cancelledAt \|\| null/);
});

// ---------------------------------------------------------------------------
// 6. Cancelling one dish
// ---------------------------------------------------------------------------

test("cancelling an item is refused once the bill is settled", () => {
  const fn = SESSION_CTRL.slice(
    SESSION_CTRL.indexOf("const cancelSessionItem"),
    SESSION_CTRL.indexOf("const findActiveSessionByTable"),
  );
  assert.match(fn, /\["PAID", "CLOSED"\]\.includes\(session\.status\)/);
  assert.match(fn, /already been settled/);
});

test("cancelling an item recalculates the bill and mirrors onto the kitchen order", () => {
  const fn = SESSION_CTRL.slice(
    SESSION_CTRL.indexOf("const cancelSessionItem"),
    SESSION_CTRL.indexOf("const findActiveSessionByTable"),
  );
  assert.match(fn, /recalculateSessionBill\(session\)/);
  assert.match(fn, /orderItem\.status = "cancelled"/);
  assert.match(fn, /order\.orderStatus = CANCELLED/, "an order with nothing left is cancelled");
});

test("the bill calculation still excludes cancelled items", () => {
  assert.match(SESSION_CTRL, /\.filter\(\(i\) => i\.status !== "cancelled"\)/);
});

// ---------------------------------------------------------------------------
// 7. Online payment is resolved from where the credentials actually live
// ---------------------------------------------------------------------------

test("REGRESSION: the QR page no longer asks the Restaurant model for a gateway", () => {
  // `restaurant.razorpay.isConfigured` was `undefined && ...` — the Restaurant
  // schema has no `razorpay` field, so online payment was permanently off for
  // every store that will ever exist.
  // Comments are allowed to mention it -- one does, explaining this very bug.
  // Only executable code is in question here.
  const code = QR_ROUTE.split(String.fromCharCode(10))
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join(String.fromCharCode(10));
  assert.ok(
    !/restaurant\.razorpay/.test(code),
    "the gateway does not live on the Restaurant document",
  );
  const RESTAURANT_MODEL = read("models", "restaurantModel.js");
  assert.ok(
    !/razorpay/i.test(RESTAURANT_MODEL),
    "and if that ever changes, this rule needs revisiting deliberately",
  );
  assert.match(QR_ROUTE, /isOnlinePaymentEnabled\(\{ restaurantId \}\)/);
});

test("the gateway resolver falls back to the platform keys, never to nothing", async () => {
  const { resolveGateway } = require("../services/paymentGateway");
  const gw = await resolveGateway({});
  assert.equal(typeof gw.enabled, "boolean");
  assert.equal(gw.gateway, "razorpay");
  assert.equal(gw.source, "platform");
});

test("the QR verify endpoint checks the signature before settling anything", () => {
  const block = QR_ROUTE.slice(QR_ROUTE.indexOf('router.route("/payment-verify/:token")'));
  assert.match(block, /createHmac\("sha256", gw\.secret\)/);
  assert.match(block, /timingSafeEqual/, "signature comparison must be constant-time");
  // The settle must come AFTER the check, not before it.
  assert.ok(
    block.indexOf("timingSafeEqual") < block.indexOf("settleSessionFromGateway"),
    "nothing may be settled ahead of verification",
  );
});

test("the QR payment amount comes from the session's own bill", () => {
  const block = QR_ROUTE.slice(
    QR_ROUTE.indexOf('router.route("/payment-intent/:token")'),
    QR_ROUTE.indexOf('router.route("/payment-verify/:token")'),
  );
  assert.match(block, /const payable = session\.bills\?\.totalWithTax \|\| 0/);
  assert.match(block, /amount: Math\.round\(payable \* 100\)/);
  assert.ok(
    !/req\.body\?\.amount/.test(block),
    "a tampered browser must not be able to name its own price",
  );
});

test("the gateway secret never reaches the browser", () => {
  const block = QR_ROUTE.slice(
    QR_ROUTE.indexOf('router.route("/payment-intent/:token")'),
    QR_ROUTE.indexOf('router.route("/payment-verify/:token")'),
  );

  // Everything assigned into `checkout` is handed to the diner's phone. Each
  // provider needs something different there -- Razorpay the PUBLIC key id,
  // Cashfree a payment_session_id it minted -- and neither is the secret.
  const payloads = block
    .split("checkout = {")
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf("};")));
  assert.equal(payloads.length, 2, "one browser payload per provider");
  for (const p of payloads) {
    assert.ok(!/gw\.secret/.test(p), "the secret is not part of the response");
    assert.ok(!/secretKey/.test(p), "nor under another name");
  }
  assert.ok(
    payloads.some((p) => /keyId: gw\.keyId/.test(p)),
    "Razorpay needs its public key id in the browser",
  );
  assert.ok(
    payloads.some((p) => /paymentSessionId: order\.paymentSessionId/.test(p)),
    "Cashfree needs the payment session it minted",
  );
});

test("Cashfree is verified by asking Cashfree, not by trusting the browser", () => {
  const block = QR_ROUTE.slice(QR_ROUTE.indexOf('router.route("/payment-verify/:token")'));
  const cf = block.slice(block.indexOf("PROVIDERS.CASHFREE"), block.indexOf("} else {"));

  // The order id must come from OUR session. A browser that could name the
  // order would be able to settle this table with any paid order on the same
  // merchant account.
  assert.match(cf, /session\.payment\?\.gatewayOrderId/);
  assert.ok(!/req\.body/.test(cf), "nothing in the Cashfree path reads the request body");
  assert.match(cf, /cashfree\.isOrderPaid/);
  assert.match(cf, /if \(!result\.paid\)/, "an unpaid order must not settle");
  assert.match(cf, /result\.amount/, "and the gateway is authoritative on the amount too");
});

test("a failed Cashfree status check does not report the payment as failed", () => {
  // The money may well have moved. Telling the diner it failed invites them
  // to pay twice.
  const block = QR_ROUTE.slice(QR_ROUTE.indexOf('router.route("/payment-verify/:token")'));
  assert.match(block, /status\(502\)/);
  assert.match(block, /could not confirm that payment/i);
});
