/**
 * Buying, renewing and upgrading a KnotKitchen plan.
 *
 * Paid from the Business Balance, never from a card at this step -- the
 * gateway's only job is topping the balance up. That keeps one money path:
 * everything KnotKitchen charges is a ledger debit, and the ledger is the only
 * thing that can move a balance.
 *
 * Order of operations is deliberate. The balance is debited FIRST, and the
 * invoice is issued only once the money has actually moved. Issuing first
 * would leave an invoice for a payment that failed for want of funds -- a
 * document that says PAID against nothing.
 */

const { PlatformSubscription, PlatformInvoice } = require("../models/platformSubscriptionModel");
const Restaurant = require("../models/restaurantModel");
const { getPlatformConfig, resolvePlanPrice } = require("./pricing");
const { computeTax } = require("./tax");
const { debit, InsufficientBalanceError } = require("./ledger");
const { amountInWords, formatINR } = require("./money");
const { nextPeriod, upgradeCharge, isActiveAt, startOfIstDay } = require("./subscriptionPeriod");
const { nextInvoiceNumber } = require("./invoiceNumber");

class SubscriptionError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.name = "SubscriptionError";
    this.status = status;
    Object.assign(this, extra);
  }
}

const getSubscription = async (restaurantId) => {
  const existing = await PlatformSubscription.findOne({ restaurantId });
  if (existing) return existing;
  const restaurant = await Restaurant.findById(restaurantId).select("storeId").lean();
  return PlatformSubscription.create({ restaurantId, storeId: restaurant?.storeId || "" });
};

/** Both parties, frozen as they are today. */
const partiesFor = async (restaurantId, config) => {
  const restaurant = await Restaurant.findById(restaurantId)
    .select("name storeName storeId address gstin ownerPhone phone ownerEmail email")
    .lean();

  const gst = config.gst || {};
  return {
    restaurant,
    seller: {
      name: gst.legalName || "KnotKitchen",
      gstin: gst.gstin || "",
      addressLines: gst.addressLines || [],
      state: gst.placeOfSupplyState || "",
    },
    buyer: {
      name: restaurant?.storeName || restaurant?.name || "",
      gstin: restaurant?.gstin || "",
      addressLines: [restaurant?.address?.line1, restaurant?.address?.line2, restaurant?.address?.city]
        .filter(Boolean),
      state: restaurant?.address?.state || "",
      phone: restaurant?.ownerPhone || restaurant?.phone || "",
      email: restaurant?.ownerEmail || restaurant?.email || "",
    },
  };
};

/**
 * Write the invoice.
 *
 * Everything is copied in. Nothing on it is a reference to a price that can
 * later move, which is what makes "old invoices never change" true rather than
 * merely intended.
 */
const issueInvoice = async ({
  restaurantId,
  storeId,
  kind,
  description,
  amountPaise,
  tax,
  config,
  parties,
  period,
  ledgerEntryId,
}) => {
  const invoiceNumber = await nextInvoiceNumber(storeId);
  const half = tax.percent / 2;

  const line = {
    serial: 1,
    description,
    amountPaise,
    taxableValuePaise: tax.taxablePaise,
    cgstRate: tax.interState ? 0 : half,
    cgstPaise: tax.cgstPaise,
    sgstRate: tax.interState ? 0 : half,
    sgstPaise: tax.sgstPaise,
    igstRate: tax.interState ? tax.percent : 0,
    igstPaise: tax.igstPaise,
    totalPaise: tax.totalPaise,
  };

  return PlatformInvoice.create({
    invoiceNumber,
    invoiceDate: new Date(),
    restaurantId,
    storeId,
    kind,
    seller: parties.seller,
    buyer: parties.buyer,
    lines: [line],
    subtotalPaise: tax.taxablePaise,
    cgstPaise: tax.cgstPaise,
    sgstPaise: tax.sgstPaise,
    igstPaise: tax.igstPaise,
    totalTaxPaise: tax.totalTaxPaise,
    totalPaise: tax.totalPaise,
    totalInWords: amountInWords(tax.totalPaise),
    placeOfSupply: parties.buyer.state || config.gst?.placeOfSupplyState || "",
    interState: tax.interState,
    status: "PAID",
    paidAt: new Date(),
    ledgerEntryId,
    periodStart: period?.start || null,
    periodEnd: period?.end || null,
  });
};

/** What buying `planCode` would cost right now, without buying it. */
const quote = async ({ restaurantId, planCode, on = new Date() }) => {
  const config = await getPlatformConfig();
  const subscription = await getSubscription(restaurantId);

  const priced = await resolvePlanPrice({ restaurantId, planCode, on, config });
  if (!priced) throw new SubscriptionError("That plan is not available.", 404);
  if (!priced.plan.isAvailable && subscription.planCode !== planCode) {
    throw new SubscriptionError("That plan is not open for new subscriptions.", 400);
  }

  const active = isActiveAt(subscription, on);
  const isUpgrade = active && subscription.planCode && subscription.planCode !== planCode;

  // An upgrade mid-period is charged on the difference for the days that
  // remain; anything else is the full price of a fresh period.
  const charge = isUpgrade
    ? upgradeCharge({
        currentPricePaise: subscription.lastPaidPricePaise,
        newPricePaise: priced.pricePaise,
        subscription,
        days: config.subscriptionDays,
        policy: config.upgradePolicy,
        on,
      })
    : { amountPaise: priced.pricePaise, remainingDays: null, basis: "FULL" };

  const restaurant = await Restaurant.findById(restaurantId).select("address").lean();
  const tax = computeTax({
    amountPaise: charge.amountPaise,
    gst: config.gst,
    restaurantState: restaurant?.address?.state,
    on,
  });

  const period = isUpgrade
    ? { start: subscription.currentPeriodStart, end: subscription.currentPeriodEnd, lapsedDays: 0 }
    : nextPeriod({
        subscription,
        days: config.subscriptionDays,
        policy: config.renewalPolicy,
        on,
      });

  return {
    planCode,
    planName: priced.plan.name,
    isUpgrade,
    priceSource: priced.source,
    listPricePaise: priced.pricePaise,
    chargePaise: charge.amountPaise,
    chargeBasis: charge.basis,
    remainingDays: charge.remainingDays,
    tax,
    period,
    totalPaise: tax.totalPaise,
    totalLabel: formatINR(tax.totalPaise),
  };
};

/**
 * Buy, renew or upgrade. One entry point, because they are the same
 * transaction with different period arithmetic, and splitting them into three
 * functions is how two of them drift.
 */
const purchasePlan = async ({ restaurantId, planCode, on = new Date(), createdBy = null }) => {
  const config = await getPlatformConfig();
  const subscription = await getSubscription(restaurantId);
  const q = await quote({ restaurantId, planCode, on });

  if (q.chargePaise <= 0) {
    // A same-price "upgrade", or a zero-priced plan. Move the plan across
    // without inventing a zero-value invoice for it.
    subscription.planCode = planCode;
    subscription.planName = q.planName;
    if (!q.isUpgrade) {
      subscription.currentPeriodStart = q.period.start;
      subscription.currentPeriodEnd = q.period.end;
    }
    subscription.status = "ACTIVE";
    await subscription.save();
    return { subscription, invoice: null, charged: 0 };
  }

  const parties = await partiesFor(restaurantId, config);

  // Money first. An invoice issued before the debit would document a payment
  // that may never happen.
  let entry;
  try {
    ({ entry } = await debit({
      restaurantId,
      kind: "SUBSCRIPTION",
      amountPaise: q.totalPaise,
      description: q.isUpgrade
        ? `Upgrade to ${q.planName}`
        : `${q.planName} subscription`,
      refType: "PlatformSubscription",
      refId: subscription._id,
      meta: { planCode, basis: q.chargeBasis },
      createdBy,
    }));
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      throw new SubscriptionError(
        `Not enough Business Balance. ${formatINR(q.totalPaise)} is due and ${formatINR(err.availablePaise)} is available.`,
        402,
        { requiredPaise: q.totalPaise, availablePaise: err.availablePaise },
      );
    }
    throw err;
  }

  const invoice = await issueInvoice({
    restaurantId,
    storeId: subscription.storeId,
    kind: q.isUpgrade ? "UPGRADE" : "SUBSCRIPTION",
    description: q.isUpgrade
      ? `Upgrade to ${q.planName} (${q.remainingDays} days remaining)`
      : `${q.planName} plan — 30 days`,
    amountPaise: q.chargePaise,
    tax: q.tax,
    config,
    parties,
    period: q.period,
    ledgerEntryId: entry._id,
  });

  subscription.planCode = planCode;
  subscription.planName = q.planName;
  subscription.status = "ACTIVE";
  subscription.currentPeriodStart = q.period.start;
  subscription.currentPeriodEnd = q.period.end;
  subscription.lastPaidPricePaise = q.listPricePaise;
  subscription.lastInvoiceId = invoice._id;
  subscription.lastPaidAt = new Date();
  await subscription.save();

  return { subscription, invoice, charged: q.totalPaise };
};

/** Status as of now, without changing anything. */
const statusFor = async (restaurantId, on = new Date()) => {
  const config = await getPlatformConfig();
  const subscription = await getSubscription(restaurantId);
  const active = isActiveAt(subscription, on);

  const graceEnds = subscription.currentPeriodEnd
    ? new Date(
        new Date(subscription.currentPeriodEnd).getTime() +
          Math.max(0, Number(config.graceHours || 0)) * 3600 * 1000,
      )
    : null;

  return {
    planCode: subscription.planCode,
    planName: subscription.planName,
    active,
    inGrace: !active && Boolean(graceEnds) && new Date(on) < graceEnds,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    graceEndsAt: graceEnds,
    lastPaidPricePaise: subscription.lastPaidPricePaise,
    today: startOfIstDay(on),
  };
};

module.exports = {
  getSubscription,
  quote,
  purchasePlan,
  statusFor,
  issueInvoice,
  SubscriptionError,
};
