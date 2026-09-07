/**
 * Locking an account that has not paid, and unlocking it the moment it does.
 *
 * Two things put a restaurant past due, and both get the same configured grace
 * period (24 hours by default):
 *
 *   unpaid per-order fees   a website order was charged while the balance was
 *                           empty, so the fee sits PENDING
 *   an expired subscription the period ended and was not renewed
 *
 * What "locked" means is deliberately narrow. The spec is explicit that a
 * locked restaurant can still sign in, open Billing, see what it owes and pay
 * -- a lock that stopped someone paying would be self-defeating. So this gates
 * the POS, not the door.
 *
 * By default it does NOT gate the storefront or QR ordering either. Blocking
 * those punishes the restaurant's DINERS -- someone mid-meal could not settle
 * their table bill -- for a dispute between KnotKitchen and the restaurant.
 * `lockScope` can widen it to the storefront if the business wants that
 * leverage, but it is not the default and should be a deliberate choice.
 *
 * Lock state is evaluated on the events that can change it, not on every
 * request. A POS makes hundreds of calls a minute and none of them should pay
 * for two extra queries to re-derive something that changes twice a month.
 */

const { BusinessBalance } = require("../models/businessBalanceModel");
const { PlatformSubscription } = require("../models/platformSubscriptionModel");
const { getPlatformConfig } = require("./pricing");
const { formatINR } = require("./money");

const HOUR_MS = 60 * 60 * 1000;

/**
 * Should this restaurant be locked right now, and why?
 *
 * Pure decision, no writes -- so the admin panel can ask "would this lock?"
 * without causing it to happen.
 */
const assessAccount = async (restaurantId, on = new Date()) => {
  const config = await getPlatformConfig();
  const graceMs = Math.max(0, Number(config.graceHours || 0)) * HOUR_MS;
  const now = new Date(on).getTime();

  // Required here, not at the top: orderCharge requires this module back (a
  // charge that cannot be collected starts the grace clock), and a top-level
  // require would resolve to undefined on whichever side loaded second.
  const { outstandingDues } = require("./orderCharge");

  const [dues, subscription] = await Promise.all([
    outstandingDues(restaurantId),
    PlatformSubscription.findOne({ restaurantId }).lean(),
  ]);

  const reasons = [];

  if (dues.count > 0 && dues.oldestAt) {
    const dueSince = new Date(dues.oldestAt).getTime();
    if (now - dueSince > graceMs) {
      reasons.push(
        `${dues.count} unpaid order charge(s) totalling ${formatINR(dues.totalPaise)}.`,
      );
    }
  }

  // A subscription that was never bought is not overdue -- a restaurant that
  // has not subscribed yet has nothing to be late with.
  if (subscription?.currentPeriodEnd) {
    const endedAt = new Date(subscription.currentPeriodEnd).getTime();
    if (now > endedAt + graceMs) {
      reasons.push("The subscription expired and the grace period has passed.");
    }
  }

  return {
    shouldLock: reasons.length > 0,
    reasons,
    duesPaise: dues.totalPaise,
    duesCount: dues.count,
    graceHours: config.graceHours,
    lockScope: config.lockScope || "STAFF",
  };
};

/**
 * Bring the stored lock state in line with the assessment.
 *
 * Called after anything that can change it -- a charge going unpaid, a
 * top-up, a subscription purchase -- and by the sweep. Idempotent: locking an
 * already-locked account, or clearing an already-clear one, does nothing.
 */
const evaluateLock = async (restaurantId, on = new Date()) => {
  const assessment = await assessAccount(restaurantId, on);
  const balance = await BusinessBalance.findOne({ restaurantId });
  if (!balance) return { ...assessment, changed: false, locked: false };

  const wasLocked = Boolean(balance.lockedAt);

  if (assessment.shouldLock && !wasLocked) {
    balance.lockedAt = new Date(on);
    balance.lockedReason = assessment.reasons.join(" ");
    await balance.save();
    return { ...assessment, changed: true, locked: true };
  }

  if (!assessment.shouldLock && wasLocked) {
    // "After successful payment, the account should automatically unlock."
    balance.lockedAt = null;
    balance.lockedReason = "";
    await balance.save();
    return { ...assessment, changed: true, locked: false };
  }

  return { ...assessment, changed: false, locked: wasLocked };
};

/** Never allowed to break the thing that called it. */
const fireEvaluateLock = (restaurantId) => {
  evaluateLock(restaurantId).catch((err) => {
    console.warn("[AccountLock] evaluation failed:", err && err.message);
  });
};

/**
 * Sweep every restaurant that could have crossed the line since it was last
 * looked at.
 *
 * Only candidates are read: an account already locked, one holding unpaid
 * charges, or one whose subscription has ended. A platform-wide scan of every
 * restaurant on every tick would grow into the largest query in the system for
 * a state that changes about twice a month.
 */
const sweepLocks = async (on = new Date()) => {
  const Order = require("../models/orderModel");

  const [withDues, expired, alreadyLocked] = await Promise.all([
    Order.distinct("restaurantId", { "platformCharge.status": "PENDING" }),
    PlatformSubscription.distinct("restaurantId", {
      currentPeriodEnd: { $ne: null, $lt: new Date(on) },
    }),
    BusinessBalance.distinct("restaurantId", { lockedAt: { $ne: null } }),
  ]);

  const candidates = [...new Set([...withDues, ...expired, ...alreadyLocked].map(String))];

  let locked = 0;
  let unlocked = 0;
  for (const restaurantId of candidates) {
    try {
      const result = await evaluateLock(restaurantId, on);
      if (result.changed && result.locked) locked += 1;
      if (result.changed && !result.locked) unlocked += 1;
    } catch (err) {
      console.warn(`[AccountLock] ${restaurantId}:`, err.message);
    }
  }
  return { considered: candidates.length, locked, unlocked };
};

let sweepHandle = null;

const startLockSweeper = ({ intervalMs = 15 * 60 * 1000 } = {}) => {
  if (sweepHandle) return sweepHandle;
  sweepHandle = setInterval(() => {
    sweepLocks().catch((err) => console.warn("[AccountLock] sweep failed:", err.message));
  }, intervalMs);
  if (sweepHandle.unref) sweepHandle.unref();
  return sweepHandle;
};

const stopLockSweeper = () => {
  if (sweepHandle) clearInterval(sweepHandle);
  sweepHandle = null;
};

module.exports = {
  assessAccount,
  evaluateLock,
  fireEvaluateLock,
  sweepLocks,
  startLockSweeper,
  stopLockSweeper,
};
