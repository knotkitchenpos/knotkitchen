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
  payments: [{ status: "paid", amount: 500 }],
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
