const express = require("express");
const createHttpError = require("http-errors");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { getBalance, history } = require("../services/ledger");
const { createRecharge, finalizeRecharge, RechargeError } = require("../services/recharge");
const { outstandingDues } = require("../services/orderCharge");
const { evaluateLock } = require("../services/accountLock");
const { formatINR, toRupees } = require("../services/money");
const config = require("../config/config");

const router = express.Router();

/**
 * The restaurant's own KnotKitchen Business Balance.
 *
 * Every route here is scoped to the CALLER'S restaurant, taken from the
 * session. No route accepts a restaurantId, from the body or the path -- the
 * legacy billing prototype did, and it let any signed-in user read any
 * restaurant's finances.
 *
 * Nothing here can change a price or a charge. Those live in the admin panel;
 * a restaurant can only see what it was billed and add money.
 */

/**
 * Where Cashfree sends the operator after a full-page checkout (the Android
 * app pays that way). Only back to one of our own https front ends, never to
 * whatever a request names.
 */
const ownReturnUrl = (raw) => {
  try {
    const url = new URL(String(raw || ""));
    return url.protocol === "https:" && config.frontendUrls.includes(url.origin) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const ownRestaurantId = (req) => {
  const id = req.user?.restaurantId;
  if (!id) throw createHttpError(403, "No restaurant is associated with this account.");
  return id;
};

/** Paise are the internal unit; the UI gets both so it never has to divide. */
const asAmount = (paise) => ({
  paise,
  rupees: toRupees(paise),
  label: formatINR(paise),
});

// GET /api/business-balance — balance, dues, and whether the account is locked.
router.get("/", isVerifiedUser, async (req, res, next) => {
  try {
    const restaurantId = ownRestaurantId(req);
    await getBalance(restaurantId); // a new store's row: created and assessed
    // Evaluated, not just assessed: every till polls this each minute, so the
    // stored lock follows the facts (a deadline passing, a plan starting or
    // lapsing, a new reason) without waiting for the 15-minute sweep.
    const [assessment, dues] = await Promise.all([evaluateLock(restaurantId), outstandingDues(restaurantId)]);
    const { balance } = assessment;

    res.status(200).json({
      success: true,
      data: {
        balance: asAmount(balance.balancePaise),
        locked: Boolean(balance.lockedAt),
        lockedAt: balance.lockedAt,
        lockedReason: balance.lockedReason,
        // Not locked yet, but will be at `locksAt` unless the restaurant pays.
        locksAt: balance.lockedAt ? null : assessment.locksAt,
        lockWarning: balance.lockedAt ? "" : assessment.lockWarning,
        dues: { count: dues.count, ...asAmount(dues.totalPaise), oldestAt: dues.oldestAt },
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/business-balance/transactions — the statement.
router.get("/transactions", isVerifiedUser, async (req, res, next) => {
  try {
    const restaurantId = ownRestaurantId(req);
    const rows = await history(restaurantId, {
      limit: req.query.limit,
      before: req.query.before,
    });

    res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        id: r._id,
        at: r.createdAt,
        description: r.description,
        kind: r.kind,
        direction: r.direction,
        credit: r.direction === "CREDIT" ? asAmount(r.amountPaise) : null,
        debit: r.direction === "DEBIT" ? asAmount(r.amountPaise) : null,
        balance: asAmount(r.balanceAfterPaise),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/business-balance/recharge — open a top-up. Credits nothing.
router.post("/recharge", isVerifiedUser, async (req, res, next) => {
  try {
    const restaurantId = ownRestaurantId(req);

    // Rupees from the client, paise internally. Read as a number rather than
    // trusted as one: "1e9" and "  500  " both arrive as strings.
    const rupees = Number(req.body?.amount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      throw createHttpError(400, "Enter an amount greater than zero.");
    }

    const result = await createRecharge({
      restaurantId,
      amountPaise: Math.round(rupees * 100),
      createdBy: req.user?._id,
      returnUrl: ownReturnUrl(req.body?.returnUrl),
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err instanceof RechargeError) {
      // expose + code so the operator is told WHY, not just that it failed.
      return next(createHttpError(err.status, err.message, { expose: true, code: err.code }));
    }
    next(err);
  }
});

/**
 * POST /api/business-balance/recharge/verify — the browser coming back.
 *
 * Deliberately does NOT trust the caller's claim that it succeeded: it re-asks
 * Cashfree. The webhook does the same thing, and whichever arrives second is a
 * no-op because both credit through one idempotency key.
 */
router.post("/recharge/verify", isVerifiedUser, async (req, res, next) => {
  try {
    const restaurantId = ownRestaurantId(req);
    const gatewayOrderId = String(req.body?.gatewayOrderId || "");
    if (!gatewayOrderId) throw createHttpError(400, "gatewayOrderId is required.");

    const result = await finalizeRecharge({ gatewayOrderId });

    // Someone else's top-up is not this caller's to inspect.
    if (result.intent && String(result.intent.restaurantId) !== String(restaurantId)) {
      throw createHttpError(404, "No such top-up.");
    }

    const balance = await getBalance(restaurantId);
    res.status(200).json({
      success: true,
      data: {
        credited: Boolean(result.credited),
        already: Boolean(result.already),
        reason: result.reason || "",
        balance: asAmount(balance.balancePaise),
      },
    });
  } catch (err) {
    if (err instanceof RechargeError) {
      // expose + code so the operator is told WHY, not just that it failed.
      return next(createHttpError(err.status, err.message, { expose: true, code: err.code }));
    }
    next(err);
  }
});

module.exports = router;
