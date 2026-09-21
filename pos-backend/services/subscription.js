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

const { PlatformSubscription, PlatformInvoice, CommercialSchedule } = require("../models/platformSubscriptionModel");
const Restaurant = require("../models/restaurantModel");
const { getPlatformConfig, resolvePlanPrice, getOverride } = require("./pricing");
const { computeTax } = require("./tax");
const { debit, InsufficientBalanceError } = require("./ledger");
const { amountInWords, formatINR } = require("./money");
const { nextPeriod, upgradeCharge, isActiveAt, startOfIstDay } = require("./subscriptionPeriod");
const { nextInvoiceNumber } = require("./invoiceNumber");
const { fireEvaluateLock, evaluateLock } = require("./accountLock");
const {
  INSTALLATION_OPTIONS,
  installationOption,
  commitmentOption,
  applyDiscount,
  commitmentState,
  installationRefund,
  scheduleHash,
} = require("./commercialTerms");

// Awaited after a purchase, so the Billing page's refresh right after already
// sees the lock gone. Never allowed to fail the purchase it follows.
const settleLock = (restaurantId) =>
  evaluateLock(restaurantId).catch((err) => console.warn("[Subscription] lock re-evaluation failed:", err.message));

/** Agreement text the app's Commercial Schedule belongs to. */
const AGREEMENT_VERSION = "v2.0";

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
const quote = async ({ restaurantId, planCode, commitmentMonths = 0, on = new Date() }) => {
  const config = await getPlatformConfig();
  const subscription = await getSubscription(restaurantId);

  // purchasePlan goes through here, so a demo store can never be charged.
  if ((await getOverride(restaurantId))?.billingExempt) {
    throw new SubscriptionError("This is a demo store. It does not need a subscription and is never charged for one.", 409);
  }

  // Clause 5.4: the Installation Charge is paid before Activation.
  const installationRequired = !subscription.installation?.paidAt;

  const priced = await resolvePlanPrice({ restaurantId, planCode, on, config });
  if (!priced) throw new SubscriptionError("That plan is not available.", 404);
  if (!priced.plan.isAvailable && subscription.planCode !== planCode) {
    throw new SubscriptionError("That plan is not open for new subscriptions.", 400);
  }

  const active = isActiveAt(subscription, on);
  const isUpgrade = active && subscription.planCode && subscription.planCode !== planCode;

  // Never a downgrade. Once a restaurant has had a plan, that plan is its
  // floor: renew it or move up, whether it is still running or has ended.
  // (Mid-period, a cheaper plan also used to cost nothing and keep the paid-up
  // period -- a free refund of the difference.)
  if (subscription.planCode && subscription.planCode !== planCode) {
    const current = await resolvePlanPrice({ restaurantId, planCode: subscription.planCode, on, config });
    const currentPricePaise = current ? current.pricePaise : Number(subscription.lastPaidPricePaise) || 0;
    if (priced.pricePaise < currentPricePaise) {
      throw new SubscriptionError(
        `${priced.plan.name} is a lower plan than ${subscription.planName || "your plan"}. You can renew ${subscription.planName || "your plan"} or upgrade.`,
        409,
      );
    }
  }

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

  // Clause 6. A running commitment discounts every period (and upgrade) it
  // covers. A new one may be chosen only when none is running, and only on a
  // fresh period -- mid-period the discount would have nothing to attach to.
  const running = commitmentState(subscription.commitment);
  let commitment = null;
  if (running.running) {
    commitment = { ...running, isNew: false };
  } else if (Number(commitmentMonths) > 0) {
    const option = commitmentOption(commitmentMonths);
    if (!option) throw new SubscriptionError("Choose a 3, 6 or 12 month commitment.", 400);
    if (isUpgrade) {
      throw new SubscriptionError("A commitment starts with a new subscription period. Upgrade now and choose it at your next renewal, or renew with it.", 400);
    }
    commitment = {
      months: option.months,
      discountPercent: option.discountPercent,
      periodsTotal: option.months,
      periodsUsed: 0,
      periodsRemaining: option.months,
      running: true,
      isNew: true,
    };
  }
  const discount = applyDiscount(charge.amountPaise, commitment ? commitment.discountPercent : 0);

  const restaurant = await Restaurant.findById(restaurantId).select("address").lean();
  const tax = computeTax({
    amountPaise: discount.netPaise,
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
    // Before the commitment discount; `netChargePaise` is what tax is on.
    chargePaise: charge.amountPaise,
    chargeBasis: charge.basis,
    remainingDays: charge.remainingDays,
    commitment,
    discountPaise: discount.discountPaise,
    netChargePaise: discount.netPaise,
    installationRequired,
    // A new Schedule 1 is accepted for a first plan, a plan change or a new
    // commitment -- not for a plain renewal on the same terms.
    acceptanceRequired: installationRequired || !subscription.planCode || subscription.planCode !== planCode || Boolean(commitment?.isNew),
    agreementVersion: AGREEMENT_VERSION,
    tax,
    period,
    totalPaise: tax.totalPaise,
    totalLabel: formatINR(tax.totalPaise),
  };
};

/**
 * Record Schedule 1 as accepted. `acceptance` is what the route knows about
 * the person accepting; the values are what the app showed them.
 */
const recordSchedule = async ({ restaurantId, storeId, reason, values, acceptance }) => {
  const last = await CommercialSchedule.findOne({ restaurantId }).sort({ version: -1 }).select("version").lean();
  return CommercialSchedule.create({
    restaurantId,
    storeId,
    version: (last?.version || 0) + 1,
    agreementVersion: AGREEMENT_VERSION,
    reason,
    values,
    hash: scheduleHash(values),
    acceptedAt: new Date(),
    acceptedBy: {
      userId: acceptance?.user?._id || null,
      name: acceptance?.user?.name || "",
      role: acceptance?.user?.role || "",
    },
    ip: acceptance?.ip || "",
    userAgent: acceptance?.userAgent || "",
  });
};

const requireAcceptance = (acceptance) => {
  if (!acceptance?.accepted) {
    throw new SubscriptionError("Review the order summary and accept the terms to continue.", 409);
  }
};

/** Clause 5: pay the Installation Charge for the option chosen in the app. */
const purchaseInstallation = async ({ restaurantId, optionCode, on = new Date(), createdBy = null, acceptance }) => {
  const config = await getPlatformConfig();
  const subscription = await getSubscription(restaurantId);
  if ((await getOverride(restaurantId))?.billingExempt) {
    throw new SubscriptionError("This is a demo store. It is never charged.", 409);
  }
  if (subscription.installation?.paidAt) {
    throw new SubscriptionError("The Installation Charge has already been paid for this store.", 409);
  }
  const option = installationOption(optionCode);
  if (!option) throw new SubscriptionError("Choose an installation option.", 400);
  requireAcceptance(acceptance);

  const restaurant = await Restaurant.findById(restaurantId).select("address").lean();
  const tax = computeTax({ amountPaise: option.amountPaise, gst: config.gst, restaurantState: restaurant?.address?.state, on });
  const parties = await partiesFor(restaurantId, config);

  let entry;
  try {
    ({ entry } = await debit({
      restaurantId,
      kind: "SUBSCRIPTION",
      amountPaise: tax.totalPaise,
      description: `Installation Charge — ${option.name}`,
      refType: "PlatformSubscription",
      refId: subscription._id,
      meta: { installation: option.code },
      createdBy,
    }));
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      throw new SubscriptionError(
        `Not enough Business Balance. ${formatINR(tax.totalPaise)} is due and ${formatINR(err.availablePaise)} is available.`,
        402,
        { requiredPaise: tax.totalPaise, availablePaise: err.availablePaise },
      );
    }
    throw err;
  }

  const invoice = await issueInvoice({
    restaurantId,
    storeId: subscription.storeId,
    kind: "INSTALLATION",
    description: `Installation Charge — ${option.name} (one-time, refundable per Agreement clause 5.6)`,
    amountPaise: option.amountPaise,
    tax,
    config,
    parties,
    period: null,
    ledgerEntryId: entry._id,
  });

  subscription.installation = {
    optionCode: option.code,
    optionName: option.name,
    amountPaise: option.amountPaise,
    paidAt: new Date(),
    invoiceId: invoice._id,
    ledgerEntryId: entry._id,
  };
  await subscription.save();

  const schedule = await recordSchedule({
    restaurantId,
    storeId: subscription.storeId,
    reason: "INSTALLATION",
    values: {
      installation: { optionCode: option.code, optionName: option.name, amountPaise: option.amountPaise, equipment: option.equipment },
      gst: { applicable: tax.applicable, percent: tax.percent, mode: tax.mode, interState: tax.interState },
      totalPaise: tax.totalPaise,
    },
    acceptance,
  });

  return { subscription, invoice, schedule, charged: tax.totalPaise };
};

/**
 * Buy, renew or upgrade. One entry point, because they are the same
 * transaction with different period arithmetic, and splitting them into three
 * functions is how two of them drift.
 */
const purchasePlan = async ({ restaurantId, planCode, commitmentMonths = 0, on = new Date(), createdBy = null, acceptance = null }) => {
  const config = await getPlatformConfig();
  const subscription = await getSubscription(restaurantId);
  const q = await quote({ restaurantId, planCode, commitmentMonths, on });

  if (q.installationRequired) {
    throw new SubscriptionError("Choose and pay the Installation Charge before starting a subscription.", 409, { installationRequired: true });
  }
  if (q.acceptanceRequired) requireAcceptance(acceptance);

  // Clause 6: bookkeeping for the commitment this purchase is part of.
  const applyCommitment = () => {
    if (!q.commitment) return;
    if (q.commitment.isNew) {
      subscription.commitment = {
        months: q.commitment.months,
        discountPercent: q.commitment.discountPercent,
        periodsTotal: q.commitment.periodsTotal,
        periodsUsed: 0,
        startedAt: q.period.start,
        endsAt: null,
        completedAt: null,
        discountGrantedPaise: 0,
        lapsedAt: null,
        repaymentDuePaise: 0,
        repaidAt: null,
      };
    }
    subscription.commitment.discountGrantedPaise = (Number(subscription.commitment.discountGrantedPaise) || 0) + q.discountPaise;
    if (!q.isUpgrade) {
      subscription.commitment.periodsUsed = (Number(subscription.commitment.periodsUsed) || 0) + 1;
      subscription.commitment.endsAt = q.period.end;
      if (subscription.commitment.periodsUsed >= subscription.commitment.periodsTotal) {
        subscription.commitment.completedAt = new Date();
      }
    }
  };

  const snapshot = async (reason) => {
    if (!q.acceptanceRequired) return null;
    return recordSchedule({
      restaurantId,
      storeId: subscription.storeId,
      reason,
      values: {
        plan: { code: planCode, name: q.planName, listPricePaise: q.listPricePaise, priceSource: q.priceSource, billingDays: config.subscriptionDays },
        commitment: q.commitment
          ? { months: q.commitment.months, discountPercent: q.commitment.discountPercent, periodsTotal: q.commitment.periodsTotal }
          : null,
        installation: subscription.installation?.paidAt
          ? { optionCode: subscription.installation.optionCode, optionName: subscription.installation.optionName, amountPaise: subscription.installation.amountPaise }
          : null,
        charge: { grossPaise: q.chargePaise, discountPaise: q.discountPaise, netPaise: q.netChargePaise, basis: q.chargeBasis },
        gst: { applicable: q.tax.applicable, percent: q.tax.percent, mode: q.tax.mode, interState: q.tax.interState },
        totalPaise: q.totalPaise,
        period: { start: q.period.start, end: q.period.end },
      },
      acceptance,
    });
  };

  if (q.totalPaise <= 0) {
    // A same-price "upgrade", or a zero-priced plan. Move the plan across
    // without inventing a zero-value invoice for it.
    subscription.planCode = planCode;
    subscription.planName = q.planName;
    if (!q.isUpgrade) {
      subscription.currentPeriodStart = q.period.start;
      subscription.currentPeriodEnd = q.period.end;
    }
    subscription.status = "ACTIVE";
    if (!subscription.activatedAt) subscription.activatedAt = q.period.start;
    applyCommitment();
    await subscription.save();
    const schedule = await snapshot(q.isUpgrade ? "UPGRADE" : "SUBSCRIPTION");
    await settleLock(restaurantId); // a zero-priced first plan unlocks a new store too
    return { subscription, invoice: null, schedule, charged: 0 };
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
      meta: { planCode, basis: q.chargeBasis, commitmentMonths: q.commitment?.months || 0, discountPaise: q.discountPaise },
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

  // Clause 6.3: the discount is on the invoice, at the time of supply.
  const discountNote = q.commitment && q.discountPaise > 0
    ? ` — ${q.commitment.months}-month commitment discount ${q.commitment.discountPercent}% (${formatINR(q.discountPaise)}) applied`
    : "";
  const invoice = await issueInvoice({
    restaurantId,
    storeId: subscription.storeId,
    kind: q.isUpgrade ? "UPGRADE" : "SUBSCRIPTION",
    description: (q.isUpgrade
      ? `Upgrade to ${q.planName} (${q.remainingDays} days remaining)`
      : `${q.planName} plan — ${config.subscriptionDays} day${Number(config.subscriptionDays) === 1 ? "" : "s"}`) + discountNote,
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
  if (!subscription.activatedAt) subscription.activatedAt = q.period.start;
  applyCommitment();
  await subscription.save();

  const schedule = await snapshot(q.isUpgrade ? "UPGRADE" : q.commitment?.isNew ? "COMMITMENT" : "SUBSCRIPTION");

  // A first plan or a renewal may be what lifts a lock.
  await settleLock(restaurantId);

  return { subscription, invoice, schedule, charged: q.totalPaise };
};

/**
 * Clause 6.5 (discount-repayment model). A commitment lapses when a period it
 * covers ends and is not renewed within the grace period: the discount
 * received so far becomes due, and no further discount applies.
 * Idempotent; run by the lock sweep.
 */
const lapseCommitments = async (on = new Date()) => {
  const config = await getPlatformConfig();
  const graceMs = Math.max(0, Number(config.graceHours || 0)) * 3600 * 1000;
  const cutoff = new Date(new Date(on).getTime() - graceMs);
  const rows = await PlatformSubscription.find({
    "commitment.periodsTotal": { $gt: 0 },
    "commitment.lapsedAt": null,
    "commitment.completedAt": null,
    currentPeriodEnd: { $ne: null, $lt: cutoff },
  });
  let lapsed = 0;
  for (const s of rows) {
    if (!commitmentState(s.commitment).running) continue;
    s.commitment.lapsedAt = new Date();
    s.commitment.repaymentDuePaise = Number(s.commitment.discountGrantedPaise) || 0;
    await s.save();
    lapsed += 1;
    fireEvaluateLock(s.restaurantId);
  }
  return { lapsed };
};

/** Collect a lapsed commitment's discount repayment once the balance allows. */
const settleCommitmentRepayment = async (restaurantId, on = new Date()) => {
  const subscription = await PlatformSubscription.findOne({ restaurantId });
  const due = Number(subscription?.commitment?.repaymentDuePaise) || 0;
  if (!subscription || due <= 0) return { settled: false, duePaise: 0 };
  const config = await getPlatformConfig();
  const restaurant = await Restaurant.findById(restaurantId).select("address").lean();
  // The discount was taken off the taxable value, so its repayment is taxed the same way.
  const tax = computeTax({ amountPaise: due, gst: config.gst, restaurantState: restaurant?.address?.state, on });
  let entry;
  try {
    ({ entry } = await debit({
      restaurantId,
      kind: "SUBSCRIPTION",
      amountPaise: tax.totalPaise,
      description: `Commitment discount repayment (${subscription.commitment.months}-month commitment ended early)`,
      refType: "PlatformSubscription",
      refId: subscription._id,
      idempotencyKey: `commitment-repayment-${subscription._id}-${subscription.commitment.lapsedAt?.getTime() || 0}`,
    }));
  } catch (err) {
    if (err instanceof InsufficientBalanceError) return { settled: false, duePaise: tax.totalPaise };
    throw err;
  }
  const parties = await partiesFor(restaurantId, config);
  await issueInvoice({
    restaurantId,
    storeId: subscription.storeId,
    kind: "COMMITMENT_REPAYMENT",
    description: `Repayment of commitment discount received (${subscription.commitment.months}-month commitment ended early, Agreement clause 6.5)`,
    amountPaise: due,
    tax,
    config,
    parties,
    period: null,
    ledgerEntryId: entry._id,
  });
  subscription.commitment.repaymentDuePaise = 0;
  subscription.commitment.repaidAt = new Date();
  await subscription.save();
  return { settled: true, duePaise: tax.totalPaise };
};

/** Schedule 1 history, newest first. */
const listSchedules = (restaurantId) => CommercialSchedule.find({ restaurantId }).sort({ version: -1 }).lean();

/** Status as of now, without changing anything. */
const statusFor = async (restaurantId, on = new Date()) => {
  const config = await getPlatformConfig();
  const [subscription, override] = await Promise.all([
    getSubscription(restaurantId),
    getOverride(restaurantId),
  ]);
  const active = isActiveAt(subscription, on);

  const graceEnds = subscription.currentPeriodEnd
    ? new Date(
        new Date(subscription.currentPeriodEnd).getTime() +
          Math.max(0, Number(config.graceHours || 0)) * 3600 * 1000,
      )
    : null;

  const commitment = commitmentState(subscription.commitment);
  const installation = subscription.installation?.paidAt
    ? {
        optionCode: subscription.installation.optionCode,
        optionName: subscription.installation.optionName,
        amountPaise: subscription.installation.amountPaise,
        paidAt: subscription.installation.paidAt,
        // Clause 5.6, as if terminated today: what the restaurant would get back.
        refund: installationRefund({
          installationPaise: subscription.installation.amountPaise,
          activatedAt: subscription.activatedAt,
          terminatedAt: startOfIstDay(on),
        }),
      }
    : null;
  const latestSchedule = await CommercialSchedule.findOne({ restaurantId }).sort({ version: -1 }).select("version hash acceptedAt agreementVersion").lean();

  return {
    planCode: subscription.planCode,
    planName: subscription.planName,
    active,
    // Set by CSD: a demo store, never billed and never locked.
    exempt: Boolean(override?.billingExempt),
    activatedAt: subscription.activatedAt,
    installation,
    installationRequired: !override?.billingExempt && !subscription.installation?.paidAt,
    installationOptions: INSTALLATION_OPTIONS,
    commitment: {
      ...commitment,
      startedAt: subscription.commitment?.startedAt || null,
      endsAt: subscription.commitment?.endsAt || null,
      discountGrantedPaise: Number(subscription.commitment?.discountGrantedPaise) || 0,
    },
    schedule: latestSchedule,
    agreementVersion: AGREEMENT_VERSION,
    periodDays: config.subscriptionDays,
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
  purchaseInstallation,
  lapseCommitments,
  settleCommitmentRepayment,
  listSchedules,
  statusFor,
  issueInvoice,
  AGREEMENT_VERSION,
  SubscriptionError,
};
