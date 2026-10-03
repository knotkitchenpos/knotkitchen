const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { qualifies, idempotencyKeyFor } = require("../services/orderCharge");
const money = require("../services/money");

/**
 * Which orders KnotKitchen debits the restaurant's wallet for.
 *
 * The diner pays the platform fee online, on top of the bill, and the wallet
 * is then debited exactly that. So the question is no longer "is this source
 * chargeable" but "did the diner pay a fee on this order" -- the snapshot
 * quoted at checkout. No snapshot (cash, counter, POS, payment links, legacy
 * orders) means nothing is debited, whatever the source; and the spec's
 * exclusions -- failed, cancelled, unpaid -- still stop a debit.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// ₹3 + 18% GST, as quoted to the diner at checkout.
const FEE = { amountPaise: 300, taxPaise: 54, totalPaise: 354, taxPercent: 18 };

const paidWebsiteOrder = (over = {}) => ({
  source: "WEBSITE",
  orderStatus: "Completed",
  payments: [{ method: "online", status: "paid", amount: 503.54 }],
  paymentData: { gatewayOrderId: "KK-W-1", gatewayPaymentId: "cf_1" },
  platformCharge: { ...FEE, status: null },
  isDeleted: false,
  ...over,
});

test("a paid website order carrying a fee is charged", () => {
  assert.equal(qualifies(paidWebsiteOrder()).ok, true);
});

test("REGRESSION: the exclusions in the spec are all refused, with a reason", () => {
  const refused = {
    cancelled: paidWebsiteOrder({ orderStatus: "Cancelled" }),
    refunded: paidWebsiteOrder({ orderStatus: "Refunded" }),
    unpaid: paidWebsiteOrder({ payments: [] }),
    "payment pending": paidWebsiteOrder({ payments: [{ status: "pending" }] }),
    "payment failed": paidWebsiteOrder({ payments: [{ status: "failed" }] }),
    deleted: paidWebsiteOrder({ isDeleted: true }),
    "no fee collected": paidWebsiteOrder({ platformCharge: undefined }),
  };

  for (const [label, order] of Object.entries(refused)) {
    const verdict = qualifies(order);
    assert.equal(verdict.ok, false, `${label} must not be charged`);
    assert.ok(verdict.reason, `${label} must record WHY it was not charged`);
  }
});

test("REGRESSION: an order the diner paid no fee on is never debited, whatever its source", () => {
  // Debiting a fee nobody collected would take the restaurant's own money.
  for (const source of ["WEBSITE", "QR", "POS", "MARKETPLACE", "PHONE", "SOMETHING_NEW"]) {
    for (const platformCharge of [undefined, {}, { status: null, totalPaise: 0 }]) {
      const verdict = qualifies(paidWebsiteOrder({ source, platformCharge }));
      assert.equal(verdict.ok, false, source);
      assert.equal(verdict.permanent, true, `${source}: a settled fact, stamp it`);
      assert.equal(verdict.reason, "No platform fee was collected.");
    }
  }
});

test("payment status is read the way the rest of the codebase reads it", () => {
  // `payments[].status === "paid"` is the established idiom; a split payment
  // has more than one entry.
  const split = paidWebsiteOrder({
    payments: [{ status: "failed" }, { status: "paid" }],
  });
  assert.equal(qualifies(split).ok, true, "one successful payment is enough");
  assert.equal(
    qualifies(paidWebsiteOrder({ payments: [{ status: "PAID" }] })).ok,
    true,
    "case must not decide whether someone is billed",
  );
});

test("the idempotency key is per order, so a retry cannot double-charge", () => {
  assert.equal(idempotencyKeyFor("abc123"), "order-charge-abc123");
  assert.notEqual(idempotencyKeyFor("abc123"), idempotencyKeyFor("abc124"));
});

test("SOURCE: an insufficient balance never blocks the order", () => {
  // KnotKitchen's billing must not be able to stop a restaurant trading.
  const src = SRC("services/orderCharge.js");
  assert.match(src, /InsufficientBalanceError/, "a shortfall is an expected outcome");
  assert.match(src, /status: "PENDING"/, "the fee is recorded as owed, not dropped");
  assert.ok(
    !/throw err;\s*\n\s*\}\s*\n\s*\};\s*$/m.test(src.slice(src.indexOf("const chargeOrder"))),
    "chargeOrder must not rethrow a shortfall",
  );
});

test("SOURCE: dues are collected oldest first and stop at the next shortfall", () => {
  const src = SRC("services/orderCharge.js");
  assert.match(src, /sort\(\{ "platformCharge\.chargedAt": 1 \}\)/, "oldest first");
  assert.match(src, /if \(err instanceof InsufficientBalanceError\) break;/, "stop, do not skip ahead");
});

test("SOURCE: platformCharge is declared on the schema", () => {
  // A field written but not declared is dropped silently by Mongoose, which
  // would make the idempotency stamp a no-op and re-charge every order.
  const Order = require("../models/orderModel");
  for (const field of ["status", "totalPaise", "chargedAt", "ledgerEntryId", "reason"]) {
    assert.ok(
      Order.schema.path(`platformCharge.${field}`),
      `platformCharge.${field} missing from the schema`,
    );
  }
});

test("REGRESSION: an unpaid order is left open, not permanently exempted", () => {
  // A website order is created with its payment PENDING and becomes paid
  // later. Stamping NOT_APPLICABLE on first sight would exempt every website
  // order from the fee forever -- the charge would silently never collect.
  const notYet = qualifies(paidWebsiteOrder({ payments: [{ status: "pending" }] }));
  assert.equal(notYet.ok, false);
  assert.equal(notYet.permanent, false, "an unpaid order must stay chargeable later");

  // Everything else is a settled fact and may be stamped.
  const settled = {
    cancelled: paidWebsiteOrder({ orderStatus: "Cancelled" }),
    refunded: paidWebsiteOrder({ orderStatus: "Refunded" }),
    deleted: paidWebsiteOrder({ isDeleted: true }),
    "no fee": paidWebsiteOrder({ source: "POS", platformCharge: undefined }),
  };
  for (const [label, order] of Object.entries(settled)) {
    assert.equal(qualifies(order).permanent, true, `${label} is final`);
  }
});

test("SOURCE: only a permanent refusal is written to the order", () => {
  const src = SRC("services/orderCharge.js");
  assert.match(src, /if \(verdict\.permanent\) \{/, "a transient refusal must not be stamped");
});

// --- Paid ONLINE only, from the dates CSD picks ------------------------------

const BOTH = { enabled: true, amountPaise: 300, taxable: true };

test("only an order paid through the gateway is charged; cash and counter payments never are", () => {
  // Website checkout and a table QR paid online both stamp the gateway order id.
  assert.equal(qualifies(paidWebsiteOrder()).ok, true, "website, paid online");
  assert.equal(
    qualifies(paidWebsiteOrder({ source: "QR", paymentData: { gatewayOrderId: "KK-T-9" } })).ok,
    true,
    "table QR, paid online",
  );

  const offline = {
    cash: { payments: [{ method: "cash", status: "paid" }], paymentData: {} },
    "card at the counter": { payments: [{ method: "card", status: "paid" }], paymentData: undefined },
    "UPI at the till, typed in as online": { payments: [{ method: "online", status: "paid" }], paymentData: { gatewayOrderId: "" } },
    "pay at pickup, settled in cash": { source: "QR", payments: [{ method: "cash", status: "paid" }], paymentData: {} },
  };
  for (const [label, over] of Object.entries(offline)) {
    const verdict = qualifies(paidWebsiteOrder(over));
    assert.equal(verdict.ok, false, `${label} must not be charged`);
    assert.equal(verdict.permanent, true, `${label} is settled; stamp it`);
    assert.match(verdict.reason, /not paid online/);
  }

  // Unpaid is still "not yet", not "not online".
  const pending = qualifies(paidWebsiteOrder({ payments: [{ status: "pending" }], paymentData: {} }));
  assert.equal(pending.permanent, false);
});

test("the platform fee ships per source -- website ₹3, table QR ₹1 -- each OFF with no date", () => {
  const { PlatformBillingConfig } = require("../models/platformBillingModel");
  const Order = require("../models/orderModel");
  const fresh = new PlatformBillingConfig();
  for (const [key, paise] of [["websiteOrderCharge", 300], ["qrOrderCharge", 100]]) {
    assert.deepEqual(
      [fresh[key].amountPaise, fresh[key].enabled, fresh[key].effectiveFrom, fresh[key].taxable],
      [paise, false, null, true],
      key,
    );
  }
  // One charge per source: no list of sources to keep in step any more...
  assert.equal(PlatformBillingConfig.schema.path("websiteOrderCharge.chargeableSources"), undefined);
  // ...and the sources priced are the ones the order channels actually write.
  const sources = Order.schema.path("source").enumValues;
  for (const s of ["WEBSITE", "QR"]) assert.ok(sources.includes(s), s);
});

test("the charge starts at the platform date, and a store date can only delay it", async () => {
  const { resolveOrderCharge } = require("../services/pricing");
  const config = {
    websiteOrderCharge: { ...BOTH, effectiveFrom: new Date("2026-10-01T00:00:00+05:30") },
  };
  const at = (iso, override = null) => resolveOrderCharge({ config, override, source: "WEBSITE", on: new Date(iso) });

  assert.equal((await at("2026-09-30T23:59:00+05:30")).enabled, false, "before the platform date");
  assert.equal((await at("2026-10-01T00:00:00+05:30")).enabled, true, "on the platform date");

  const later = { orderChargeFrom: new Date("2026-11-01T00:00:00+05:30") };
  assert.equal((await at("2026-10-15T12:00:00+05:30", later)).enabled, false, "store starts later");
  assert.equal((await at("2026-11-01T00:00:00+05:30", later)).enabled, true);

  // A store date before the platform's cannot bring the charge forward.
  const earlier = { orderChargeFrom: new Date("2026-01-01") };
  assert.equal((await at("2026-09-15T12:00:00+05:30", earlier)).enabled, false);

  // No platform date: nothing is charged, whatever the store says.
  const undated = await resolveOrderCharge({
    config: { websiteOrderCharge: { ...BOTH, effectiveFrom: null } },
    override: later,
    source: "WEBSITE",
    on: new Date("2027-01-01"),
  });
  assert.equal(undated.enabled, false);
});

test("each source has its own fee and per-store rate: null means the platform amount, 0 is a real rate", async () => {
  const { resolveOrderCharge } = require("../services/pricing");
  const config = {
    websiteOrderCharge: { enabled: true, amountPaise: 300, effectiveFrom: new Date("2020-01-01") },
    qrOrderCharge: { enabled: true, amountPaise: 100, effectiveFrom: new Date("2020-01-01") },
  };
  const fee = async (source, override) => {
    const c = await resolveOrderCharge({ config, override, source });
    return [c.enabled, c.amountPaise, c.source];
  };
  assert.deepEqual(await fee("WEBSITE", { onlinePaidOrderCharge: null }), [true, 300, "platform"]);
  assert.deepEqual(await fee("WEBSITE", {}), [true, 300, "platform"]);
  assert.deepEqual(await fee("WEBSITE", { onlinePaidOrderCharge: 5, qrPaidOrderCharge: 2 }), [true, 500, "restaurant"]);
  assert.deepEqual(await fee("WEBSITE", { onlinePaidOrderCharge: 0 }), [true, 0, "restaurant"]);
  assert.deepEqual(await fee("QR", { onlinePaidOrderCharge: 5 }), [true, 100, "platform"], "the website rate never prices a table");
  assert.deepEqual(await fee("QR", { qrPaidOrderCharge: 2 }), [true, 200, "restaurant"]);
  // The table-QR fee has its own switch.
  const qrOff = await resolveOrderCharge({ config: { ...config, qrOrderCharge: { ...config.qrOrderCharge, enabled: false } }, override: null, source: "QR" });
  assert.equal(qrOff.enabled, false);
  // Any other source (the POS, a marketplace) has no platform fee.
  for (const source of ["POS", "MARKETPLACE", undefined]) {
    const none = await resolveOrderCharge({ config, override: null, source });
    assert.deepEqual([none.enabled, none.amountPaise], [false, 0], String(source));
    assert.match(none.reason, /is not chargeable/);
  }
  // A demo store's customers pay none.
  assert.deepEqual(await fee("QR", { billingExempt: true }), [false, 100, "platform"]);
});

test("SOURCE: the debit is the fee the diner paid, never a rate looked up again", () => {
  // CSD may change the rate between checkout and the debit; the wallet must
  // still lose exactly what the diner was charged.
  const src = SRC("services/orderCharge.js");
  const quote = src.slice(src.indexOf("const quotePlatformFee"), src.indexOf("const isPaid ="));
  assert.match(quote, /resolveOrderCharge\(/, "the rate is read once, when the fee is quoted");
  const rest = src.slice(src.indexOf("const isPaid ="));
  assert.ok(!/resolveOrderCharge\(|getPlatformConfig\(|computeTax\(/.test(rest), "debits read the stored snapshot only");
  assert.match(rest, /amountPaise: stamp\.totalPaise/);
});

test("an existing config row gets the shipped prices, OFF, and admin values are never touched", async () => {
  const pricing = require("../services/pricing");
  const { PlatformBillingConfig } = require("../models/platformBillingModel");
  const realFindOne = PlatformBillingConfig.findOne;
  const load = async (fields) => {
    const doc = new PlatformBillingConfig(fields);
    let saves = 0;
    doc.save = async () => { saves += 1; return doc; };
    PlatformBillingConfig.findOne = async () => doc;
    try {
      const got = await pricing.getPlatformConfig();
      return { got, saves };
    } finally {
      PlatformBillingConfig.findOne = realFindOne;
    }
  };

  // Never configured: priced, and still off.
  const { got: old, saves } = await load({
    websiteOrderCharge: { enabled: false, amountPaise: 0, effectiveFrom: null },
    qrOrderCharge: { enabled: false, amountPaise: 0, effectiveFrom: null },
    ebillCharge: { enabled: false, amountPaise: 0, effectiveFrom: null },
  });
  assert.equal(saves, 1);
  assert.equal(old.websiteOrderCharge.amountPaise, 300);
  assert.equal(old.websiteOrderCharge.enabled, false, "backfill never switches it on");
  assert.equal(old.websiteOrderCharge.effectiveFrom, null);
  assert.deepEqual([old.qrOrderCharge.amountPaise, old.qrOrderCharge.enabled], [100, false]);
  assert.equal(old.ebillCharge.amountPaise, 25);
  assert.equal(old.ebillCharge.enabled, false);

  // An admin's choices, each on its own, stand.
  const set = {
    websiteOrderCharge: { enabled: true, amountPaise: 0, effectiveFrom: new Date("2026-10-01") },
    qrOrderCharge: { enabled: false, amountPaise: 0, effectiveFrom: new Date("2026-11-01") },
    ebillCharge: { enabled: false, amountPaise: 0, effectiveFrom: new Date("2026-12-01") },
  };
  const { got: admin, saves: adminSaves } = await load(set);
  assert.equal(adminSaves, 0, "nothing to backfill");
  assert.equal(admin.websiteOrderCharge.amountPaise, 0);
  assert.equal(admin.qrOrderCharge.amountPaise, 0);
  assert.equal(admin.ebillCharge.amountPaise, 0);

  const priced = await load({
    websiteOrderCharge: { enabled: false, amountPaise: 1200 },
    qrOrderCharge: { enabled: false, amountPaise: 150 },
    ebillCharge: { enabled: false, amountPaise: 50 },
  });
  assert.equal(priced.saves, 0);
  assert.equal(priced.got.websiteOrderCharge.amountPaise, 1200);
  assert.equal(priced.got.qrOrderCharge.amountPaise, 150);
  assert.equal(priced.got.ebillCharge.amountPaise, 50);
});
