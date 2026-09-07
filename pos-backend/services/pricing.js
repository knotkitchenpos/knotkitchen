/**
 * What a given restaurant pays, right now, for a given thing.
 *
 * One resolver. Every price in the system comes out of here, so there is
 * exactly one answer to "why was I charged this" and one place to change it.
 *
 * Precedence, highest first:
 *   1. a per-restaurant price set by the admin  ("ABC pays 999 for Growth")
 *   2. an offer, if today falls inside its window
 *   3. the standard price
 *
 * A per-restaurant price beats an offer deliberately: it is a negotiated rate,
 * and a promotion should not silently override a deal someone agreed to. When
 * an offer happens to be cheaper the resolver says so in `alternatives`, so
 * the admin panel can show it rather than hiding the fact.
 */

const { PlatformBillingConfig, RestaurantBillingOverride } = require("../models/platformBillingModel");

/** The singleton, created empty on first read so the admin panel has something to edit. */
const getPlatformConfig = async () => {
  const existing = await PlatformBillingConfig.findOne({ singleton: "platform" });
  if (existing) return existing;
  return PlatformBillingConfig.create({ singleton: "platform" });
};

const getOverride = (restaurantId) =>
  restaurantId ? RestaurantBillingOverride.findOne({ restaurantId }) : null;

const offerActiveAt = (offer, on) => {
  if (!offer || offer.pricePaise === null || offer.pricePaise === undefined) return false;
  const at = new Date(on);
  if (offer.startsAt && at < new Date(offer.startsAt)) return false;
  if (offer.endsAt && at > new Date(offer.endsAt)) return false;
  return true;
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
  const custom = (ovr?.planPrices || []).find((p) => p.code === planCode);

  const offerPrice = offerActiveAt(plan.offer, on) ? plan.offer.pricePaise : null;
  const alternatives = {
    standardPricePaise: plan.standardPricePaise,
    offerPricePaise: offerPrice,
    customPricePaise: custom ? custom.pricePaise : null,
  };

  if (custom) {
    return { ...alternatives, pricePaise: custom.pricePaise, source: "restaurant", plan };
  }
  if (offerPrice !== null) {
    return { ...alternatives, pricePaise: offerPrice, source: "offer", plan };
  }
  return { ...alternatives, pricePaise: plan.standardPricePaise, source: "standard", plan };
};

/** Every plan a restaurant may buy today, priced for them. */
const listPlansFor = async ({ restaurantId, on = new Date(), includeUnavailable = false } = {}) => {
  const config = await getPlatformConfig();
  const override = await getOverride(restaurantId);

  const priced = await Promise.all(
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
  return priced;
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
  const enabled =
    ovr && ovr.orderChargeEnabled !== null && ovr.orderChargeEnabled !== undefined
      ? Boolean(ovr.orderChargeEnabled)
      : Boolean(charge.enabled);

  // null means "not set for this restaurant". 0 means "set, and it is zero".
  const amountPaise =
    ovr && ovr.orderChargePaise !== null && ovr.orderChargePaise !== undefined
      ? ovr.orderChargePaise
      : Number(charge.amountPaise || 0);

  return {
    enabled: enabled && started,
    started,
    amountPaise,
    taxable: charge.taxable !== false,
    chargeableSources: charge.chargeableSources || [],
    source:
      ovr && ovr.orderChargePaise !== null && ovr.orderChargePaise !== undefined
        ? "restaurant"
        : "platform",
  };
};

module.exports = {
  getPlatformConfig,
  getOverride,
  offerActiveAt,
  resolvePlanPrice,
  listPlansFor,
  resolveOrderCharge,
};
