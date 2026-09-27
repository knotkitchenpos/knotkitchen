const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { qualifies, idempotencyKeyFor } = require("../services/orderCharge");
const money = require("../services/money");

/**
 * Which orders KnotKitchen bills the restaurant for.
 *
 * The spec lists what must NOT be charged: failed, cancelled, unpaid,
 * duplicate, internal POS orders, and "other orders that Admin has not
 * configured as chargeable". Enumerating exclusions is the fragile way round
 * -- a source added later is chargeable by omission, and every restaurant on
 * the platform starts being billed for something nobody decided to bill for.
 *
 * So it is an allow-list, empty by default, and these tests hold it that way.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const CHARGE_ON = {
  enabled: true,
  amountPaise: money.toPaise(9),
  chargeableSources: ["WEBSITE"],
  taxable: true,
};

const paidWebsiteOrder = (over = {}) => ({
  source: "WEBSITE",
  orderStatus: "Completed",
  payments: [{ method: "online", status: "paid", amount: 500 }],
  paymentData: { gatewayOrderId: "KK-W-1", gatewayPaymentId: "cf_1" },
  isDeleted: false,
  ...over,
});

test("a paid website order is charged", () => {
  assert.equal(qualifies(paidWebsiteOrder(), CHARGE_ON).ok, true);
});

test("REGRESSION: the exclusions in the spec are all refused, with a reason", () => {
  const refused = {
    cancelled: paidWebsiteOrder({ orderStatus: "Cancelled" }),
    refunded: paidWebsiteOrder({ orderStatus: "Refunded" }),
    unpaid: paidWebsiteOrder({ payments: [] }),
    "payment pending": paidWebsiteOrder({ payments: [{ status: "pending" }] }),
    "payment failed": paidWebsiteOrder({ payments: [{ status: "failed" }] }),
    deleted: paidWebsiteOrder({ isDeleted: true }),
    "internal POS": paidWebsiteOrder({ source: "POS" }),
  };

  for (const [label, order] of Object.entries(refused)) {
    const verdict = qualifies(order, CHARGE_ON);
    assert.equal(verdict.ok, false, `${label} must not be charged`);
    assert.ok(verdict.reason, `${label} must record WHY it was not charged`);
  }
});

test("REGRESSION: a new order source is not chargeable by default", () => {
  // The failure this prevents: someone adds a source, ships it, and every
  // restaurant is quietly billed for a channel nobody priced.
  for (const source of ["QR", "MARKETPLACE", "PHONE", "SOMETHING_NEW"]) {
    const verdict = qualifies(paidWebsiteOrder({ source }), CHARGE_ON);
    assert.equal(verdict.ok, false, `${source} must be opt-in`);
    assert.match(verdict.reason, /not chargeable/);
  }

  // And with nothing configured at all, nothing is billed.
  const noSources = { ...CHARGE_ON, chargeableSources: [] };
  assert.equal(qualifies(paidWebsiteOrder(), noSources).ok, false);
});

test("the admin switches are honoured before anything else", () => {
  assert.equal(qualifies(paidWebsiteOrder(), { ...CHARGE_ON, enabled: false }).ok, false);

  // A restaurant set to zero is configured, not broken -- but there is
  // nothing to debit, so no ledger entry should be created for it.
  const free = qualifies(paidWebsiteOrder(), { ...CHARGE_ON, amountPaise: 0 });
  assert.equal(free.ok, false);
  assert.match(free.reason, /zero/i);
});

test("payment status is read the way the rest of the codebase reads it", () => {
  // `payments[].status === "paid"` is the established idiom; a split payment
  // has more than one entry.
  const split = paidWebsiteOrder({
    payments: [{ status: "failed" }, { status: "paid" }],
  });
  assert.equal(qualifies(split, CHARGE_ON).ok, true, "one successful payment is enough");
  assert.equal(
    qualifies(paidWebsiteOrder({ payments: [{ status: "PAID" }] }), CHARGE_ON).ok,
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
  const notYet = qualifies(paidWebsiteOrder({ payments: [{ status: "pending" }] }), CHARGE_ON);
  assert.equal(notYet.ok, false);
  assert.equal(notYet.permanent, false, "an unpaid order must stay chargeable later");

  // Everything else is a settled fact and may be stamped.
  const settled = {
    cancelled: paidWebsiteOrder({ orderStatus: "Cancelled" }),
    refunded: paidWebsiteOrder({ orderStatus: "Refunded" }),
    deleted: paidWebsiteOrder({ isDeleted: true }),
    "POS source": paidWebsiteOrder({ source: "POS" }),
  };
  for (const [label, order] of Object.entries(settled)) {
    assert.equal(qualifies(order, CHARGE_ON).permanent, true, `${label} is final`);
  }
  assert.equal(qualifies(paidWebsiteOrder(), { ...CHARGE_ON, enabled: false }).permanent, true);
});

test("SOURCE: only a permanent refusal is written to the order", () => {
  const src = SRC("services/orderCharge.js");
  assert.match(src, /if \(verdict\.permanent\) \{/, "a transient refusal must not be stamped");
});

// --- Paid ONLINE only, from the dates CSD picks ------------------------------

const BOTH = { ...CHARGE_ON, chargeableSources: ["WEBSITE", "QR"] };

test("only an order paid through the gateway is charged; cash and counter payments never are", () => {
  // Website checkout and a table QR paid online both stamp the gateway order id.
  assert.equal(qualifies(paidWebsiteOrder(), BOTH).ok, true, "website, paid online");
  assert.equal(
    qualifies(paidWebsiteOrder({ source: "QR", paymentData: { gatewayOrderId: "KK-T-9" } }), BOTH).ok,
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
    const verdict = qualifies(paidWebsiteOrder(over), BOTH);
    assert.equal(verdict.ok, false, `${label} must not be charged`);
    assert.equal(verdict.permanent, true, `${label} is settled; stamp it`);
    assert.match(verdict.reason, /not paid online/);
  }

  // Unpaid is still "not yet", not "not online".
  const pending = qualifies(paidWebsiteOrder({ payments: [{ status: "pending" }], paymentData: {} }), BOTH);
  assert.equal(pending.permanent, false);
});

test("the platform ships the charge priced at ₹9 for website + table QR, but OFF with no date", () => {
  const { PlatformBillingConfig } = require("../models/platformBillingModel");
  const Order = require("../models/orderModel");
  const fresh = new PlatformBillingConfig();
  assert.equal(fresh.websiteOrderCharge.amountPaise, 900);
  assert.deepEqual([...fresh.websiteOrderCharge.chargeableSources], ["WEBSITE", "QR"]);
  assert.equal(fresh.websiteOrderCharge.enabled, false);
  assert.equal(fresh.websiteOrderCharge.effectiveFrom, null);
  assert.equal(fresh.websiteOrderCharge.taxable, true);
  // The sources are the ones the order channels actually write.
  const sources = Order.schema.path("source").enumValues;
  for (const s of fresh.websiteOrderCharge.chargeableSources) assert.ok(sources.includes(s), s);
});

test("the charge starts at the platform date, and a store date can only delay it", async () => {
  const { resolveOrderCharge } = require("../services/pricing");
  const config = {
    websiteOrderCharge: { ...BOTH, effectiveFrom: new Date("2026-10-01T00:00:00+05:30") },
  };
  const at = (iso, override = null) => resolveOrderCharge({ config, override, on: new Date(iso) });

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
    on: new Date("2027-01-01"),
  });
  assert.equal(undated.enabled, false);

  // And qualifies says why.
  const early = await at("2026-09-30T10:00:00+05:30");
  assert.match(qualifies(paidWebsiteOrder(), early).reason, /before the per-order charge started/);
  assert.equal(qualifies(paidWebsiteOrder(), early).permanent, true);
});

test("a per-store amount of null means the platform amount; 0 is a real rate", async () => {
  const { resolveOrderCharge } = require("../services/pricing");
  const config = { websiteOrderCharge: { ...BOTH, amountPaise: 900, effectiveFrom: new Date("2020-01-01") } };
  const platform = await resolveOrderCharge({ config, override: { onlinePaidOrderCharge: null } });
  assert.deepEqual([platform.amountPaise, platform.source], [900, "platform"]);
  const none = await resolveOrderCharge({ config, override: {} });
  assert.deepEqual([none.amountPaise, none.source], [900, "platform"]);
  const custom = await resolveOrderCharge({ config, override: { onlinePaidOrderCharge: 5 } });
  assert.deepEqual([custom.amountPaise, custom.source], [500, "restaurant"]);
  const free = await resolveOrderCharge({ config, override: { onlinePaidOrderCharge: 0 } });
  assert.deepEqual([free.amountPaise, free.source], [0, "restaurant"]);
});

test("SOURCE: the charge is dated by when the order was placed", () => {
  assert.match(SRC("services/orderCharge.js"), /on: order\.createdAt/);
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

  // Never configured: priced, sourced, and still off.
  const { got: old, saves } = await load({
    websiteOrderCharge: { enabled: false, amountPaise: 0, effectiveFrom: null, chargeableSources: [] },
    ebillCharge: { enabled: false, amountPaise: 0, effectiveFrom: null },
  });
  assert.equal(saves, 1);
  assert.equal(old.websiteOrderCharge.amountPaise, 900);
  assert.deepEqual([...old.websiteOrderCharge.chargeableSources], ["WEBSITE", "QR"]);
  assert.equal(old.websiteOrderCharge.enabled, false, "backfill never switches it on");
  assert.equal(old.websiteOrderCharge.effectiveFrom, null);
  assert.equal(old.ebillCharge.amountPaise, 25);
  assert.equal(old.ebillCharge.enabled, false);

  // An admin's choices, each on its own, stand.
  const set = {
    websiteOrderCharge: { enabled: true, amountPaise: 0, effectiveFrom: new Date("2026-10-01"), chargeableSources: ["WEBSITE"] },
    ebillCharge: { enabled: false, amountPaise: 0, effectiveFrom: new Date("2026-12-01") },
  };
  const { got: admin, saves: adminSaves } = await load(set);
  assert.equal(adminSaves, 0, "nothing to backfill");
  assert.equal(admin.websiteOrderCharge.amountPaise, 0);
  assert.deepEqual([...admin.websiteOrderCharge.chargeableSources], ["WEBSITE"]);
  assert.equal(admin.ebillCharge.amountPaise, 0);

  const priced = await load({
    websiteOrderCharge: { enabled: false, amountPaise: 1200, chargeableSources: ["WEBSITE"] },
    ebillCharge: { enabled: false, amountPaise: 50 },
  });
  assert.equal(priced.saves, 0);
  assert.equal(priced.got.websiteOrderCharge.amountPaise, 1200);
  assert.deepEqual([...priced.got.websiteOrderCharge.chargeableSources], ["WEBSITE"]);
  assert.equal(priced.got.ebillCharge.amountPaise, 50);
});
