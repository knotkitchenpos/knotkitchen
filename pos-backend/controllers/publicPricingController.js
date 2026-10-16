const { getPlatformConfig, catalogPricePaise } = require("../services/pricing");
const { isRetiredAddon } = require("../models/platformBillingModel");
const { plansOf } = require("../services/plans");
const { toRupees } = require("../services/money");

/**
 * GET /api/public/pricing — the catalogue as knotkitchen.com shows it
 * (deploy/landing/home.js), so a price changed or a device added in CSD
 * Billing reaches the website by itself.
 *
 * Catalogue values only: a store's negotiated price (CsdStoreCharges) is
 * never read here. Off-sale and retired items are left out. Rupees, like the
 * rest of the wire.
 */
const publicPricing = (config) => {
  const days = Number(config.subscriptionDays) || 30;
  const charge = (key) => toRupees(config[key]?.amountPaise || 0);
  return {
    currency: config.currency || "INR",
    periodDays: days,
    plans: plansOf(config).map((p) => ({
      code: p.code,
      name: p.name,
      price: toRupees(catalogPricePaise(config, p.code)),
      firstRechargeMin: toRupees(p.firstRechargeMinPaise),
      topUpMin: toRupees(p.topUpMinPaise),
    })),
    addons: [...(config.addons || [])]
      .filter((a) => a.isActive !== false && !isRetiredAddon(a))
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0))
      .map((a) => ({
        code: a.code,
        name: a.name,
        description: a.description || "",
        price: toRupees(a.pricePaise),
        // Its own period (365: the yearly Website), else the plan's.
        periodDays: Number(a.periodDays) || days,
      })),
    devices: [...(config.printers || [])]
      .filter((p) => p.isActive !== false)
      .map((p) => ({
        code: p.code,
        name: p.name,
        description: p.description || "",
        price: toRupees(p.pricePaise),
        imageUrl: p.imageUrl || "",
      })),
    // Already listed on the site as amounts, whether or not CSD has switched them on.
    charges: {
      website: charge("websiteOrderCharge"),
      qr: charge("qrOrderCharge"),
      knotEats: charge("knotEatsOrderCharge"),
      ebill: charge("ebillCharge"),
    },
    // CSD's per-charge GST switch: false drops the site's "+ GST" after that amount.
    taxable: {
      website: config.websiteOrderCharge?.taxable !== false,
      qr: config.qrOrderCharge?.taxable !== false,
      knotEats: config.knotEatsOrderCharge?.taxable !== false,
      ebill: config.ebillCharge?.taxable !== false,
    },
  };
};

// One read a minute at most, however many visitors; a CSD save clears it.
const TTL_MS = 60 * 1000;
let cached = null;

const clearPricingCache = () => {
  cached = null;
};

const getPublicPricing = async (req, res, next) => {
  try {
    if (!cached || Date.now() - cached.at > TTL_MS) {
      cached = { at: Date.now(), data: publicPricing(await getPlatformConfig()) };
    }
    res.set("Cache-Control", "public, max-age=60");
    res.status(200).json({ success: true, data: cached.data });
  } catch (err) {
    next(err);
  }
};

module.exports = { getPublicPricing, clearPricingCache, publicPricing };
