const createHttpError = require("http-errors");
const { PlatformBillingConfig } = require("../models/platformBillingModel");
const { getPlatformConfig } = require("../services/pricing");
const { assessAccount } = require("../services/accountLock");
const { statusFor, endTablet, SubscriptionError } = require("../services/subscription");
const { toPaise, toRupees, formatINR } = require("../services/money");
const { csdAudit } = require("../services/csdAuditService");

/**
 * The admin panel's view of KnotKitchen's own pricing.
 *
 * This is the only place the POS plan, add-ons, tablets, printers, GST and
 * the per-order charge can be set. No restaurant-facing route writes any of it -- that is the whole point
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
  basePlan: {
    code: config.basePlan?.code || "POS",
    name: config.basePlan?.name || "POS",
    price: toRupees(config.basePlan?.pricePaise || 0),
    priceLabel: formatINR(config.basePlan?.pricePaise || 0),
  },
  addons: (config.addons || []).map((a) => ({
    code: a.code,
    name: a.name,
    description: a.description || "",
    price: toRupees(a.pricePaise),
    priceLabel: formatINR(a.pricePaise),
    feature: a.feature || "",
    isActive: a.isActive !== false,
    sortOrder: a.sortOrder || 0,
  })),
  tablet: {
    firstPrice: toRupees(config.tablet?.firstPricePaise || 0),
    extraPrice: toRupees(config.tablet?.extraPricePaise || 0),
    rechargeRequired: toRupees(config.tablet?.rechargeRequiredPaise || 0),
  },
  printers: (config.printers || []).map((p) => ({
    code: p.code,
    name: p.name,
    price: toRupees(p.pricePaise),
    priceLabel: formatINR(p.pricePaise),
    isActive: p.isActive !== false,
  })),
  firstRechargeMin: toRupees(config.firstRechargeMinPaise || 0),
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
  ebillCharge: {
    enabled: config.ebillCharge?.enabled || false,
    amount: toRupees(config.ebillCharge?.amountPaise || 0),
    effectiveFrom: config.ebillCharge?.effectiveFrom || null,
    taxable: config.ebillCharge?.taxable !== false,
  },
  subscriptionDays: config.subscriptionDays,
  graceHours: config.graceHours,
  renewalPolicy: config.renewalPolicy,
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

const CODE = /^[A-Z0-9_]{2,30}$/;
// Codes a price override can name besides the catalogue's own (services/pricing).
const RESERVED_CODES = ["POS", "TABLET_FIRST", "TABLET_EXTRA"];
const FEATURES = ["", "website", "tableQr"];

/** A price in rupees, as paise, or an error on `key`. */
const readPrice = (value, key, fieldErrors) => {
  const n = num(value);
  if (n === null || Number.isNaN(n) || n < 0) {
    fieldErrors[key] = "Price must be zero or more.";
    return 0;
  }
  return toPaise(n);
};

/**
 * Validate a whole catalogue list (add-ons or printers) before writing any of
 * it. All-or-nothing on purpose: a half-applied price list is worse than a
 * rejected one, because the half that applied is now live. `seen` is shared
 * between the two lists, because a price override names a code without
 * saying which list it is in.
 */
const readCatalog = (input, field, fieldErrors, seen, { addons = false } = {}) => {
  if (!Array.isArray(input)) {
    fieldErrors[field] = "Must be a list.";
    return null;
  }
  return input.map((raw, i) => {
    const code = String(raw?.code || "").trim().toUpperCase();
    if (!CODE.test(code)) {
      fieldErrors[`${field}.${i}.code`] = "Use 2 to 30 capital letters, digits or _.";
    } else if (seen.has(code) || RESERVED_CODES.includes(code)) {
      fieldErrors[`${field}.${i}.code`] = `The code "${code}" is already used.`;
    }
    seen.add(code);
    const item = {
      code,
      name: String(raw?.name || "").trim().slice(0, 80) || code,
      pricePaise: readPrice(raw?.price, `${field}.${i}.price`, fieldErrors),
      isActive: raw?.isActive !== false,
    };
    if (!addons) return item;
    const feature = raw?.feature === undefined || raw?.feature === null ? "" : String(raw.feature);
    if (!FEATURES.includes(feature)) {
      fieldErrors[`${field}.${i}.feature`] = "Feature must be none, website or tableQr.";
    }
    return {
      ...item,
      description: String(raw?.description || "").trim().slice(0, 300),
      feature,
      sortOrder: Number(raw?.sortOrder) || 0,
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

    if (body.basePlan !== undefined) {
      const bp = body.basePlan || {};
      config.basePlan = {
        code: config.basePlan?.code || "POS",
        name: String(bp.name || "").trim().slice(0, 80) || config.basePlan?.name || "POS",
        pricePaise: readPrice(bp.price, "basePlan.price", fieldErrors),
      };
    }

    // Codes stay unique across both lists, counting the one not being sent.
    const seen = new Set();
    const addons = body.addons !== undefined
      ? readCatalog(body.addons, "addons", fieldErrors, seen, { addons: true })
      : null;
    if (body.addons === undefined) (config.addons || []).forEach((x) => seen.add(x.code));
    const printers = body.printers !== undefined
      ? readCatalog(body.printers, "printers", fieldErrors, seen)
      : null;
    if (body.addons !== undefined && body.printers === undefined) {
      for (const x of config.printers || []) {
        if (seen.has(x.code)) fieldErrors.addons = `The code "${x.code}" is already a printer.`;
      }
    }
    if (addons) config.addons = addons;
    if (printers) config.printers = printers;

    if (body.tablet !== undefined) {
      const t = body.tablet || {};
      config.tablet = {
        firstPricePaise: readPrice(t.firstPrice, "tablet.firstPrice", fieldErrors),
        extraPricePaise: readPrice(t.extraPrice, "tablet.extraPrice", fieldErrors),
        rechargeRequiredPaise: readPrice(t.rechargeRequired, "tablet.rechargeRequired", fieldErrors),
      };
    }

    if (body.firstRechargeMin !== undefined) {
      config.firstRechargeMinPaise = readPrice(body.firstRechargeMin, "firstRechargeMin", fieldErrors);
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

    if (body.ebillCharge !== undefined) {
      const c = body.ebillCharge || {};
      const amount = num(c.amount);
      if (amount !== null && (Number.isNaN(amount) || amount < 0)) {
        fieldErrors["ebillCharge.amount"] = "The charge must be zero or more.";
      }
      if (c.enabled && !asDate(c.effectiveFrom)) {
        fieldErrors["ebillCharge.effectiveFrom"] = "Set the date the charge starts applying.";
      }
      config.ebillCharge = {
        enabled: Boolean(c.enabled),
        amountPaise: toPaise(
          amount === null ? toRupees(config.ebillCharge?.amountPaise || 0) : amount,
        ),
        effectiveFrom: asDate(c.effectiveFrom),
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
        severity: "WARNING",
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
 * GET /api/csd/billing/accounts/:restaurantId — would this account lock, and
 * why; and its plan: add-ons, tablets, credits, hardware, next renewal.
 *
 * Read-only. Deliberately does not APPLY the lock: an admin looking at a
 * restaurant should not be the thing that locks it.
 */
const getAccountStanding = async (req, res, next) => {
  try {
    const [assessment, subscription] = await Promise.all([
      assessAccount(req.params.restaurantId),
      statusFor(req.params.restaurantId),
    ]);
    res.status(200).json({
      success: true,
      data: { ...assessment, duesLabel: formatINR(assessment.duesPaise), subscription },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/csd/billing/accounts/:restaurantId/tablets/:serial/end — admin only.
 *
 * The tablet came back. It stops renewing at the current period end. The
 * restaurant cannot do this itself: the tablet is KnotKitchen's, and ending
 * the rental is the physical return.
 */
const endTabletRental = async (req, res, next) => {
  try {
    const { subscription, tablet } = await endTablet({
      restaurantId: req.params.restaurantId,
      serial: req.params.serial,
    });
    await csdAudit({
      req,
      staff: req.csdStaff,
      action: "BILLING.TABLET.END",
      resource: "PlatformSubscription",
      entityType: "PlatformSubscription",
      entityId: String(subscription._id),
      storeId: subscription.storeId || "",
      description: `Tablet #${tablet.serial} rental ends ${new Date(tablet.endsAt).toISOString()}`,
      newValue: { serial: tablet.serial, endsAt: tablet.endsAt },
      severity: "WARNING",
    });
    res.status(200).json({ success: true, data: { serial: tablet.serial, endsAt: tablet.endsAt } });
  } catch (err) {
    if (err instanceof SubscriptionError) return next(createHttpError(err.status, err.message));
    next(err);
  }
};

module.exports = {
  getBillingConfig,
  updateBillingConfig,
  getAccountStanding,
  endTabletRental,
  present,
  readCatalog,
};
