const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { storeIdFromCode, codeFor } = require("../services/referrals");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("a referral code is KK + the Store ID; the bare Store ID works too", () => {
  assert.equal(codeFor("893146"), "KK893146");
  for (const c of ["KK893146", "kk893146", " KK 893146 ", "kk-893146", "893146"]) assert.equal(storeIdFromCode(c), "893146", c);
  for (const c of ["", "KK89314", "KKK893146", "893146x", "AB893146"]) assert.equal(storeIdFromCode(c), "", c);
});

test("the reward is claimed before it is paid, each credit once, and a failure is retried", () => {
  const s = src("services/referrals.js");
  assert.match(s, /\{ _id: pending\._id, status: "PENDING" \},\n\s+\{ \$set: \{ status: "REWARDING", rewardPaise \} \}/, "claimed first");
  assert.match(s, /idempotencyKey: `referral-\$\{claimed\._id\}-\$\{who\}`/, "one credit per store, ever");
  assert.match(s, /\[\["referrer", claimed\.referrerRestaurantId\], \["referred", claimed\.referredRestaurantId\]\]/, "both stores");
  assert.match(s, /kind: "PROMO_CREDIT"/);
  assert.match(s, /\$set: \{ status: "PENDING" \}/, "a failed payout goes back to pending");
});

test("wiring: CSD onboarding checks the code first; paid top-ups trigger it; CSD Billing sets the amount", () => {
  const o = src("controllers/csdOnboardingController.js");
  assert.ok(o.indexOf("findReferrer(v.referralCode)") < o.indexOf("await generateUniqueStoreId()"), "checked before the store exists");
  const r = src("services/recharge.js");
  assert.equal((r.match(/if \(!duplicate\) require\("\.\/referrals"\)\.afterTopUp\(/g) || []).length, 2, "single and shared top-ups");
  assert.match(src("models/platformBillingModel.js"), /referralRewardPaise: \{ type: Number, default: 50000, min: 0 \}/);
  assert.match(src("controllers/csdBillingConfigController.js"), /config\.referralRewardPaise = readPrice\(body\.referralReward/);
  assert.match(src("models/referralModel.js"), /referredRestaurantId: \{[^}]*unique: true \}/, "a store is referred once");
});
