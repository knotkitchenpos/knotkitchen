/**
 * What a given restaurant pays, right now, for a given thing.
 *
 * One resolver. Every price in the system comes out of here, so there is
 * exactly one answer to "why was I charged this" and one place to change it.
 *
 * Two layers, and only two:
 *
 *   PlatformBillingConfig   the platform-wide defaults (plans, GST, the
 *                           per-order charge). A singleton.
 *   CsdStoreCharges         what THIS restaurant was negotiated. Already
 *                           existed, already audited, already has a CSD
 *                           dialog behind it -- so the plan-price overrides
 *                           were added there rather than in a second
 *                           collection beside it.
 *
 * Precedence, highest first:
 *   1. a per-restaurant price set by the admin  ("ABC pays 999 for Growth")
 *   2. an offer, if today falls inside its window
 *   3. the standard price
 *
 * A per-restaurant price beats an offer deliberately: it is a negotiated rate,
 * and a promotion should not silently override a deal someone agreed to. When
 * an offer happens to be cheaper the resolver says so in the returned
 * alternatives, so the admin panel can show that rather than hide it.
 *
 * CsdStoreCharges stores RUPEES because that is what the admin dialog edits.
 * This file is the single place they become paise; nothing downstream ever
 * sees a rupee amount again.
 */

const { PlatformBillingConfig, DEFAULT_PLANS } = require("../models/platformBillingModel");
const CsdStoreCharges = require("../models/csdStoreChargesModel");
const Restaurant = require("../models/restaurantModel");
const { toPaise } = require("./money");

/** The singleton, created empty on first read so the admin panel has something to edit. */
const getPlatformConfig = async () => {
  const existing = await PlatformBillingConfig.findOne({ singleton: "platform" });
  if (existing) {
    // An install that predates the seeded catalogue has a config row with no
    // plans in it, and the POS showed "No plans are available at the moment"
    // with no way for the restaurant to subscribe. Backfill once; an admin
    // who has since edited the catalogue is never overwritten, because this
    // only fires when it is EMPTY.
    if (!existing.plans || existing.plans.length === 0) {
      existing.plans = DEFAULT_PLANS.map((p) => ({ ...p }));
      await existing.save();
    }
    return existing;
  }
  return PlatformBillingConfig.create({ singleton: "platform" });
};

/**
 * The negotiated terms for a restaurant, or null.
 *
 * Charges are keyed by storeId (the six-digit id the CSD works in) while
 * everything financial here is keyed by restaurantId, so this bridges the two.
 * A restaurant with no row is simply on the platform defaults -- rows are
 * created lazily on first edit, which is why absence is normal and not an
 * error.
 */
const getOverride = async (restaurantId, { storeId } = {}) => {
  if (!restaurantId && !storeId) return null;
  let id = storeId;
  if (!id) {
    const restaurant = await Restaurant.findById(restaurantId).select("storeId").lean();
    id = restaurant?.storeId;
  }
  if (!id) return null;
  return CsdStoreCharges.findOne({ storeId: id }).lean();
};

const offerActiveAt = (offer, on) => {
  if (!offer || offer.pricePaise === null || offer.pricePaise === undefined) return false;
  const at = new Date(on);
  if (offer.startsAt && at < new Date(offer.startsAt)) return false;
  if (offer.endsAt && at > new Date(offer.endsAt)) return false;
  return true;
};

/** A negotiated price for one plan, in paise, or null if none is set. */
const customPricePaiseFor = (override, planCode) => {
  if (!override) return null;
  const row = (override.planPrices || []).find((p) => p.code === planCode);
  return row ? toPaise(row.price) : null;
};

/**
 * Resolve the price of one plan for one restaurant.
 *
 * Returns null when the plan does not exist or is retired, so a caller cannot
 * accidentally charge for something that is no longer sold.
 */
const resolvePlanPrice = async ({ restaurantId, planCode, on = new Date(), config, override } = {}) => {
  const cfg = config || (await getPlatformConfig());
  const plan = (cfg.plans || []).find((p) => p.code === planCode);
  if (!plan || !plan.isActive) return null;

  const ovr = override !== undefined ? override : await getOverride(restaurantId);
  const customPricePaise = customPricePaiseFor(ovr, planCode);
  const offerPricePaise = offerActiveAt(plan.offer, on) ? plan.offer.pricePaise : null;

  const alternatives = {
    standardPricePaise: plan.standardPricePaise,
    offerPricePaise,
    customPricePaise,
  };

  if (customPricePaise !== null) {
    return { ...alternatives, pricePaise: customPricePaise, source: "restaurant", plan };
  }
  if (offerPricePaise !== null) {
    return { ...alternatives, pricePaise: offerPricePaise, source: "offer", plan };
  }
  return { ...alternatives, pricePaise: plan.standardPricePaise, source: "standard", plan };
};

/** Every plan a restaurant may buy today, priced for them. */
const listPlansFor = async ({ restaurantId, on = new Date(), includeUnavailable = false } = {}) => {
  const config = await getPlatformConfig();
  const override = await getOverride(restaurantId);

  return Promise.all(
    (config.plans || [])
      .filter((p) => p.isActive && (includeUnavailable || p.isAvailable))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map(async (p) => {
        const resolved = await resolvePlanPrice({
          restaurantId,
          planCode: p.code,
          on,
          config,
          override,
        });
        return {
          code: p.code,
          name: p.name,
          features: p.features,
          isAvailable: p.isAvailable,
          ...resolved,
          plan: undefined,
        };
      }),
  );
};

/**
 * The per-order website charge for a restaurant.
 *
 * `enabled` is answered independently of the amount, because a restaurant set
 * to 0 is still "enabled and charged nothing" -- distinct from the charge
 * being switched off, and the two produce different reporting.
 */
const resolveOrderCharge = async ({ restaurantId, on = new Date(), config, override } = {}) => {
  const cfg = config || (await getPlatformConfig());
  const charge = cfg.websiteOrderCharge || {};
  const ovr = override !== undefined ? override : await getOverride(restaurantId);

  const started = charge.effectiveFrom ? new Date(on) >= new Date(charge.effectiveFrom) : false;

  // A stored 0 means "this restaurant is not charged per order" and is a real
  // setting; only an absent field falls through to the platform amount.
  const hasCustom =
    ovr && ovr.onlinePaidOrderCharge !== null && ovr.onlinePaidOrderCharge !== undefined;
  const amountPaise = hasCustom
    ? toPaise(ovr.onlinePaidOrderCharge)
    : Number(charge.amountPaise || 0);

  return {
    enabled: Boolean(charge.enabled) && started,
    started,
    amountPaise,
    taxable: charge.taxable !== false,
    chargeableSources: charge.chargeableSources || [],
    source: hasCustom ? "restaurant" : "platform",
  };
};

/**
 * The per-e-bill charge for a restaurant.
 *
 * Deliberately the same shape as resolveOrderCharge, including the null-vs-0
 * distinction: a stored 0 means "this restaurant is charged nothing per
 * e-bill", which is a decision someone made, and only an absent value falls
 * through to the platform amount.
 */
const resolveEBillCharge = async ({ restaurantId, on = new Date(), config, override } = {}) => {
  const cfg = config || (await getPlatformConfig());
  const charge = cfg.ebillCharge || {};
  const ovr = override !== undefined ? override : await getOverride(restaurantId);

  const started = charge.effectiveFrom ? new Date(on) >= new Date(charge.effectiveFrom) : false;
  const hasCustom = ovr && ovr.ebillCharge !== null && ovr.ebillCharge !== undefined;

  return {
    enabled: Boolean(charge.enabled) && started,
    started,
    amountPaise: hasCustom ? toPaise(ovr.ebillCharge) : Number(charge.amountPaise || 0),
    taxable: charge.taxable !== false,
    source: hasCustom ? "restaurant" : "platform",
  };
};

module.exports = {
  getPlatformConfig,
  resolveEBillCharge,
  getOverride,
  offerActiveAt,
  customPricePaiseFor,
  resolvePlanPrice,
  listPlansFor,
  resolveOrderCharge,
};
