const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = require("../services/subscriptionPeriod");
const { format } = require("../services/invoiceNumber");
const { PlatformInvoice } = require("../models/platformSubscriptionModel");
const money = require("../services/money");

/**
 * Subscription periods, upgrade proration, and invoices that never change.
 *
 * The period arithmetic is where a spec sentence turns into money: "Do not use
 * the exact payment time to extend the subscription" and "the restaurant
 * should not receive the missed days for free" are both testable, and both
 * fail silently if got wrong -- a subscription that drifts a few minutes
 * earlier each month, or one that quietly gifts nine days.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const ist = (s) => new Date(`${s}+05:30`);

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

test("REGRESSION: the time of day a restaurant pays cannot move the boundary", () => {
  // Otherwise a period bought at 23:58 ends at 23:58 and every renewal drifts
  // earlier, and someone paying at 09:00 gets a shorter month than someone
  // paying at midnight.
  const ends = ["00:02", "09:00", "14:30", "23:58"].map(
    (t) => P.nextPeriod({ subscription: null, days: 30, on: ist(`2026-09-10T${t}:00`) }).end.getTime(),
  );
  assert.equal(new Set(ends).size, 1, "all four must buy the identical period");
});

test("every boundary is IST midnight, not UTC midnight", () => {
  // UTC midnight would expire subscriptions at 05:30 in the morning, and cut
  // an evening renewal a day short.
  const start = P.startOfIstDay(ist("2026-09-10T23:58:00"));
  assert.equal(start.toISOString(), "2026-09-09T18:30:00.000Z", "= 10 Sept 00:00 IST");
});

test("REGRESSION: paying late buys no free days", () => {
  // The spec's own example: expires 1 September, pays on the 10th.
  const subscription = { currentPeriodEnd: P.startOfIstDay(ist("2026-09-01T00:00:00")) };
  const on = ist("2026-09-10T14:30:00");

  const fromPayment = P.nextPeriod({ subscription, days: 30, policy: "FROM_PAYMENT", on });
  assert.equal(fromPayment.lapsedDays, 9);
  assert.equal(
    fromPayment.start.getTime(),
    P.startOfIstDay(on).getTime(),
    "the new period starts today; 1-10 September is simply not covered",
  );

  const fromExpiry = P.nextPeriod({ subscription, days: 30, policy: "FROM_EXPIRY", on });
  assert.equal(
    fromExpiry.start.getTime(),
    subscription.currentPeriodEnd.getTime(),
    "or it starts at the old expiry, so the nine days come out of the new month",
  );
  assert.ok(fromExpiry.end < fromPayment.end, "either way, the gap is never a gift");
});

test("renewing early never throws away days already paid for", () => {
  const subscription = { currentPeriodEnd: P.startOfIstDay(ist("2026-10-01T00:00:00")) };
  for (const policy of ["FROM_PAYMENT", "FROM_EXPIRY"]) {
    const r = P.nextPeriod({
      subscription,
      days: 30,
      policy,
      on: ist("2026-09-20T10:00:00"),
    });
    assert.equal(
      r.start.getTime(),
      subscription.currentPeriodEnd.getTime(),
      `${policy}: charging someone and shortening their subscription is indefensible`,
    );
    assert.equal(r.lapsedDays, 0);
  }
});

test("a first-ever subscription starts today", () => {
  const on = ist("2026-09-10T14:00:00");
  const r = P.nextPeriod({ subscription: null, days: 30, on });
  assert.equal(r.start.getTime(), P.startOfIstDay(on).getTime());
  assert.equal(P.daysBetween(r.start, r.end), 30);
});

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

test("an upgrade is charged on the difference for the days remaining", () => {
  // 1299 -> 1699 with 15 of 30 days left = 400 * 15/30 = 200.
  const subscription = { currentPeriodEnd: P.startOfIstDay(ist("2026-10-01T00:00:00")) };
  const r = P.upgradeCharge({
    currentPricePaise: money.toPaise(1299),
    newPricePaise: money.toPaise(1699),
    subscription,
    days: 30,
    on: ist("2026-09-16T10:00:00"),
  });
  assert.equal(r.remainingDays, 15);
  assert.equal(r.amountPaise, money.toPaise(200));
});

test("REGRESSION: a downgrade never produces a negative charge", () => {
  // The ledger would refuse it, and it would amount to a refund nobody
  // authorised.
  const subscription = { currentPeriodEnd: P.startOfIstDay(ist("2026-10-01T00:00:00")) };
  const r = P.upgradeCharge({
    currentPricePaise: money.toPaise(1699),
    newPricePaise: money.toPaise(1299),
    subscription,
    days: 30,
    on: ist("2026-09-16T10:00:00"),
  });
  assert.equal(r.amountPaise, 0);
});

test("the other two upgrade policies do what they say", () => {
  const subscription = { currentPeriodEnd: P.startOfIstDay(ist("2026-10-01T00:00:00")) };
  const args = {
    currentPricePaise: money.toPaise(1299),
    newPricePaise: money.toPaise(1699),
    subscription,
    days: 30,
    on: ist("2026-09-16T10:00:00"),
  };
  assert.equal(
    P.upgradeCharge({ ...args, policy: "FULL_DIFFERENCE" }).amountPaise,
    money.toPaise(400),
  );
  assert.equal(P.upgradeCharge({ ...args, policy: "FULL_PRICE" }).amountPaise, money.toPaise(1699));
});

test("an upgrade on the last day of a period costs nothing extra", () => {
  const subscription = { currentPeriodEnd: P.startOfIstDay(ist("2026-09-17T00:00:00")) };
  const r = P.upgradeCharge({
    currentPricePaise: money.toPaise(1299),
    newPricePaise: money.toPaise(1699),
    subscription,
    days: 30,
    on: ist("2026-09-17T10:00:00"),
  });
  assert.equal(r.remainingDays, 0);
  assert.equal(r.amountPaise, 0, "there is no remaining period to charge for");
});

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

test("invoice numbers follow KK-<storeId>-0001", () => {
  assert.equal(format("148379", 1), "KK-148379-0001");
  assert.equal(format("148379", 42), "KK-148379-0042");
  assert.equal(format("148379", 12345), "KK-148379-12345", "past 9999 it grows rather than wraps");
});

test("REGRESSION: an issued invoice cannot be edited", () => {
  // "if a restaurant purchased Growth for 1299 and Admin later changes Growth
  // to 999, the old invoice must still show 1299."
  const { rejectedEdits } = require("../models/platformSubscriptionModel");

  for (const field of ["totalPaise", "lines", "buyer.gstin", "invoiceNumber", "cgstPaise", "invoiceDate"]) {
    assert.deepEqual(rejectedEdits([field]), [field], `${field} must not be editable after issue`);
  }

  // And the hook that uses it actually refuses the save.
  const src = SRC("models/platformSubscriptionModel.js");
  assert.match(src, /invoiceSchema\.pre\("save", function guardImmutability/);
  assert.match(src, /return next\(\s*new Error\(/);
});

test("voiding and annotating remain possible", () => {
  // A mistake is cancelled by a void plus a fresh invoice, never by rewriting
  // the original -- which may already be in a filed return.
  const src = SRC("models/platformSubscriptionModel.js");
  assert.match(src, /\["status", "notes", "updatedAt"\]/);
  assert.match(src, /Void it and issue a new one/);
});

test("an invoice snapshots both parties and every rate", () => {
  // A restaurant that renames itself must not rewrite the name on last year's
  // bills, and a GST change must not restate old tax.
  const schema = PlatformInvoice.schema;
  for (const field of [
    "seller.name", "seller.gstin", "buyer.name", "buyer.gstin", "buyer.state",
    "lines", "cgstPaise", "sgstPaise", "igstPaise", "totalInWords", "placeOfSupply",
  ]) {
    assert.ok(schema.path(field), `${field} must be stored on the invoice, not derived later`);
  }
});

test("SOURCE: the balance is debited before the invoice is issued", () => {
  // The other order would produce an invoice marked PAID for a payment that
  // failed for want of funds.
  const src = SRC("services/subscription.js");
  const debitAt = src.indexOf("kind: \"SUBSCRIPTION\"");
  const invoiceAt = src.indexOf("const invoice = await issueInvoice");
  assert.ok(debitAt !== -1 && invoiceAt !== -1, "anchors moved; retarget this guard");
  assert.ok(debitAt < invoiceAt, "money first, document second");
});

test("SOURCE: an unaffordable subscription is refused, not part-applied", () => {
  const src = SRC("services/subscription.js");
  assert.match(src, /InsufficientBalanceError/);
  assert.match(src, /402/, "payment required, with the shortfall named");
});
