const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const T = require("../services/commercialTerms");

/**
 * The Restaurant Service Agreement v2.0, as arithmetic: the Installation
 * Charge (clause 5), its refund (5.6), the Commitment Discount (6) and the
 * Commercial Schedule fingerprint (Schedule 1).
 */

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const ist = (s) => new Date(`${s}+05:30`);

test("clause 5.2: exactly the three installation options, at the agreed amounts", () => {
  assert.deepEqual(
    T.INSTALLATION_OPTIONS.map((o) => [o.name, o.amountPaise]),
    [["No Printer", 200000], ["2-inch Thermal Printer", 250000], ["3-inch Thermal Printer", 350000]],
  );
  assert.equal(T.installationOption("PRINTER_2IN").amountPaise, 250000);
  assert.equal(T.installationOption("nope"), null);
});

test("clause 6.1: 3/6/12 months at 5/10/20 percent, on the subscription fee only, before tax", () => {
  assert.deepEqual(T.COMMITMENTS.map((c) => [c.months, c.discountPercent]), [[3, 5], [6, 10], [12, 20]]);
  assert.equal(T.commitmentOption(9), null);
  // Growth at 1299: 20% off is 259.80, net 1039.20; tax is computed on the net by the caller.
  assert.deepEqual(T.applyDiscount(129900, 20), { grossPaise: 129900, discountPaise: 25980, netPaise: 103920 });
  assert.deepEqual(T.applyDiscount(129900, 0), { grossPaise: 129900, discountPaise: 0, netPaise: 129900 });
  // The quote taxes the NET, and the discount is excluded from everything but the plan fee.
  const q = SRC("services", "subscription.js");
  assert.match(q, /amountPaise: discount\.netPaise,\s*gst: config\.gst/);
  const inst = q.slice(q.indexOf("const purchaseInstallation"), q.indexOf("const purchasePlan"));
  assert.ok(!/applyDiscount|discountPercent/.test(inst), "the Installation Charge is never discounted");
});

test("a commitment runs for exactly its periods, then stops", () => {
  const c = { months: 3, discountPercent: 5, periodsTotal: 3, periodsUsed: 2 };
  assert.deepEqual(
    { running: true, remaining: 1, pct: 5 },
    (({ running, periodsRemaining, periodsTotal }) => ({ running, remaining: periodsRemaining, pct: T.commitmentState(c).discountPercent }))(T.commitmentState(c)),
  );
  assert.equal(T.commitmentState({ ...c, periodsUsed: 3 }).running, false, "used up");
  assert.equal(T.commitmentState({ ...c, periodsUsed: 3 }).discountPercent, 0, "no discount after the commitment");
  assert.equal(T.commitmentState({ ...c, lapsedAt: new Date() }).running, false, "ended early");
  assert.equal(T.commitmentState(null).running, false);
});

test("clause 5.6: 25% before twelve completed months, 100% on the anniversary day or after", () => {
  const activated = ist("2027-03-10T00:00:00");
  const paid = 250000;
  assert.equal(T.installationRefund({ installationPaise: paid, activatedAt: activated, terminatedAt: ist("2028-03-09T00:00:00") }).refundPaise, 62500);
  const onDay = T.installationRefund({ installationPaise: paid, activatedAt: activated, terminatedAt: ist("2028-03-10T00:00:00") });
  assert.equal(onDay.percent, 100, "the anniversary itself counts as completed");
  assert.equal(onDay.refundPaise, 250000);
  assert.equal(T.installationRefund({ installationPaise: paid, activatedAt: activated, terminatedAt: ist("2028-09-01T00:00:00") }).percent, 100);
  // Clause 0.2: 31 May + 12 months is 31 May; 30 Jan + 1 month is 28/29 Feb.
  assert.equal(T.anniversary(new Date(Date.UTC(2027, 0, 30)), 1).getUTCDate(), 28);
  assert.equal(T.installationRefund({ installationPaise: 0, activatedAt: activated, terminatedAt: activated }).refundPaise, 0);
});

test("Schedule 1 fingerprints the same values the same way, whatever the key order", () => {
  const a = T.scheduleHash({ plan: { code: "GROWTH", listPricePaise: 129900 }, totalPaise: 103920 });
  const b = T.scheduleHash({ totalPaise: 103920, plan: { listPricePaise: 129900, code: "GROWTH" } });
  assert.equal(a, b);
  assert.notEqual(a, T.scheduleHash({ plan: { code: "GROWTH", listPricePaise: 129900 }, totalPaise: 103921 }));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("SOURCE: nothing is bought without the Installation Charge, and new terms need acceptance", () => {
  const q = SRC("services", "subscription.js");
  assert.match(q, /if \(q\.installationRequired\) \{\s*throw new SubscriptionError\("Choose and pay the Installation Charge before starting a subscription\."/);
  assert.match(q, /if \(q\.acceptanceRequired\) requireAcceptance\(acceptance\);/);
  // A plain renewal on the same terms is not a new Schedule 1.
  assert.match(q, /acceptanceRequired: installationRequired \|\| !subscription\.planCode \|\| subscription\.planCode !== planCode \|\| Boolean\(commitment\?\.isNew\)/);
  // The Activation Date is set once and never moves.
  assert.equal((q.match(/if \(!subscription\.activatedAt\) subscription\.activatedAt = q\.period\.start;/g) || []).length, 2);
  // Schedule 3: who accepted, from where.
  const route = SRC("routes", "subscriptionRoute.js");
  assert.match(route, /ip: req\.ip \|\| ""/);
  assert.match(route, /userAgent: String\(req\.headers\["user-agent"\] \|\| ""\)\.slice\(0, 300\)/);
  assert.match(route, /router\.post\("\/installation", isVerifiedUser, requireProtectedAction,/);
});

test("SOURCE: the commitment discount is on the invoice, and a lapse leaves its repayment due", () => {
  const q = SRC("services", "subscription.js");
  assert.match(q, /commitment discount \$\{q\.commitment\.discountPercent\}% \(\$\{formatINR\(q\.discountPaise\)\}\) applied/);
  assert.match(q, /s\.commitment\.repaymentDuePaise = Number\(s\.commitment\.discountGrantedPaise\) \|\| 0;/);
  // A lapse is the lock sweep's first step, and the repayment locks like any other due.
  assert.match(SRC("services", "accountLock.js"), /lapseCommitments\(on\)/);
  assert.match(SRC("services", "accountLock.js"), /Commitment discount of \$\{formatINR\(repayment\)\} is due/);
  // Collected on the next top-up, like order-charge dues.
  assert.match(SRC("services", "recharge.js"), /settleCommitmentRepayment\(intent\.restaurantId\)/);
});
