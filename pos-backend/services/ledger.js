/**
 * The only way money moves.
 *
 * Nothing else in the codebase may write `balancePaise`. Two rules hold here
 * and are enforced by the database rather than by everyone remembering:
 *
 *   never negative   a debit is a conditional update that simply does not
 *                    match when the balance is short, so two concurrent
 *                    debits cannot both pass a "do we have enough" check and
 *                    then both subtract
 *
 *   never silent     the balance change and its ledger row are written in one
 *                    transaction, so a movement with no record is not a state
 *                    the database can end up in
 *
 * Idempotency is a unique index, not a lookup-then-write: a gateway callback
 * delivered three times races with itself, and only the index settles it.
 */

const mongoose = require("mongoose");
const { BusinessBalance, LedgerEntry } = require("../models/businessBalanceModel");

class InsufficientBalanceError extends Error {
  constructor(required, available) {
    super("Insufficient KnotKitchen Business Balance.");
    this.name = "InsufficientBalanceError";
    this.code = "INSUFFICIENT_BALANCE";
    this.requiredPaise = required;
    this.availablePaise = available;
  }
}

const DUPLICATE_KEY = 11000;

/** Read-only. Creates the row on first look so a new restaurant reads 0, not null. */
const getBalance = async (restaurantId) => {
  const existing = await BusinessBalance.findOne({ restaurantId });
  if (existing) return existing;
  return BusinessBalance.create({ restaurantId, balancePaise: 0 });
};

const assertAmount = (amountPaise) => {
  const amount = Math.round(Number(amountPaise) || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Ledger amounts must be a positive whole number of paise.");
  }
  return amount;
};

/**
 * Has this key already been applied?
 *
 * Returned instead of throwing, because a repeated gateway callback is normal
 * traffic and not an error: the caller should answer 200 and carry on.
 */
const findByIdempotencyKey = (idempotencyKey) =>
  idempotencyKey ? LedgerEntry.findOne({ idempotencyKey }) : null;

const applyMovement = async ({
  restaurantId,
  direction,
  kind,
  amountPaise,
  description = "",
  idempotencyKey = null,
  refType = "",
  refId = null,
  meta = {},
  createdBy = null,
}) => {
  const amount = assertAmount(amountPaise);
  const signed = direction === "CREDIT" ? amount : -amount;

  if (idempotencyKey) {
    const already = await findByIdempotencyKey(idempotencyKey);
    if (already) return { entry: already, duplicate: true };
  }

  await getBalance(restaurantId);

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      // The guard IS the query. A debit larger than the balance matches no
      // document, so it cannot be applied -- there is no window between
      // checking and subtracting for a second debit to slip through.
      const filter =
        direction === "DEBIT"
          ? { restaurantId, balancePaise: { $gte: amount } }
          : { restaurantId };

      const balance = await BusinessBalance.findOneAndUpdate(
        filter,
        { $inc: { balancePaise: signed } },
        { new: true, session },
      );

      if (!balance) {
        const current = await BusinessBalance.findOne({ restaurantId }).session(session);
        throw new InsufficientBalanceError(amount, current ? current.balancePaise : 0);
      }

      const [entry] = await LedgerEntry.create(
        [
          {
            restaurantId,
            direction,
            kind,
            amountPaise: amount,
            balanceAfterPaise: balance.balancePaise,
            description,
            idempotencyKey,
            refType,
            refId,
            meta,
            createdBy,
          },
        ],
        { session },
      );

      result = { entry, balance, duplicate: false };
    });
    return result;
  } catch (err) {
    // Two callbacks arrived together and both got past the read above; the
    // index caught the second. Not an error -- report what the winner wrote.
    if (err && err.code === DUPLICATE_KEY && idempotencyKey) {
      const existing = await findByIdempotencyKey(idempotencyKey);
      if (existing) return { entry: existing, duplicate: true };
    }
    throw err;
  } finally {
    session.endSession();
  }
};

/** Money in. Recharges, refunds, admin credits. */
const credit = (args) => applyMovement({ ...args, direction: "CREDIT" });

/** Money out. Throws InsufficientBalanceError rather than going negative. */
const debit = (args) => applyMovement({ ...args, direction: "DEBIT" });

/** The statement, newest first. */
const history = async (restaurantId, { limit = 50, before = null } = {}) => {
  const query = { restaurantId };
  if (before) query.createdAt = { $lt: new Date(before) };
  return LedgerEntry.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(200, Math.max(1, Number(limit) || 50)))
    .lean();
};

module.exports = {
  getBalance,
  credit,
  debit,
  history,
  findByIdempotencyKey,
  InsufficientBalanceError,
};
