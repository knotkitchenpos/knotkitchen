const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { idempotencyKeyFor } = require("../services/ebillCharge");
const { resolveEBillCharge } = require("../services/pricing");
const money = require("../services/money");

/**
 * The per-e-bill charge: ₹0.25 a message, from the same Business Balance.
 *
 * Two rules make this different from the per-order charge, and both are the
 * kind that only show up in a support conversation if they are wrong:
 *
 *   charge on DELIVERY, never on an attempt   billing for a message the
 *                                             customer never received
 *
 *   charge EVERY delivered message            keying on the order would make
 *                                             every re-send free
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const CHARGE_ON = {
  ebillCharge: {
    enabled: true,
    amountPaise: money.toPaise(0.25),
    effectiveFrom: new Date("2020-01-01"),
    taxable: true,
  },
};

test("25 paise is stored and resolved exactly", async () => {
  // A quarter of a rupee is where a float representation would start to show.
  assert.equal(money.toPaise(0.25), 25);
  const r = await resolveEBillCharge({ config: CHARGE_ON });
  assert.equal(r.amountPaise, 25);
  assert.equal(money.formatINR(r.amountPaise), "₹0.25");
});

test("a thousand e-bills cost exactly ₹250, not ₹249.99…", () => {
  // The reason money is integer paise. In floats, 1000 × 0.25 happens to be
  // exact, but 0.25 + GST accumulated a thousand times is not.
  let total = 0;
  for (let i = 0; i < 1000; i += 1) total += money.toPaise(0.25);
  assert.equal(total, money.toPaise(250));
  assert.ok(Number.isInteger(total));
});

test("a per-restaurant rate overrides the platform one, and 0 is a real rate", async () => {
  const platform = await resolveEBillCharge({ config: CHARGE_ON, override: null });
  assert.equal(platform.amountPaise, 25);
  assert.equal(platform.source, "platform");

  const cheaper = await resolveEBillCharge({ config: CHARGE_ON, override: { ebillCharge: 0.1 } });
  assert.equal(cheaper.amountPaise, 10);
  assert.equal(cheaper.source, "restaurant");

  // Not the same as "unset" -- this restaurant sends e-bills free.
  const free = await resolveEBillCharge({ config: CHARGE_ON, override: { ebillCharge: 0 } });
  assert.equal(free.amountPaise, 0);
  assert.equal(free.source, "restaurant");
});

test("the charge is off until it is switched on AND its date has passed", async () => {
  const off = await resolveEBillCharge({ config: { ebillCharge: { enabled: false, amountPaise: 25 } } });
  assert.equal(off.enabled, false);

  const notYet = await resolveEBillCharge({
    config: { ebillCharge: { enabled: true, amountPaise: 25, effectiveFrom: new Date("2030-01-01") } },
  });
  assert.equal(notYet.enabled, false, "a future start date means not yet");

  const noDate = await resolveEBillCharge({
    config: { ebillCharge: { enabled: true, amountPaise: 25, effectiveFrom: null } },
  });
  assert.equal(noDate.enabled, false, "enabled with no start date charges nothing");
});

test("REGRESSION: every delivered message is charged, including a re-send", () => {
  // Keying on the order would make the second and every later send free, and
  // each one is a real WhatsApp message with a real cost.
  assert.equal(idempotencyKeyFor("req_1"), "ebill-req_1");
  assert.notEqual(idempotencyKeyFor("req_1"), idempotencyKeyFor("req_2"));

  const src = SRC("services/ebillCharge.js");
  assert.match(src, /idempotencyKeyFor = \(messageId\)/, "keyed by the message, not the order");
  assert.ok(
    !/idempotencyKeyFor = \(orderId\)|ebill-\$\{order/.test(src),
    "an order-keyed idempotency key makes re-sends free",
  );
});

test("REGRESSION: a failed send is never charged", () => {
  // Billing for a message the customer did not receive.
  const src = SRC("services/eBillService.js");
  assert.match(src, /if \(result\.sent\) \{/, "charged only when the provider confirmed delivery");

  // The CALL, not the import at the top of the file.
  const chargeAt = src.indexOf("fireEBillCharge({");
  const sendAt = src.indexOf("await sendEBillMessage");
  assert.ok(chargeAt !== -1 && sendAt !== -1, "anchors moved; retarget this guard");
  assert.ok(chargeAt > sendAt, "the send happens first, and its result decides");
});

test("SOURCE: a shortfall never fails a message already delivered", () => {
  const src = SRC("services/ebillCharge.js");
  assert.match(src, /InsufficientBalanceError/);
  assert.match(src, /return \{ charged: false, reason: "Insufficient Business Balance\." \}/);
  assert.match(src, /fireEBillCharge/, "fire-and-forget at the call site");
});

test("SOURCE: the ledger has a kind of its own for it", () => {
  // So the statement reads "E-bill sent" rather than lumping it in with the
  // per-order charge, and reporting can separate the two.
  const { DEBIT_KINDS } = require("../models/businessBalanceModel");
  assert.ok(DEBIT_KINDS.includes("EBILL_CHARGE"));
  assert.match(SRC("services/ebillCharge.js"), /kind: "EBILL_CHARGE"/);
});

test("SOURCE: it is configured, not hard-coded", () => {
  // 0.25 must not appear as a constant anywhere -- the whole point is that the
  // admin panel owns it.
  const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  for (const file of ["services/ebillCharge.js", "services/pricing.js"]) {
    const code = stripComments(SRC(file));
    assert.ok(!/0\.25|\b25\b/.test(code), `${file} hard-codes the e-bill price`);
  }

  // And the admin panel can set it.
  const ctrl = SRC("controllers/csdBillingConfigController.js");
  assert.match(ctrl, /body\.ebillCharge !== undefined/);
  assert.match(ctrl, /ebillCharge\.effectiveFrom/);
  assert.match(SRC("controllers/csdRestaurantController.js"), /"ebillCharge", "E-bill charge"/);
});
