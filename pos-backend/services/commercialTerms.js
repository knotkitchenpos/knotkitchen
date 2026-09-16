/**
 * The commercial rules of the Restaurant Service Agreement (v2.0), as numbers.
 *
 * Clause 5 (Installation Charge), clause 5.6 (its refund), clause 6
 * (Commitment Discount) and Schedule 1 (the Commercial Schedule) are all
 * arithmetic, and arithmetic belongs in one file with a test, not spread
 * across a quote, an invoice and a CSD screen that each round differently.
 *
 * Everything here is pure: no models, no clock of its own.
 */

const crypto = require("node:crypto");
const { percentOf } = require("./money");

/** Clause 5.2. Amounts exclusive of Taxes. */
const INSTALLATION_OPTIONS = Object.freeze([
  { code: "NO_PRINTER", name: "No Printer", amountPaise: 200000, equipment: "" },
  { code: "PRINTER_2IN", name: "2-inch Thermal Printer", amountPaise: 250000, equipment: "2-inch thermal receipt printer" },
  { code: "PRINTER_3IN", name: "3-inch Thermal Printer", amountPaise: 350000, equipment: "3-inch thermal receipt printer" },
]);

const installationOption = (code) => INSTALLATION_OPTIONS.find((o) => o.code === String(code || "")) || null;

/** Clause 6.1. The discount covers exactly `months` Billing Periods. */
const COMMITMENTS = Object.freeze([
  { months: 3, discountPercent: 5 },
  { months: 6, discountPercent: 10 },
  { months: 12, discountPercent: 20 },
]);

const commitmentOption = (months) => COMMITMENTS.find((c) => c.months === Number(months)) || null;

/**
 * Clause 6.3: the discount comes off the Subscription Fee before Taxes. It is
 * a time-of-supply discount recorded on the invoice, so tax is on the net.
 */
const applyDiscount = (amountPaise, discountPercent) => {
  const gross = Math.round(Number(amountPaise) || 0);
  const discountPaise = discountPercent > 0 ? percentOf(gross, discountPercent) : 0;
  return { grossPaise: gross, discountPaise, netPaise: gross - discountPaise };
};

/**
 * Where a subscription's commitment stands. `periodsUsed` counts the Billing
 * Periods already bought at the discount; the commitment is running while
 * fewer than `periodsTotal` have been bought and it has not lapsed.
 */
const commitmentState = (commitment) => {
  const c = commitment || {};
  const total = Number(c.periodsTotal) || 0;
  const used = Number(c.periodsUsed) || 0;
  const running = total > 0 && used < total && !c.lapsedAt && !c.completedAt;
  return {
    months: Number(c.months) || 0,
    discountPercent: running ? Number(c.discountPercent) || 0 : 0,
    periodsTotal: total,
    periodsUsed: used,
    periodsRemaining: running ? total - used : 0,
    running,
    completed: total > 0 && used >= total,
    lapsed: Boolean(c.lapsedAt),
    repaymentDuePaise: Number(c.repaymentDuePaise) || 0,
  };
};

/**
 * Clause 5.6(a)-(b). "Completing 12 months" is the start of the day that is
 * the 12th monthly anniversary of the Activation Date; a termination on that
 * day counts as completed. Both dates are compared as IST calendar days by
 * the caller passing IST-midnight dates (services/subscriptionPeriod).
 */
const anniversary = (from, months) => {
  const d = new Date(from);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  // Clause 0.2: a day that does not exist in the later month becomes its last day.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
};

const installationRefund = ({ installationPaise, activatedAt, terminatedAt }) => {
  const paid = Math.round(Number(installationPaise) || 0);
  if (!paid || !activatedAt) {
    return { percent: 0, refundPaise: 0, completed12Months: false, anniversaryAt: null };
  }
  const anniversaryAt = anniversary(activatedAt, 12);
  const completed = new Date(terminatedAt) >= anniversaryAt;
  const percent = completed ? 100 : 25;
  return { percent, refundPaise: percentOf(paid, percent), completed12Months: completed, anniversaryAt };
};

/**
 * Schedule 1 is a snapshot; this is its fingerprint. Keys are sorted so the
 * same values always hash the same, whatever order they were assembled in.
 */
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        if (value[k] !== undefined) acc[k] = canonical(value[k]);
        return acc;
      }, {});
  }
  return value instanceof Date ? value.toISOString() : value;
};

const scheduleHash = (values) =>
  crypto.createHash("sha256").update(JSON.stringify(canonical(values))).digest("hex");

module.exports = {
  INSTALLATION_OPTIONS,
  installationOption,
  COMMITMENTS,
  commitmentOption,
  applyDiscount,
  commitmentState,
  anniversary,
  installationRefund,
  scheduleHash,
};
