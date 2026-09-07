/**
 * When a subscription period starts and ends.
 *
 * The spec is specific about this: "Use a consistent date-based calculation.
 * Do not use the exact payment time to extend the subscription." Paying at
 * 23:58 must not buy 30 days that end at 23:58, because the next renewal then
 * drifts a little earlier every month and a restaurant that renews at 09:00
 * gets a shorter period than one that renews at midnight.
 *
 * So every boundary is midnight, and midnight means IST -- the restaurants are
 * Indian. Using UTC midnight would expire subscriptions at 05:30 in the
 * morning, which is both surprising and, for anyone renewing late in the
 * evening, a day short.
 *
 * A period runs [start, end): active while now < end. That makes "30 days"
 * exactly 30 midnights and avoids the off-by-one of an inclusive end date.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant of IST midnight beginning the day that `at` falls on. */
const startOfIstDay = (at = new Date()) => {
  const shifted = new Date(new Date(at).getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
};

const addDays = (at, days) => new Date(new Date(at).getTime() + Math.round(days) * DAY_MS);

/** Whole days from `from` to `to`, never negative. Both are snapped to IST midnight. */
const daysBetween = (from, to) => {
  const a = startOfIstDay(from).getTime();
  const b = startOfIstDay(to).getTime();
  return Math.max(0, Math.round((b - a) / DAY_MS));
};

const isActiveAt = (subscription, at = new Date()) =>
  Boolean(
    subscription &&
      subscription.currentPeriodEnd &&
      new Date(at) < new Date(subscription.currentPeriodEnd),
  );

/**
 * The period a payment buys.
 *
 * Three cases, and the middle one is the one the spec calls out:
 *
 *   renewed early / on time   the new period continues from the old end, so
 *                             nothing already paid for is thrown away
 *
 *   renewed LATE              the gap is not covered. Under FROM_PAYMENT the
 *                             new period starts today, so 1-10 September is
 *                             simply not subscribed -- the restaurant does not
 *                             get those days free, and does not get them
 *                             tacked on either. Under FROM_EXPIRY the period
 *                             still starts at the old expiry, so paying nine
 *                             days late costs nine days of the new month.
 *
 *   first ever                starts today
 */
const nextPeriod = ({ subscription, days, policy = "FROM_PAYMENT", on = new Date() }) => {
  const today = startOfIstDay(on);
  const length = Math.max(1, Math.round(Number(days) || 30));
  const previousEnd = subscription?.currentPeriodEnd
    ? startOfIstDay(subscription.currentPeriodEnd)
    : null;

  // Still inside the paid period: always continue from where it ends, under
  // either policy. Charging someone and shortening their subscription would
  // be indefensible.
  if (previousEnd && previousEnd > today) {
    return { start: previousEnd, end: addDays(previousEnd, length), lapsedDays: 0 };
  }

  const lapsedDays = previousEnd ? daysBetween(previousEnd, today) : 0;

  if (policy === "FROM_EXPIRY" && previousEnd) {
    return { start: previousEnd, end: addDays(previousEnd, length), lapsedDays };
  }

  return { start: today, end: addDays(today, length), lapsedDays };
};

/**
 * What an upgrade costs mid-period.
 *
 * PRORATE charges the difference for the days that remain, which is what
 * "calculated based on the remaining subscription period" asks for. The floor
 * at zero matters: moving to a plan that happens to be cheaper for this
 * restaurant must not produce a negative charge, which the ledger would
 * refuse anyway and which would be a refund nobody authorised.
 */
const upgradeCharge = ({
  currentPricePaise,
  newPricePaise,
  subscription,
  days,
  policy = "PRORATE",
  on = new Date(),
}) => {
  const difference = Math.max(0, Math.round(newPricePaise) - Math.round(currentPricePaise));
  const length = Math.max(1, Math.round(Number(days) || 30));

  if (policy === "FULL_PRICE") {
    return { amountPaise: Math.round(newPricePaise), remainingDays: null, basis: "FULL_PRICE" };
  }
  if (policy === "FULL_DIFFERENCE") {
    return { amountPaise: difference, remainingDays: null, basis: "FULL_DIFFERENCE" };
  }

  const remainingDays = subscription?.currentPeriodEnd
    ? daysBetween(on, subscription.currentPeriodEnd)
    : 0;

  return {
    amountPaise: Math.round((difference * Math.min(remainingDays, length)) / length),
    remainingDays,
    basis: "PRORATE",
  };
};

module.exports = {
  IST_OFFSET_MS,
  DAY_MS,
  startOfIstDay,
  addDays,
  daysBetween,
  isActiveAt,
  nextPeriod,
  upgradeCharge,
};
