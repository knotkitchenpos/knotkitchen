/**
 * What a given restaurant pays, right now, for a given thing.
 *
 * One resolver. Every price in the system comes out of here, so there is
 * exactly one answer to "why was I charged this" and one place to change it.
 *
 * Two layers, and only two:
 *
 *   PlatformBillingConfig   the platform-wide catalogue (the POS plan,
 *                           add-ons, tablets, printers, GST, the per-order
 *                           charge). A singleton.
 *   CsdStoreCharges         what THIS restaurant was negotiated. Already
 *                           existed, already audited, already has a CSD
 *                           dialog behind it -- so the price overrides were
 *                           added there rather than in a second collection
 *                           beside it.
 *
 * A per-restaurant price beats the catalogue: it is a negotiated rate.
 *
 * CsdStoreCharges stores RUPEES because that is what the admin dialog edits.
 * This file is the single place they become paise; nothing downstream ever
 * sees a rupee amount again.
 */

const { PlatformBillingConfig, DEFAULT_ADDONS, DEFAULT_PRINTERS } = require("../models/platformBillingModel");
const CsdStoreCharges = require("../models/csdStoreChargesModel");
const Restaurant = require("../models/restaurantModel");
const { toPaise } = require("./money");

/** The singleton, created on first read so the admin panel has something to edit. */
const getPlatformConfig = async () => {
  const existing = await PlatformBillingConfig.findOne({ singleton: "platform" });
  if (existing) {
    // A config row that predates the catalogue has nothing to sell. Backfill
    // once; an admin who has since edited the catalogue is never
    // overwritten, because this only fires when a list is EMPTY.
    let seeded = false;
    if (!existing.addons || existing.addons.length === 0) {
      existing.addons = DEFAULT_ADDONS.map((a) => ({ ...a }));
      seeded = true;
    }
    if (!existing.printers || existing.printers.length === 0) {
      existing.printers = DEFAULT_PRINTERS.map((a) => ({ ...a }));
      seeded = true;
    }
    if (seeded) await existing.save();
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

/**
 * The catalogue price of one code, in paise, or null when no such thing is
 * sold. Codes: the POS plan ("POS"), an add-on, TABLET_FIRST, TABLET_EXTRA,
 * a printer.
 */
const catalogPricePaise = (config, code) => {
  if (code === (config.basePlan?.code || "POS")) return Number(config.basePlan?.pricePaise) || 0;
  if (code === "TABLET_FIRST") return Number(config.tablet?.firstPricePaise) || 0;
  if (code === "TABLET_EXTRA") return Number(config.tablet?.extraPricePaise) || 0;
  const item = [...(config.addons || []), ...(config.printers || [])].find((i) => i.code === code);
  return item ? Number(item.pricePaise) || 0 : null;
};

/**
 * What this restaurant pays for `code`, in paise: its negotiated price, else
 * the catalogue's. Null when the code is not sold. Pass `config`/`override`
 * when already loaded, to save the reads.
 */
const priceFor = async ({ restaurantId, code, config, override } = {}) => {
  const key = String(code || "").toUpperCase();
  const ovr = override !== undefined ? override : await getOverride(restaurantId);
  // CSD saved these lowercased before the codes were settled; match either.
  const row = (ovr?.planPrices || []).find((p) => String(p.code).toUpperCase() === key);
  const catalog = catalogPricePaise(config || (await getPlatformConfig()), key);
  if (catalog === null) return null;
  return row ? toPaise(row.price) : catalog;
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
    // A demo store (CSD) is never charged per order.
    enabled: Boolean(charge.enabled) && started && !ovr?.billingExempt,
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
    // A demo store (CSD) is never charged per e-bill.
    enabled: Boolean(charge.enabled) && started && !ovr?.billingExempt,
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
  catalogPricePaise,
  priceFor,
  resolveOrderCharge,
};
