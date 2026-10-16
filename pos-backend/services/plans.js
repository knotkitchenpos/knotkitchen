/**
 * The two subscription plans: POS (everything) and BILLING (billing only,
 * services/planFeatures). Their prices and top-up minimums live in the
 * catalogue (PlatformBillingConfig basePlan / billingPlan); prices are always
 * read through services/pricing priceFor, never from here.
 *
 * No requires on purpose: tests mock services/pricing with only a few of its
 * functions, so plan helpers cannot live there.
 */

const POS_PLAN = "POS";
const BILLING_PLAN = "BILLING";
// Higher is bigger. A store may only move up; KnotKitchen (CSD) moves it down.
const PLAN_RANK = { BILLING: 0, POS: 1 };

const isBilling = (code) => String(code || "").trim().toUpperCase() === BILLING_PLAN;

/** A store's plan from the catalogue; "" or anything unknown is the POS plan. */
const planOf = (config, code) => isBilling(code)
  ? { code: BILLING_PLAN, name: config?.billingPlan?.name || "Billing",
      firstRechargeMinPaise: Number(config?.billingPlan?.firstRechargeMinPaise) || 0,
      topUpMinPaise: Number(config?.billingPlan?.topUpMinPaise) || 0 }
  : { code: config?.basePlan?.code || POS_PLAN, name: config?.basePlan?.name || POS_PLAN,
      firstRechargeMinPaise: Number(config?.firstRechargeMinPaise) || 0,
      topUpMinPaise: Number(config?.topUpMinPaise) || 0 };

const plansOf = (config) => [planOf(config, POS_PLAN), planOf(config, BILLING_PLAN)];

module.exports = { POS_PLAN, BILLING_PLAN, PLAN_RANK, isBilling, planOf, plansOf };
