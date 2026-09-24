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

  // Backdating never sells a period that has already ended: a store expired
  // for a whole period or more starts today, so paying unlocks it.
  if (policy === "FROM_EXPIRY" && previousEnd && addDays(previousEnd, length) > today) {
    return { start: previousEnd, end: addDays(previousEnd, length), lapsedDays };
  }

  return { start: today, end: addDays(today, length), lapsedDays };
};

/**
 * The share of a monthly price still to run: an add-on or tablet bought
 * mid-period pays only for the time left until `periodEnd`, to the
 * millisecond, rounded up to a whole paise. Never more than a full period,
 * never below zero.
 */
const prorate = ({ pricePaise, periodEnd, days, on = new Date() }) => {
  const length = Math.max(1, Math.round(Number(days) || 30)) * DAY_MS;
  const left = Math.min(length, Math.max(0, new Date(periodEnd).getTime() - new Date(on).getTime()));
  return Math.ceil((Math.round(Number(pricePaise) || 0) * left) / length);
};

module.exports = {
  IST_OFFSET_MS,
  DAY_MS,
  startOfIstDay,
  addDays,
  daysBetween,
  isActiveAt,
  nextPeriod,
  prorate,
};
