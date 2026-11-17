/**
 * Referral programme (owner, 2026-11-17).
 *
 * A store's code is "KK" + its Store ID. CSD enters it when onboarding a new
 * store. When that new store's first top-up is paid, BOTH stores get the
 * platform's referral reward (CSD Billing, default ₹500 each; 0 = off) as
 * PROMO_CREDIT, once: the referral is claimed before crediting, and each
 * credit has its own idempotency key, so a repeated payment callback or two
 * API instances cannot pay twice.
 */

const Referral = require("../models/referralModel");

/** "KK893146", "kk 893146" or "893146" -> "893146"; anything else -> "". */
const storeIdFromCode = (input) => {
  const m = /^\s*(?:kk[\s-]*)?(\d{6})\s*$/i.exec(String(input || ""));
  return m ? m[1] : "";
};
const codeFor = (storeId) => `KK${storeId}`;

/** The referring store, or a sentence for the form. */
const findReferrer = async (code) => {
  const storeId = storeIdFromCode(code);
  if (!storeId) return { error: "A referral code is KK followed by the 6-digit Store ID." };
  const Restaurant = require("../models/restaurantModel");
  const r = await Restaurant.findOne({ storeId }).select("_id storeId name").lean();
  if (!r) return { error: "No store has that referral code." };
  return { referrer: r };
};

/** Record that `referred` (a new store) came through `referrer`. */
const recordReferral = ({ referrer, referredRestaurantId, referredStoreId, byName = "" }) =>
  Referral.create({
    referrerStoreId: referrer.storeId,
    referrerRestaurantId: referrer._id,
    referredStoreId,
    referredRestaurantId,
    recordedByName: byName,
  });

/** After a paid top-up: reward a pending referral of this store, once. Never throws. */
const afterTopUp = async (restaurantId) => {
  let claimedId = null;
  try {
    const pending = await Referral.findOne({ referredRestaurantId: restaurantId, status: "PENDING" }).select("_id").lean();
    if (!pending) return null;
    const { getPlatformConfig } = require("./pricing");
    const config = await getPlatformConfig();
    const rewardPaise = Math.max(0, Math.round(Number(config.referralRewardPaise ?? 50000) || 0));
    // Claim first: only one caller gets to pay.
    const claimed = await Referral.findOneAndUpdate(
      { _id: pending._id, status: "PENDING" },
      { $set: { status: "REWARDING", rewardPaise } },
      { new: true },
    );
    if (!claimed) return null;
    claimedId = claimed._id;
    if (rewardPaise > 0) {
      const { credit } = require("./ledger");
      for (const [who, rid] of [["referrer", claimed.referrerRestaurantId], ["referred", claimed.referredRestaurantId]]) {
        await credit({
          restaurantId: rid,
          kind: "PROMO_CREDIT",
          amountPaise: rewardPaise,
          description: who === "referrer" ? `Referral reward: store ${claimed.referredStoreId} joined` : `Welcome reward: referred by store ${claimed.referrerStoreId}`,
          idempotencyKey: `referral-${claimed._id}-${who}`,
          refType: "Referral",
          refId: claimed._id,
        });
      }
    }
    await Referral.updateOne({ _id: claimed._id }, { $set: { status: "REWARDED", rewardedAt: new Date() } });
    return claimed;
  } catch (err) {
    console.error("[referrals] reward failed:", err?.message);
    // Back to PENDING so the store's next top-up tries again; each credit's
    // idempotency key means a part already paid is not paid twice.
    if (claimedId) await Referral.updateOne({ _id: claimedId, status: "REWARDING" }, { $set: { status: "PENDING" } }).catch(() => {});
    return null;
  }
};

module.exports = { storeIdFromCode, codeFor, findReferrer, recordReferral, afterTopUp };
