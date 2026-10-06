const crypto = require("crypto");
const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const Restaurant = require("../models/restaurantModel");
const { getPlatformConfig } = require("../services/pricing");
const { assessAccount, evaluateLock } = require("../services/accountLock");
const {
  credit, debit, getBalance, findByIdempotencyKey, InsufficientBalanceError,
} = require("../services/ledger");
const { settlePendingCharges } = require("../services/orderCharge");
const {
  statusFor, endTablet, cancelSubscription, reinstateSubscription, SubscriptionError,
} = require("../services/subscription");
const { toPaise, toRupees, formatINR } = require("../services/money");
const { isValidGstin } = require("../services/gst");
const { csdAudit } = require("../services/csdAuditService");

/**
 * The admin panel's view of KnotKitchen's own pricing.
 *
 * This is the only place the POS plan, add-ons (and their periods), devices,
 * legacy tablet-rental prices, GST and the usage charges (platform fee per
 * source, e-bill) can be set. No restaurant-facing route writes any of it,
 * nor shows the usage charges -- that is the whole point
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

// The usage charges, all one shape: the platform fee per order source (website,
// table QR, Knot Eats), and the e-bill.
const USAGE_CHARGES = ["websiteOrderCharge", "qrOrderCharge", "knotEatsOrderCharge", "ebillCharge"];

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
    // null rides the POS period; a number is its own (365 = yearly).
    periodDays: a.periodDays ?? null,
    feature: a.feature || "",
    isActive: a.isActive !== false,
    sortOrder: a.sortOrder || 0,
  })),
  // What tablets rented before tablets were sold renew at.
  tablet: {
    firstPrice: toRupees(config.tablet?.firstPricePaise || 0),
    extraPrice: toRupees(config.tablet?.extraPricePaise || 0),
  },
  // Devices (the tablet and printers): one-time, GST-inclusive.
  printers: (config.printers || []).map((p) => ({
    code: p.code,
    name: p.name,
    price: toRupees(p.pricePaise),
    priceLabel: formatINR(p.pricePaise),
    isActive: p.isActive !== false,
  })),
  firstRechargeMin: toRupees(config.firstRechargeMinPaise || 0),
  topUpMin: toRupees(config.topUpMinPaise || 0),
  gst: {
    registered: config.gst?.registered || false,
    gstin: config.gst?.gstin || "",
    effectiveFrom: config.gst?.effectiveFrom || null,
    percent: config.gst?.percent || 0,
    placeOfSupplyState: config.gst?.placeOfSupplyState || "",
    legalName: config.gst?.legalName || "",
    addressLines: config.gst?.addressLines || [],
  },
  ...Object.fromEntries(
    USAGE_CHARGES.map((key) => [
      key,
      {
        enabled: config[key]?.enabled || false,
        amount: toRupees(config[key]?.amountPaise || 0),
        effectiveFrom: config[key]?.effectiveFrom || null,
        taxable: config[key]?.taxable !== false,
      },
    ]),
  ),
  subscriptionDays: config.subscriptionDays,
  graceHours: config.graceHours,
  renewalPolicy: config.renewalPolicy,
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
 * saying which list it is in. `current` is the list saved now.
 */
const readCatalog = (input, field, fieldErrors, seen, { addons = false, current = [] } = {}) => {
  if (!Array.isArray(input)) {
    fieldErrors[field] = "Must be a list.";
    return null;
  }
  const items = input.map((raw, i) => {
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
    // Blank rides the POS period; otherwise its own, in whole days. Left out
    // (a CSD page loaded before periods existed) keeps the saved one, so a
    // save from it never turns the yearly Website monthly.
    const saved = current.find((a) => a.code === code);
    const periodDays = raw?.periodDays === undefined ? (saved?.periodDays ?? null) : num(raw.periodDays);
    if (periodDays !== null && !(Number.isInteger(periodDays) && periodDays >= 1 && periodDays <= 366)) {
      fieldErrors[`${field}.${i}.periodDays`] = "Use whole days from 1 to 366, or leave it blank for the POS period.";
    } else if (saved && (saved.periodDays ?? null) !== periodDays) {
      // Fixed once saved, like the code: stores already on the add-on, and
      // their negotiated prices, were agreed for that period. A different
      // period is a new add-on.
      fieldErrors[`${field}.${i}.periodDays`] = "The billing period can't change once saved. Add a new add-on for a different period.";
    }
    return {
      ...item,
      description: String(raw?.description || "").trim().slice(0, 300),
      periodDays,
      feature,
      sortOrder: Number(raw?.sortOrder) || 0,
    };
  });
  // Stores' add-ons, devices and negotiated prices point at a saved code. A
  // dropped add-on would keep renewing where the store can no longer see it,
  // so a saved row can go off sale but never leave the list.
  for (const { code } of current) {
    if (!items.some((x) => x.code === code)) {
      fieldErrors[field] = `"${code}" is saved: take it off sale instead of removing it.`;
    }
  }
  return items;
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
      ? readCatalog(body.addons, "addons", fieldErrors, seen, { addons: true, current: config.addons || [] })
      : null;
    if (body.addons === undefined) (config.addons || []).forEach((x) => seen.add(x.code));
    const printers = body.printers !== undefined
      ? readCatalog(body.printers, "printers", fieldErrors, seen, { current: config.printers || [] })
      : null;
    if (body.addons !== undefined && body.printers === undefined) {
      for (const x of config.printers || []) {
        if (seen.has(x.code)) fieldErrors.addons = `The code "${x.code}" is already a device.`;
      }
    }
    if (addons) config.addons = addons;
    if (printers) config.printers = printers;

    // Legacy rental prices: what tablets already rented renew at.
    if (body.tablet !== undefined) {
      const t = body.tablet || {};
      config.tablet = {
        firstPricePaise: readPrice(t.firstPrice, "tablet.firstPrice", fieldErrors),
        extraPricePaise: readPrice(t.extraPrice, "tablet.extraPrice", fieldErrors),
      };
    }

    if (body.firstRechargeMin !== undefined) {
      config.firstRechargeMinPaise = readPrice(body.firstRechargeMin, "firstRechargeMin", fieldErrors);
    }
    // Left out (a CSD page from before it existed) keeps the saved one.
    if (body.topUpMin !== undefined) config.topUpMinPaise = readPrice(body.topUpMin, "topUpMin", fieldErrors);

    if (body.gst !== undefined) {
      const g = body.gst || {};
      const percent = num(g.percent);
      if (percent !== null && (Number.isNaN(percent) || percent < 0 || percent > 100)) {
        fieldErrors["gst.percent"] = "GST percentage must be between 0 and 100.";
      } else if (g.registered && !((percent ?? config.gst?.percent) > 0)) {
        // Registered at 0% charges nothing yet prints a tax invoice.
        fieldErrors["gst.percent"] = "Set the GST rate, or leave Registered off.";
      }
      // Registered with no start date would tax nothing and look broken.
      if (g.registered && !asDate(g.effectiveFrom)) {
        fieldErrors["gst.effectiveFrom"] =
          "Set the date GST starts applying, or leave Registered off.";
      }
      // GST is charged once registered, but the invoice reads "registered"
      // from the GSTIN: without one it charges GST and says none was charged.
      if (g.registered && !isValidGstin(g.gstin)) {
        fieldErrors["gst.gstin"] = "Enter KnotKitchen's 15-character GSTIN, or leave Registered off.";
      }
      config.gst = {
        registered: Boolean(g.registered),
        gstin: String(g.gstin || "").trim().toUpperCase(),
        effectiveFrom: asDate(g.effectiveFrom),
        percent: percent === null ? config.gst?.percent || 0 : percent,
        // Not editable. Everything but printers is taxed on top and printers
        // are GST-inclusive, whatever this says (every computeTax caller
        // passes its mode); kept only so old rows stay valid.
        mode: "exclusive",
        placeOfSupplyState: String(g.placeOfSupplyState || "").trim(),
        legalName: String(g.legalName || "").trim(),
        // One line per row; a textarea's text is split the same way. Left
        // out, the address already saved stays.
        addressLines: g.addressLines === undefined
          ? config.gst?.addressLines || []
          : (Array.isArray(g.addressLines) ? g.addressLines : String(g.addressLines || "").split("\n"))
            .map((l) => String(l).trim().slice(0, 200))
            .filter(Boolean)
            .slice(0, 6),
      };
    }

    // The platform fee (website, table QR, Knot Eats) and the e-bill charge: an amount
    // (left out keeps the saved one), a start date it needs to be on, and GST.
    for (const key of USAGE_CHARGES) {
      if (body[key] === undefined) continue;
      const c = body[key] || {};
      const amount = num(c.amount);
      if (amount !== null && (Number.isNaN(amount) || amount < 0)) {
        fieldErrors[`${key}.amount`] = "The charge must be zero or more.";
      }
      if (c.enabled && !asDate(c.effectiveFrom)) {
        fieldErrors[`${key}.effectiveFrom`] = "Set the date the charge starts applying.";
      }
      config[key] = {
        enabled: Boolean(c.enabled),
        amountPaise: toPaise(amount === null ? toRupees(config[key]?.amountPaise || 0) : amount),
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

    if (body.renewalPolicy !== undefined) {
      // FROM_EXPIRY backdates a late renewal, which the agreement (6.4) forbids.
      const allowed = ["FROM_PAYMENT"];
      if (!allowed.includes(body.renewalPolicy)) fieldErrors.renewalPolicy = "Renewal always starts from the payment (FROM_PAYMENT).";
      else config.renewalPolicy = body.renewalPolicy;
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
 * why; and its plan: add-ons (with their own renewals), rented tablets,
 * devices, next renewal.
 *
 * Read-only. Deliberately does not APPLY the lock: an admin looking at a
 * restaurant should not be the thing that locks it.
 */
const accountStanding = async (restaurantId) => {
  const [assessment, subscription] = await Promise.all([assessAccount(restaurantId), statusFor(restaurantId)]);
  return { ...assessment, duesLabel: formatINR(assessment.duesPaise), subscription };
};

const getAccountStanding = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await accountStanding(req.params.restaurantId) });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/csd/billing/accounts/:restaurantId/subscription/cancel { reason }
 * POST /api/csd/billing/accounts/:restaurantId/subscription/reinstate
 * Admin only, audited. Recording a restaurant's cancellation (a written
 * notice, say), or undoing one -- after it took effect too, which reopens a
 * store the cancellation closed. Both answer with the account standing.
 */
const changeSubscription = (action) => async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    if (!mongoose.isValidObjectId(restaurantId) || !(await Restaurant.exists({ _id: restaurantId }))) {
      return next(createHttpError(404, "Restaurant not found."));
    }
    const reason = String(req.body?.reason || "").trim();
    if (action === "cancel" && (reason.length < 3 || reason.length > 300)) {
      return next(createHttpError(400, "Give the reason (3 to 300 characters).", { fieldErrors: { reason: "3 to 300 characters." } }));
    }
    const by = { type: "CSD", name: req.csdStaff?.fullName || "" };
    const before = await statusFor(restaurantId);
    const { subscription, already } = action === "cancel"
      ? await cancelSubscription({ restaurantId, reason, by })
      : await reinstateSubscription({ restaurantId, by });

    if (!already) {
      await csdAudit({
        req,
        staff: req.csdStaff,
        action: action === "cancel" ? "BILLING.SUBSCRIPTION.CANCEL" : "BILLING.SUBSCRIPTION.REINSTATE",
        resource: "PlatformSubscription",
        entityType: "PlatformSubscription",
        entityId: String(subscription._id),
        storeId: subscription.storeId || "",
        description: action === "cancel"
          ? `POS subscription cancelled, effective ${new Date(subscription.cancelAt).toISOString()}: ${reason}`
          : "POS subscription cancellation undone",
        previousValue: { status: before.status, cancelAt: before.cancelAt, cancelReason: before.cancelReason },
        newValue: { status: subscription.status, cancelAt: subscription.cancelAt || null, cancelReason: subscription.cancelReason || "" },
        severity: "WARNING",
      });
    }
    res.status(200).json({ success: true, data: await accountStanding(restaurantId) });
  } catch (err) {
    if (err instanceof SubscriptionError) return next(createHttpError(err.status, err.message, { code: err.code }));
    next(err);
  }
};

/**
 * POST /api/csd/billing/accounts/:restaurantId/wallet/adjust — admin only, audited.
 * { direction: "CREDIT"|"DEBIT", amount (rupees), reason, reference?, idempotencyKey? }
 *
 * A manual Wallet movement: a rented tablet lost or damaged (at actual cost),
 * an erroneous charge put back, a permitted refund paid out by bank transfer
 * (a DEBIT whose reference is the UTR). Through the ledger only, and never
 * through afterRecharge: a credit is not a top-up, so it never starts the plan.
 *
 * Idempotent on the client's key, else on the same movement (direction,
 * amount, reason, reference) repeated within a minute -- a double-clicked
 * button must not debit twice.
 */
const ADJUST_WINDOW_MS = 60 * 1000;

const adjustWallet = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    if (!mongoose.isValidObjectId(restaurantId) || !(await Restaurant.exists({ _id: restaurantId }))) {
      return next(createHttpError(404, "Restaurant not found."));
    }
    const body = req.body || {};
    const direction = String(body.direction || "").trim().toUpperCase();
    const amount = num(body.amount);
    const amountPaise = amount === null || Number.isNaN(amount) ? 0 : toPaise(amount);
    const reason = String(body.reason || "").trim();
    const reference = String(body.reference || "").trim();
    const clientKey = String(body.idempotencyKey || "").trim();

    const fieldErrors = {};
    if (!["CREDIT", "DEBIT"].includes(direction)) fieldErrors.direction = "Choose CREDIT or DEBIT.";
    if (!(amountPaise > 0)) fieldErrors.amount = "Enter an amount greater than zero.";
    if (reason.length < 3 || reason.length > 300) fieldErrors.reason = "3 to 300 characters.";
    if (reference.length > 100) fieldErrors.reference = "At most 100 characters.";
    if (clientKey.length > 100) fieldErrors.idempotencyKey = "At most 100 characters.";
    const reject = () => next(createHttpError(400, "Please correct the highlighted fields.", { fieldErrors }));
    if (Object.keys(fieldErrors).length) return reject();

    const replay = async () =>
      res.status(200).json({ success: true, duplicate: true, data: await accountStanding(restaurantId) });
    const now = Date.now();
    let idempotencyKey;
    if (clientKey) {
      idempotencyKey = `csd-adjust-${restaurantId}-${clientKey}`;
      if (await findByIdempotencyKey(idempotencyKey)) return replay();
    } else {
      const fingerprint = crypto
        .createHash("sha256")
        .update([restaurantId, direction, amountPaise, reason, reference].join("|"))
        .digest("hex")
        .slice(0, 32);
      const bucket = Math.floor(now / ADJUST_WINDOW_MS);
      idempotencyKey = `csd-adjust-${fingerprint}-${bucket}`;
      // The key holds one clock minute; the previous minute's key catches a
      // repeat that straddles the boundary.
      const recent = (await findByIdempotencyKey(idempotencyKey))
        || (await findByIdempotencyKey(`csd-adjust-${fingerprint}-${bucket - 1}`));
      if (recent && now - new Date(recent.createdAt).getTime() < ADJUST_WINDOW_MS) return replay();
    }

    const before = (await getBalance(restaurantId)).balancePaise;
    if (direction === "DEBIT" && amountPaise > before) {
      fieldErrors.amount = `A debit cannot be more than the Wallet balance (${formatINR(before)}).`;
      return reject();
    }

    const staffName = req.csdStaff ? `${req.csdStaff.staffId || ""} ${req.csdStaff.fullName || ""}`.trim() : "";
    let moved;
    try {
      moved = await (direction === "CREDIT" ? credit : debit)({
        restaurantId,
        kind: direction === "CREDIT" ? "ADJUSTMENT_CREDIT" : "ADJUSTMENT_DEBIT",
        amountPaise,
        description: `Adjustment by KnotKitchen: ${reason}${reference ? ` (ref ${reference})` : ""}`,
        idempotencyKey,
        refType: "CsdAdjustment",
        meta: { reason, reference, by: staffName, staffId: req.csdStaff?._id ? String(req.csdStaff._id) : "" },
      });
    } catch (err) {
      if (!(err instanceof InsufficientBalanceError)) throw err;
      fieldErrors.amount = `A debit cannot be more than the Wallet balance (${formatINR(err.availablePaise)}).`;
      return reject();
    }

    if (!moved.duplicate) {
      await csdAudit({
        req,
        staff: req.csdStaff,
        action: direction === "CREDIT" ? "BILLING.WALLET.CREDIT" : "BILLING.WALLET.DEBIT",
        resource: "BusinessBalance",
        entityType: "LedgerEntry",
        entityId: String(moved.entry?._id || ""),
        description: `Wallet ${direction.toLowerCase()} of ${formatINR(amountPaise)}: ${reason}${reference ? ` (ref ${reference})` : ""}`,
        previousValue: { balancePaise: before },
        newValue: { balancePaise: moved.entry?.balanceAfterPaise, direction, amountPaise, reason, reference },
        severity: "WARNING",
      });

      // Money in collects dues and can lift a lock, as a hardware refund
      // does; money out can start the grace period. Never fails the request.
      try {
        if (direction === "CREDIT") await settlePendingCharges(restaurantId);
        await evaluateLock(restaurantId);
      } catch (err) {
        console.warn("[csd-billing] settling after adjustment failed:", err.message);
      }
    }

    res.status(200).json({ success: true, duplicate: Boolean(moved.duplicate), data: await accountStanding(restaurantId) });
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
  adjustWallet,
  cancelAccountSubscription: changeSubscription("cancel"),
  reinstateAccountSubscription: changeSubscription("reinstate"),
  present,
  readCatalog,
};
