/**
 * What a given restaurant pays, right now, for a given thing.
 *
 * One resolver. Every price in the system comes out of here, so there is
 * exactly one answer to "why was I charged this" and one place to change it.
 *
 * Two layers, and only two:
 *
 *   PlatformBillingConfig   the platform-wide catalogue (the POS plan,
 *                           add-ons, devices, legacy tablet rentals, GST, the
 *                           usage charges). A singleton.
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

const {
  PlatformBillingConfig,
  DEFAULT_ADDONS,
  DEFAULT_PRINTERS,
  DEFAULT_PLAN_PAISE,
  DEFAULT_FIRST_RECHARGE_MIN_PAISE,
  CATALOG_VERSION,
  DEFAULT_ORDER_CHARGE,
  DEFAULT_QR_ORDER_CHARGE,
  DEFAULT_KNOT_EATS_ORDER_CHARGE,
  DEFAULT_EBILL_CHARGE,
} = require("../models/platformBillingModel");
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
    if (backfillCharges(existing)) seeded = true;
    if (!(Number(existing.catalogVersion) >= CATALOG_VERSION)) {
      // One step per version, each run once. Re-running v1→v2 on a v2 row would reset CSD's platform fees.
      const from = Number(existing.catalogVersion) || 1;
      if (from < 2) await upgradeCatalog(existing);
      // A first minimum CSD never changed moves to today's; an edited one is kept.
      if (from < 3 && Number(existing.firstRechargeMinPaise) === V2.firstRechargeMinPaise) {
        existing.firstRechargeMinPaise = DEFAULT_FIRST_RECHARGE_MIN_PAISE;
      }
      existing.catalogVersion = CATALOG_VERSION;
      // Saved only if nobody else saved this row since it was read: two
      // servers upgrading at once write it once, and the other re-reads.
      existing.increment();
      seeded = true;
    }
    if (seeded) {
      try {
        await existing.save();
      } catch (err) {
        if (err?.name === "VersionError") return getPlatformConfig();
        throw err;
      }
    }
    // FROM_EXPIRY is retired (renewal always starts from the payment). A row
    // that still holds it reads as FROM_PAYMENT; nothing is written for it.
    if (existing.renewalPolicy === "FROM_EXPIRY") existing.renewalPolicy = "FROM_PAYMENT";
    return existing;
  }
  return PlatformBillingConfig.create({ singleton: "platform" });
};

/**
 * A usage charge nobody has configured: off, no start date, no amount. The
 * shipped price goes in, still OFF -- CSD switches it on and picks the date.
 * Anything an admin set (a switch, a date, an amount) is left alone.
 *
 * Mutates `config`; true when it changed something.
 */
const backfillCharges = (config) => {
  const unset = (c) => !c || (!c.enabled && !c.effectiveFrom && !Number(c.amountPaise));
  let changed = false;
  for (const [key, shipped] of [
    ["websiteOrderCharge", DEFAULT_ORDER_CHARGE],
    ["qrOrderCharge", DEFAULT_QR_ORDER_CHARGE],
    ["knotEatsOrderCharge", DEFAULT_KNOT_EATS_ORDER_CHARGE],
    ["ebillCharge", DEFAULT_EBILL_CHARGE],
  ]) {
    if (!unset(config[key])) continue;
    config.set(`${key}.amountPaise`, shipped.amountPaise);
    changed = true;
  }
  return changed;
};

/**
 * What catalogVersion 1 shipped. A stored value still equal to one of these
 * was never changed in CSD, so the upgrade moves it to today's catalogue;
 * anything CSD did change is left exactly as it is.
 */
const V1 = { planPaise: 39900, websitePaise: 30000, printer2inPaise: 190000, printer3inPaise: 425000, orderChargePaise: 900 };
// What catalogVersion 2 shipped.
const V2 = { firstRechargeMinPaise: 250000 };
const NEW_DEVICES = ["TABLET", "PRINTER_3IN_LAN", "PRINTER_3IN_USB"];

/**
 * The v1→v2 step (the October 2026 prices); the caller sets catalogVersion.
 * Stands in for a migration the owner would otherwise have to run by hand.
 *
 * The one order charge for website + table QR becomes one charge per source:
 * the website's keeps its switch and date only if WEBSITE was one of its
 * sources, and the new table-QR one copies them only if QR was. Store rows
 * still holding the ₹9 CsdStoreCharges once copied into every row (and nobody
 * edited) go back to the platform rate -- migration 011's reset.
 *
 * Mutates `config`; the caller saves it.
 */
const upgradeCatalog = async (config) => {
  if (Number(config.basePlan?.pricePaise) === V1.planPaise) config.set("basePlan.pricePaise", DEFAULT_PLAN_PAISE);

  const site = (config.addons || []).find((a) => a.code === "WEBSITE");
  if (site && Number(site.pricePaise) === V1.websitePaise) {
    const shipped = DEFAULT_ADDONS.find((a) => a.code === "WEBSITE");
    site.pricePaise = shipped.pricePaise;
    site.periodDays = shipped.periodDays;
    await yearlyWebsitePrices();
  }
  for (const [code, oldPaise] of [["PRINTER_2IN", V1.printer2inPaise], ["PRINTER_3IN", V1.printer3inPaise]]) {
    const printer = (config.printers || []).find((p) => p.code === code);
    if (!printer || Number(printer.pricePaise) !== oldPaise) continue;
    const shipped = DEFAULT_PRINTERS.find((p) => p.code === code);
    printer.pricePaise = shipped.pricePaise;
    printer.name = shipped.name;
  }
  // A code is unique across both lists (CSD may have given one to an add-on).
  const codes = new Set([...(config.addons || []), ...(config.printers || [])].map((x) => x.code));
  for (const code of NEW_DEVICES) {
    if (codes.has(code)) continue;
    const device = { ...DEFAULT_PRINTERS.find((p) => p.code === code) };
    // The tablet heads the list, as on the price list; printers go after.
    if (code === "TABLET") config.printers.unshift(device);
    else config.printers.push(device);
  }

  const old = config.websiteOrderCharge || {};
  const sources = config.get("websiteOrderCharge.chargeableSources", null, { strict: false }) || [];
  const from = (source) =>
    sources.includes(source)
      ? { enabled: Boolean(old.enabled), effectiveFrom: old.effectiveFrom || null }
      : { enabled: false, effectiveFrom: null };
  const taxable = old.taxable !== false;
  const amountPaise = Number(old.amountPaise) === V1.orderChargePaise ? DEFAULT_ORDER_CHARGE.amountPaise : Number(old.amountPaise) || 0;
  const qr = { ...from("QR"), amountPaise: DEFAULT_QR_ORDER_CHARGE.amountPaise, taxable };
  // Assigned whole, so the retired chargeableSources goes with the old value.
  config.websiteOrderCharge = { ...from("WEBSITE"), amountPaise, taxable };
  config.qrOrderCharge = qr;

  await CsdStoreCharges.updateMany(
    { onlinePaidOrderCharge: 9, history: { $not: { $elemMatch: { field: "onlinePaidOrderCharge" } } } },
    { $set: { onlinePaidOrderCharge: null } },
  );
};

/**
 * A store's negotiated Website price was per 30 days; once the catalogue
 * Website is sold per year it would otherwise buy a whole year. Each one
 * becomes 12 times itself, with a history line so CSD can see why. That line
 * marks the row done, and the write is guarded on the row's updatedAt, so two
 * servers upgrading at once (or a CSD edit in between) never multiply a price
 * twice.
 */
const YEARLY_WEBSITE = "Website now yearly (x12)";
const yearlyWebsitePrices = async () => {
  const isSite = (p) => String(p.code).toUpperCase() === "WEBSITE";
  const list = (prices) => prices.map((p) => `${p.code}:${p.price}`).join(", ");
  const rows = await CsdStoreCharges.find({
    "planPrices.code": /^website$/i,
    history: { $not: { $elemMatch: { field: "planPrices", byName: YEARLY_WEBSITE } } },
  }).lean();
  for (const row of rows) {
    const to = row.planPrices.map((p) => (isSite(p) ? { ...p, price: p.price * 12 } : p));
    await CsdStoreCharges.updateOne(
      { _id: row._id, updatedAt: row.updatedAt ?? null },
      {
        $set: { planPrices: to },
        $push: { history: { field: "planPrices", from: list(row.planPrices), to: list(to), byName: YEARLY_WEBSITE } },
      },
    );
  }
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
 * sold. Codes: the POS plan ("POS"), an add-on (per its own period when it
 * has one), a device (TABLET or a printer, GST-inclusive), and TABLET_FIRST /
 * TABLET_EXTRA for tablets rented before tablets were sold.
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

// Each order source with a platform fee: its platform charge, and the
// per-store override (rupees) that replaces the amount for one store.
const ORDER_CHARGES = {
  WEBSITE: ["websiteOrderCharge", "onlinePaidOrderCharge"],
  QR: ["qrOrderCharge", "qrPaidOrderCharge"],
  // Not an Order.source: a website order placed through Knot Eats is quoted
  // under this key instead of WEBSITE (Order.salesChannel "KNOT_EATS").
  KNOT_EATS: ["knotEatsOrderCharge", "knotEatsPaidOrderCharge"],
};

/**
 * The platform fee on an order from `source` ("WEBSITE", "QR" or "KNOT_EATS") at a
 * restaurant, for an order placed `on` that day. Any other source has none.
 *
 * `enabled` is answered independently of the amount, because a restaurant set
 * to 0 is still "enabled and charged nothing" -- distinct from the charge
 * being switched off, and the two produce different reporting.
 *
 * Two start dates, both chosen in CSD: the platform's effectiveFrom, and an
 * optional per-store orderChargeFrom that can only delay it further for that
 * store (every source). Without a platform date nothing is charged anywhere.
 */
const resolveOrderCharge = async ({ restaurantId, source, on = new Date(), config, override } = {}) => {
  const [chargeKey, overrideKey] = ORDER_CHARGES[source] || [];
  if (!chargeKey) {
    return { enabled: false, amountPaise: 0, taxable: false, source: "platform", reason: `Order source ${source} is not chargeable.` };
  }
  const cfg = config || (await getPlatformConfig());
  const charge = cfg[chargeKey] || {};
  const ovr = override !== undefined ? override : await getOverride(restaurantId);

  const storeFrom = ovr?.orderChargeFrom ? new Date(ovr.orderChargeFrom) : null;
  const startsAt = charge.effectiveFrom
    ? new Date(Math.max(new Date(charge.effectiveFrom).getTime(), storeFrom ? storeFrom.getTime() : 0))
    : null;
  const started = startsAt ? new Date(on) >= startsAt : false;

  // A stored 0 means "this restaurant is not charged per order" and is a real
  // setting; only null (the default) or an absent field falls through to the
  // platform amount.
  const hasCustom = ovr && ovr[overrideKey] !== null && ovr[overrideKey] !== undefined;
  const amountPaise = hasCustom ? toPaise(ovr[overrideKey]) : Number(charge.amountPaise || 0);

  return {
    // A demo store (CSD) is never charged per order.
    enabled: Boolean(charge.enabled) && started && !ovr?.billingExempt,
    started,
    startsAt,
    amountPaise,
    taxable: charge.taxable !== false,
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
