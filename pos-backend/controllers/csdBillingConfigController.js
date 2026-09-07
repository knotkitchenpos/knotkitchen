const createHttpError = require("http-errors");
const { PlatformBillingConfig } = require("../models/platformBillingModel");
const { getPlatformConfig } = require("../services/pricing");
const { assessAccount } = require("../services/accountLock");
const { toPaise, toRupees, formatINR } = require("../services/money");
const { csdAudit } = require("../services/csdAuditService");

/**
 * The admin panel's view of KnotKitchen's own pricing.
 *
 * This is the only place plans, offers, GST and the per-order charge can be
 * set. No restaurant-facing route writes any of it -- that is the whole point
 * of the specification's rule that "all financial settings must be controlled
 * by the KnotKitchen Admin Panel".
 *
 * Rupees on the wire, paise in the database. The admin types 1299, not 129900,
 * and services/money.js is the only converter -- doing it in two places is how
 * a price ends up a hundred times out.
 */

const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Config as the admin edits it: money in rupees, everything else verbatim. */
const present = (config) => ({
  plans: (config.plans || []).map((p) => ({
    code: p.code,
    name: p.name,
    price: toRupees(p.standardPricePaise),
    priceLabel: formatINR(p.standardPricePaise),
    isActive: p.isActive,
    isAvailable: p.isAvailable,
    sortOrder: p.sortOrder,
    features: p.features || [],
    offer: {
      price: p.offer?.pricePaise === null || p.offer?.pricePaise === undefined
        ? null
        : toRupees(p.offer.pricePaise),
      startsAt: p.offer?.startsAt || null,
      endsAt: p.offer?.endsAt || null,
      label: p.offer?.label || "",
    },
  })),
  gst: {
    registered: config.gst?.registered || false,
    gstin: config.gst?.gstin || "",
    effectiveFrom: config.gst?.effectiveFrom || null,
    percent: config.gst?.percent || 0,
    mode: config.gst?.mode || "exclusive",
    placeOfSupplyState: config.gst?.placeOfSupplyState || "",
    legalName: config.gst?.legalName || "",
    addressLines: config.gst?.addressLines || [],
  },
  websiteOrderCharge: {
    enabled: config.websiteOrderCharge?.enabled || false,
    amount: toRupees(config.websiteOrderCharge?.amountPaise || 0),
    effectiveFrom: config.websiteOrderCharge?.effectiveFrom || null,
    chargeableSources: config.websiteOrderCharge?.chargeableSources || [],
    taxable: config.websiteOrderCharge?.taxable !== false,
  },
  subscriptionDays: config.subscriptionDays,
  graceHours: config.graceHours,
  renewalPolicy: config.renewalPolicy,
  upgradePolicy: config.upgradePolicy,
  lockScope: config.lockScope || "STAFF",
  updatedAt: config.updatedAt,
});

/** GET /api/csd/billing/config */
const getBillingConfig = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: present(await getPlatformConfig()) });
  } catch (err) {
    next(err);
  }
};

/**
 * Validate the whole plan list before writing any of it.
 *
 * All-or-nothing on purpose: a half-applied price list is worse than a
 * rejected one, because the half that applied is now live.
 */
const readPlans = (input, fieldErrors) => {
  if (!Array.isArray(input)) return null;

  const seen = new Set();
  return input.map((raw, i) => {
    const code = String(raw?.code || "").trim().toLowerCase();
    if (!code) fieldErrors[`plans.${i}.code`] = "A plan needs a code.";
    if (seen.has(code)) fieldErrors[`plans.${i}.code`] = `Duplicate plan code "${code}".`;
    seen.add(code);

    const price = num(raw?.price);
    if (price === null || Number.isNaN(price) || price < 0) {
      fieldErrors[`plans.${i}.price`] = "Price must be zero or more.";
    }

    const offerPrice = num(raw?.offer?.price);
    if (offerPrice !== null && (Number.isNaN(offerPrice) || offerPrice < 0)) {
      fieldErrors[`plans.${i}.offer.price`] = "Offer price must be zero or more.";
    }

    const startsAt = asDate(raw?.offer?.startsAt);
    const endsAt = asDate(raw?.offer?.endsAt);
    if (startsAt && endsAt && endsAt < startsAt) {
      fieldErrors[`plans.${i}.offer.endsAt`] = "The offer ends before it starts.";
    }
    // An offer window with no price would silently never apply, which reads
    // to an admin like the feature is broken.
    if (offerPrice === null && (startsAt || endsAt)) {
      fieldErrors[`plans.${i}.offer.price`] = "Set an offer price, or clear the dates.";
    }

    return {
      code,
      name: String(raw?.name || "").trim() || code,
      standardPricePaise: toPaise(price || 0),
      isActive: raw?.isActive !== false,
      isAvailable: raw?.isAvailable !== false,
      sortOrder: Number(raw?.sortOrder) || 0,
      features: Array.isArray(raw?.features) ? raw.features.map((f) => String(f).slice(0, 200)) : [],
      offer: {
        pricePaise: offerPrice === null ? null : toPaise(offerPrice),
        startsAt,
        endsAt,
        label: String(raw?.offer?.label || "").slice(0, 120),
      },
    };
  });
};

/** PATCH /api/csd/billing/config — admin only. */
const updateBillingConfig = async (req, res, next) => {
  try {
    const config = await getPlatformConfig();
    const body = req.body || {};
    const fieldErrors = {};
    const before = present(config);

    if (body.plans !== undefined) {
      const plans = readPlans(body.plans, fieldErrors);
      if (plans) config.plans = plans;
      else fieldErrors.plans = "Plans must be a list.";
    }

    if (body.gst !== undefined) {
      const g = body.gst || {};
      const percent = num(g.percent);
      if (percent !== null && (Number.isNaN(percent) || percent < 0 || percent > 100)) {
        fieldErrors["gst.percent"] = "GST percentage must be between 0 and 100.";
      }
      // Registered with no start date would tax nothing and look broken.
      if (g.registered && !asDate(g.effectiveFrom)) {
        fieldErrors["gst.effectiveFrom"] =
          "Set the date GST starts applying, or leave Registered off.";
      }
      config.gst = {
        registered: Boolean(g.registered),
        gstin: String(g.gstin || "").trim().toUpperCase(),
        effectiveFrom: asDate(g.effectiveFrom),
        percent: percent === null ? config.gst?.percent || 0 : percent,
        mode: g.mode === "inclusive" ? "inclusive" : "exclusive",
        placeOfSupplyState: String(g.placeOfSupplyState || "").trim(),
        legalName: String(g.legalName || "").trim(),
        addressLines: Array.isArray(g.addressLines)
          ? g.addressLines.map((l) => String(l).slice(0, 200))
          : [],
      };
    }

    if (body.websiteOrderCharge !== undefined) {
      const c = body.websiteOrderCharge || {};
      const amount = num(c.amount);
      if (amount !== null && (Number.isNaN(amount) || amount < 0)) {
        fieldErrors["websiteOrderCharge.amount"] = "The charge must be zero or more.";
      }
      if (c.enabled && !asDate(c.effectiveFrom)) {
        fieldErrors["websiteOrderCharge.effectiveFrom"] =
          "Set the date the charge starts applying.";
      }
      config.websiteOrderCharge = {
        enabled: Boolean(c.enabled),
        amountPaise: toPaise(amount === null ? toRupees(config.websiteOrderCharge?.amountPaise || 0) : amount),
        effectiveFrom: asDate(c.effectiveFrom),
        chargeableSources: Array.isArray(c.chargeableSources)
          ? [...new Set(c.chargeableSources.map((s) => String(s).trim().toUpperCase()))]
          : config.websiteOrderCharge?.chargeableSources || [],
        taxable: c.taxable !== false,
      };
    }

    for (const [key, min, max] of [
      ["subscriptionDays", 1, 366],
      ["graceHours", 0, 720],
    ]) {
      if (body[key] === undefined) continue;
      const n = num(body[key]);
      if (n === null || Number.isNaN(n) || n < min || n > max) {
        fieldErrors[key] = `Must be between ${min} and ${max}.`;
      } else config[key] = n;
    }

    for (const [key, allowed] of [
      ["renewalPolicy", ["FROM_PAYMENT", "FROM_EXPIRY"]],
      ["upgradePolicy", ["PRORATE", "FULL_DIFFERENCE", "FULL_PRICE"]],
      ["lockScope", ["STAFF", "STAFF_AND_STOREFRONT"]],
    ]) {
      if (body[key] === undefined) continue;
      if (!allowed.includes(body[key])) fieldErrors[key] = `Must be one of ${allowed.join(", ")}.`;
      else config[key] = body[key];
    }

    if (Object.keys(fieldErrors).length) {
      return next(createHttpError(400, "Please correct the highlighted fields.", { fieldErrors }));
    }

    await config.save();

    // Pricing changes are the kind of thing someone has to be able to account
    // for later.
    try {
      await csdAudit({
        req,
        staff: req.csdStaff,
        action: "BILLING.CONFIG.UPDATE",
        resource: "PlatformBillingConfig",
        entityType: "PlatformBillingConfig",
        entityId: String(config._id),
        description: "Platform billing configuration updated",
        previousValue: before,
        newValue: present(config),
        severity: "WARN",
      });
    } catch (auditErr) {
      console.warn("[csd-billing] audit failed:", auditErr.message);
    }

    res.status(200).json({ success: true, data: present(config) });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/csd/billing/accounts/:restaurantId — would this account lock, and why?
 *
 * Read-only. Deliberately does not APPLY the lock: an admin looking at a
 * restaurant should not be the thing that locks it.
 */
const getAccountStanding = async (req, res, next) => {
  try {
    const assessment = await assessAccount(req.params.restaurantId);
    res.status(200).json({
      success: true,
      data: { ...assessment, duesLabel: formatINR(assessment.duesPaise) },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getBillingConfig,
  updateBillingConfig,
  getAccountStanding,
  present,
  readPlans,
};
