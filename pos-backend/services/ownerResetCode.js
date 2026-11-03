const crypto = require("crypto");
const config = require("../config/config");
const Store = require("../models/storeModel");

/**
 * Owner password reset codes (security audit, 2026-11-03).
 *
 * Setting or resetting a store owner's password used to need only the store
 * ID and the owner's phone, both printed on bills and websites: anyone could
 * take a store over. Now it also needs a one-time code that KnotKitchen
 * support issues from CSD after checking who is asking, and reads to the owner.
 *
 *   6 digits, valid CODE_TTL_MS, single use;
 *   only an HMAC of it is stored, keyed per store;
 *   MAX_TRIES wrong codes void it, and support issues a new one.
 */

const CODE_TTL_MS = 30 * 60 * 1000;
const MAX_TRIES = 5;

const key = () => process.env.CREDENTIALS_SECRET || config.accessTokenSecret || process.env.JWT_SECRET || "";
const hashCode = (storeId, code) => {
  if (!key()) throw new Error("No key for owner reset codes: set CREDENTIALS_SECRET.");
  return crypto.createHmac("sha256", key()).update(`owner-reset:${storeId}:${code}`).digest("hex");
};

/** A new code for this store, replacing any earlier one. Returns the code itself, shown once. */
const issueResetCode = async (store, staffId = null) => {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  store.passwordReset = { codeHash: hashCode(store.storeId, code), expiresAt, attempts: 0, issuedBy: staffId || undefined };
  await store.save();
  return { code, expiresAt };
};

/**
 * Check a code typed at the POS: "ok" (and the code is used up), "wrong",
 * "expired" (none issued, run out, or used) or "locked" (too many wrong tries).
 */
const useResetCode = async (store, code) => {
  const r = store.passwordReset || {};
  if (!r.codeHash || !r.expiresAt || new Date(r.expiresAt).getTime() <= Date.now()) return "expired";
  if ((r.attempts || 0) >= MAX_TRIES) return "locked";
  const a = Buffer.from(hashCode(store.storeId, String(code || "")), "hex");
  const b = Buffer.from(String(r.codeHash), "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await Store.updateOne({ _id: store._id }, { $inc: { "passwordReset.attempts": 1 } });
    return (r.attempts || 0) + 1 >= MAX_TRIES ? "locked" : "wrong";
  }
  // Claimed once: two requests racing with the same code, only one gets through.
  const claimed = await Store.updateOne(
    { _id: store._id, "passwordReset.codeHash": r.codeHash },
    { $set: { passwordReset: { codeHash: "", attempts: 0 } } },
  );
  return claimed.modifiedCount ? "ok" : "expired";
};

const RESET_CODE_MESSAGES = {
  missing: "Enter the 6-digit reset code from KnotKitchen support.",
  wrong: "That reset code is not right. Check it with KnotKitchen support.",
  expired: "That reset code has expired or was already used. Ask KnotKitchen support for a new one.",
  locked: "Too many wrong reset codes. Ask KnotKitchen support for a new one.",
};

module.exports = { issueResetCode, useResetCode, RESET_CODE_MESSAGES, CODE_TTL_MS, MAX_TRIES };
