/**
 * Locking an account that has not paid, and unlocking it the moment it does.
 *
 * Three things put a restaurant past due, and all get the same configured
 * grace period (24 hours by default):
 *
 *   an empty Business Balance  it ran out and was not recharged
 *   unpaid per-order fees      a website order was charged while the balance
 *                              was empty, so the fee sits PENDING
 *   an expired subscription    the period ended and the wallet could not
 *                              renew it
 *
 * A store whose POS plan never started, or whose cancellation took effect, is
 * locked at once, with no grace. So is a store marked "closed" (CSD closed
 * it, or its cancellation took effect), whatever its wallet holds: the lock
 * reason is STORE_CLOSED, and only reopening it in CSD lifts it.
 *
 * What "locked" means (the agreement's terms):
 *   - the POS is locked except sign-in and Billing -- a locked restaurant can
 *     still see what it owes and pay, or paying could not undo the lock
 *     (middlewares/accountLock.js);
 *   - the store's website is down: the storefront resolver reports the store
 *     unavailable (services/storefrontResolver.js), so the site, its ordering
 *     and table booking all stop;
 *   - table QR takes no new orders. A party already seated can still pay its
 *     bill and call a waiter.
 * It lifts the moment the amount is paid.
 *
 * Lock state is evaluated on the events that can change it, not on every
 * request. A POS makes hundreds of calls a minute and none of them should pay
 * for two extra queries to re-derive something that changes twice a month.
 */

const { BusinessBalance, LedgerEntry } = require("../models/businessBalanceModel");
const { PlatformSubscription } = require("../models/platformSubscriptionModel");
const mongoose = require("mongoose");
const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");
const { getPlatformConfig, getOverride } = require("./pricing");
const { formatINR } = require("./money");

const HOUR_MS = 60 * 60 * 1000;

const STORE_CLOSED = "STORE_CLOSED";
const STORE_CLOSED_MESSAGE = "This store is closed. Contact KnotKitchen support to reopen.";

/**
 * Is this restaurant's Store marked "closed" (permanently, not a trading
 * pause)? The Store row carries restaurantId only sometimes, so the storeId
 * from the Restaurant is tried too.
 */
const isStoreClosed = async (restaurantId) => {
  if (!mongoose.isValidObjectId(restaurantId)) return false;
  const restaurant = await Restaurant.findById(restaurantId).select("storeId").lean();
  return Boolean(
    await Store.exists({
      $or: [{ restaurantId }, ...(restaurant?.storeId ? [{ storeId: restaurant.storeId }] : [])],
      status: "closed",
      isDeleted: { $ne: true },
    }),
  );
};

/**
 * When the balance hit zero, or null if it has money (or never had any).
 * The newest statement row carries the balance after it; if that is zero, the
 * balance has been empty since that row.
 */
const balanceEmptySince = async (restaurantId) => {
  const last = await LedgerEntry.findOne({ restaurantId })
    .sort({ createdAt: -1 })
    .select("createdAt balanceAfterPaise")
    .lean();
  return last && last.balanceAfterPaise <= 0 ? last.createdAt : null;
};

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

  const [dues, subscription, emptySince, override, closed] = await Promise.all([
    outstandingDues(restaurantId),
    PlatformSubscription.findOne({ restaurantId }).lean(),
    balanceEmptySince(restaurantId),
    getOverride(restaurantId),
    isStoreClosed(restaurantId),
  ]);

  // Closed (N1): locked at once, whatever the wallet or the demo flag says.
  // Nothing is owed, so there is no deadline or warning to show.
  if (closed) {
    return {
      shouldLock: true,
      code: STORE_CLOSED,
      reasons: [STORE_CLOSED_MESSAGE],
      locksAt: null,
      lockWarning: "",
      duesPaise: dues.totalPaise,
      duesCount: dues.count,
      graceHours: config.graceHours,
    };
  }

  // A demo store set in CSD is never locked, for any reason.
  if (override?.billingExempt) {
    return {
      shouldLock: false,
      reasons: [],
      locksAt: null,
      lockWarning: "",
      duesPaise: 0,
      duesCount: 0,
      graceHours: config.graceHours,
    };
  }

  const reasons = [];
  // When each pending problem turns into a lock, so the POS can warn first.
  const deadlines = [];

  // The balance ran out. Read from the statement rather than a stored flag, so
  // a restaurant that was already at zero when this rule arrived is covered
  // without a migration. A restaurant that has never had money has nothing
  // that "ran out" -- the subscription rule covers it.
  if (emptySince) {
    const since = new Date(emptySince).getTime();
    if (now - since > graceMs) {
      reasons.push("The Business Balance ran out and was not recharged within the grace period.");
    } else {
      deadlines.push({ at: since + graceMs, why: "Your Business Balance has run out." });
    }
  }

  if (dues.count > 0 && dues.oldestAt) {
    const dueSince = new Date(dues.oldestAt).getTime();
    if (now - dueSince > graceMs) {
      reasons.push(
        `${dues.count} unpaid platform fee(s) totalling ${formatINR(dues.totalPaise)}.`,
      );
    } else {
      deadlines.push({ at: dueSince + graceMs, why: `${dues.count} unpaid platform fee(s).` });
    }
  }

  // A store whose POS plan has never started is locked: everything but
  // Billing & Subscription stays shut until its first top-up of at least the
  // minimum starts the plan (services/subscription afterRecharge). No grace
  // period, there is nothing it was using that could be cut off mid-service.
  // Demo stores (billingExempt, above) never reach this.
  if (subscription?.status === "CANCELLED") {
    // Closed: nothing renews, so there is nothing to wait for.
    reasons.push("The POS subscription was cancelled and this store is closed. Contact KnotKitchen support to reopen it.");
  } else if (!subscription?.currentPeriodEnd) {
    reasons.push(
      `No plan is active yet. Recharge at least ${formatINR(Number(config.firstRechargeMinPaise) || 0)} to start. The POS plan starts automatically.`,
    );
  } else {
    const endedAt = new Date(subscription.currentPeriodEnd).getTime();
    if (now > endedAt + graceMs) {
      reasons.push("The subscription expired and the grace period has passed.");
    } else if (now >= endedAt) {
      deadlines.push({ at: endedAt + graceMs, why: "Your subscription has ended." });
    }
  }

  deadlines.sort((a, b) => a.at - b.at);

  return {
    shouldLock: reasons.length > 0,
    code: reasons.length > 0 ? "UNPAID" : "",
    reasons,
    // Not locked yet, but will be at this moment unless it is dealt with.
    locksAt: reasons.length === 0 && deadlines.length ? new Date(deadlines[0].at) : null,
    lockWarning: reasons.length === 0 ? deadlines.map((d) => d.why).join(" ") : "",
    duesPaise: dues.totalPaise,
    duesCount: dues.count,
    graceHours: config.graceHours,
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
  if (!balance) return { ...assessment, changed: false, locked: false, balance: null };

  const wasLocked = Boolean(balance.lockedAt);
  const reason = assessment.reasons.join(" ");

  if (assessment.shouldLock && !wasLocked) {
    balance.lockedAt = new Date(on);
    balance.lockedReason = reason;
    await balance.save();
    return { ...assessment, changed: true, locked: true, balance };
  }

  if (!assessment.shouldLock && wasLocked) {
    // "After successful payment, the account should automatically unlock."
    balance.lockedAt = null;
    balance.lockedReason = "";
    await balance.save();
    return { ...assessment, changed: true, locked: false, balance };
  }

  // Still locked, for a different reason now (balance topped up, plan still
  // missing): the Billing page and the 402 must say what is left to do.
  if (wasLocked && balance.lockedReason !== reason) {
    balance.lockedReason = reason;
    await balance.save();
  }

  return { ...assessment, changed: false, locked: wasLocked, balance };
};

/**
 * Is this restaurant locked (after its grace period, never activated, or
 * its store closed)?
 * Read by the customer-facing side: the storefront resolver takes a locked
 * store's website down, and table QR stops taking new orders, because nobody
 * on its POS can accept them.
 *
 * Fails open, like the staff gate: a database hiccup must not close a
 * restaurant that has paid.
 */
const CUSTOMER_PAUSED_MESSAGE = "This restaurant is not taking online orders right now. Please order with the staff.";

const isOrderingLocked = async (restaurantId) => {
  if (!restaurantId) return false;
  try {
    const balance = await BusinessBalance.findOne({ restaurantId }).select("lockedAt").lean();
    // A closed store is locked even before anything has stored the lock
    // (no balance row yet, or the evaluation after closing it failed).
    return Boolean(balance?.lockedAt) || (await isStoreClosed(restaurantId));
  } catch (err) {
    console.warn("[AccountLock] ordering lock check failed, allowing:", err && err.message);
    return false;
  }
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

  // Plans whose period has ended renew first (from the wallet), so the sweep
  // below only locks the ones that could not pay. Required here for the same
  // cycle reason as orderCharge above.
  try {
    await require("./subscription").renewDue(on);
  } catch (err) {
    console.warn("[AccountLock] renewal failed:", err.message);
  }

  const [withDues, expired, alreadyLocked, empty] = await Promise.all([
    Order.distinct("restaurantId", { "platformCharge.status": "PENDING" }),
    PlatformSubscription.distinct("restaurantId", {
      currentPeriodEnd: { $ne: null, $lt: new Date(on) },
    }),
    BusinessBalance.distinct("restaurantId", { lockedAt: { $ne: null } }),
    // ponytail: includes restaurants that never recharged (one cheap read each
    // per sweep); track the moment a debit empties the balance if this grows.
    BusinessBalance.distinct("restaurantId", { balancePaise: { $lte: 0 } }),
  ]);

  const candidates = [...new Set([...withDues, ...expired, ...alreadyLocked, ...empty].map(String))];

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
let renewHandle = null;

const startLockSweeper = ({ intervalMs = 15 * 60 * 1000, renewEveryMs = 60 * 1000 } = {}) => {
  if (sweepHandle) return sweepHandle;
  sweepHandle = setInterval(() => {
    sweepLocks().catch((err) => console.warn("[AccountLock] sweep failed:", err.message));
  }, intervalMs);
  if (sweepHandle.unref) sweepHandle.unref();
  // Renewals every minute: a store with the money in its wallet renews the
  // minute its period ends, not up to 15 minutes later behind a grace banner.
  // One indexed query when nothing is due.
  renewHandle = setInterval(() => {
    require("./subscription")
      .renewDue()
      .catch((err) => console.warn("[AccountLock] renewal tick failed:", err.message));
  }, renewEveryMs);
  if (renewHandle.unref) renewHandle.unref();
  return sweepHandle;
};

module.exports = {
  STORE_CLOSED,
  STORE_CLOSED_MESSAGE,
  isStoreClosed,
  CUSTOMER_PAUSED_MESSAGE,
  isOrderingLocked,
  balanceEmptySince,
  assessAccount,
  evaluateLock,
  fireEvaluateLock,
  sweepLocks,
  startLockSweeper,
};
