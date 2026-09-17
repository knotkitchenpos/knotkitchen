/**
 * Find-or-create keyed on an idempotency key, with the unique index as the
 * arbiter of a race.
 *
 * Every "do this once" path in the app is the same three steps: look the key
 * up and return what is there; otherwise create; and if the unique index
 * rejects the create because a concurrent request won, re-read and return
 * the winner. The lookup alone is not enough (two requests both miss, one
 * gets an E11000 and used to 500); the index alone is not enough (the loser
 * needs the winner's document to answer with).
 *
 * `find` returns the existing document or null. `create` writes and returns
 * the new one; anything it throws that is not a duplicate-key error is
 * rethrown untouched.
 */
const DUPLICATE_KEY = 11000;

const isDuplicateKey = (err) => Boolean(err) && err.code === DUPLICATE_KEY;

const findOrCreate = async ({ find, create }) => {
  const existing = await find();
  if (existing) return { doc: existing, duplicate: true };
  try {
    return { doc: await create(), duplicate: false };
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const winner = await find();
    if (!winner) throw err;
    return { doc: winner, duplicate: true };
  }
};

module.exports = { findOrCreate, isDuplicateKey, DUPLICATE_KEY };
