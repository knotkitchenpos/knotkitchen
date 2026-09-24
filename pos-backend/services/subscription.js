/**
 * The POS plan, its add-ons, tablets and printers: activating, buying and
 * renewing them.
 *
 * Paid from the Business Balance (the wallet), never from a card at this
 * step -- the gateway's only job is topping the wallet up. That keeps one
 * money path: everything KnotKitchen charges is a ledger debit, and the
 * ledger is the only thing that can move a balance.
 *
 * The life of a store:
 *   1. created: status NONE, and locked ("No plan is active yet").
 *   2. one top-up of at least firstRechargeMinPaise starts the POS plan by
 *      itself (afterRecharge): the plan price + GST is debited, the period
 *      starts today, the rest stays in the wallet.
 *   3. add-ons and tablets bought mid-period pay for the days left; a
 *      printer is paid once.
 *   4. at the period end the plan, add-ons and tablets renew in one invoice,
 *      all or nothing (renewDue). Short -> EXPIRED; the next top-up renews.
 *
 * Order of operations is deliberate. The balance is debited FIRST, and the
 * invoice is issued only once the money has actually moved. Issuing first
 * would leave an invoice for a payment that failed for want of funds -- a
 * document that says PAID against nothing. Every debit carries an
 * idempotency key, so a repeated request never charges twice.
 */

const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { PlatformSubscription, PlatformInvoice, CommercialSchedule } = require("../models/platformSubscriptionModel");
const { BusinessBalance } = require("../models/businessBalanceModel");
const Restaurant = require("../models/restaurantModel");
const { getPlatformConfig, getOverride, priceFor } = require("./pricing");
const { computeTax } = require("./tax");
const { debit, InsufficientBalanceError } = require("./ledger");
const { amountInWords, formatINR, asAmount } = require("./money");
const { nextPeriod, isActiveAt, prorate } = require("./subscriptionPeriod");
const { nextInvoiceNumber } = require("./invoiceNumber");
const { evaluateLock } = require("./accountLock");
const { featuresFor } = require("./planFeatures");
const { openRequest, defaultShipTo } = require("./hardwareRequests");

// Awaited after every money movement, so the Billing page's refresh right
// after already sees the lock gone. Never allowed to fail what it follows.
const settleLock = (restaurantId) =>
  evaluateLock(restaurantId).catch((err) => console.warn("[Subscription] lock re-evaluation failed:", err.message));

/** Agreement text the accepted purchase records belong to. */
const AGREEMENT_VERSION = "v2.0";

const DEMO_STORE = "This is a demo store. It has every add-on and is never charged.";
const RENEW_FIRST = "Renew the POS plan first (top up the wallet).";

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

/** Everything a charge needs, read once. */
const load = async (restaurantId) => {
  const [config, subscription, override, restaurant] = await Promise.all([
    getPlatformConfig(),
    getSubscription(restaurantId),
    getOverride(restaurantId),
    Restaurant.findById(restaurantId).select("address name ownerName ownerPhone contactPersonPhone restaurantPhone").lean(),
  ]);
  return { config, subscription, override, restaurant, exempt: Boolean(override?.billingExempt) };
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

const iso = (d) => new Date(d).toISOString();
const istDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
const span = (config) => `${config.subscriptionDays} day${Number(config.subscriptionDays) === 1 ? "" : "s"}`;
const liveAt = (item, on) => !item.endsAt || new Date(item.endsAt) > new Date(on);

/** GST on each line by itself (as configured), and the totals. */
const priceLines = (lines, { config, restaurant, on }) => {
  const taxed = lines.map((l) => ({
    ...l,
    tax: computeTax({ amountPaise: l.amountPaise, gst: config.gst, restaurantState: restaurant?.address?.state, on }),
  }));
  const sum = (k) => taxed.reduce((t, l) => t + l.tax[k], 0);
  return { lines: taxed, subtotalPaise: sum("taxablePaise"), taxPaise: sum("totalTaxPaise"), totalPaise: sum("totalPaise") };
};

/** A bill as the API sends it. */
const billView = (bill) => ({
  lines: bill.lines.map((l) => ({
    description: l.description,
    amount: asAmount(l.amountPaise),
    tax: asAmount(l.tax.totalTaxPaise),
    total: asAmount(l.tax.totalPaise),
  })),
  subtotal: asAmount(bill.subtotalPaise),
  tax: asAmount(bill.taxPaise),
  total: asAmount(bill.totalPaise),
});

/**
 * Write the invoice, one line per item.
 *
 * Everything is copied in. Nothing on it is a reference to a price that can
 * later move, which is what makes "old invoices never change" true rather than
 * merely intended.
 */
const issueInvoice = async ({ _id, restaurantId, storeId, kind, lines, config, parties, period, ledgerEntryId }) => {
  const invoiceNumber = await nextInvoiceNumber(storeId);
  const sum = (k) => lines.reduce((t, l) => t + l.tax[k], 0);
  const totalPaise = sum("totalPaise");

  return PlatformInvoice.create({
    ...(_id ? { _id } : {}),
    invoiceNumber,
    invoiceDate: new Date(),
    restaurantId,
    storeId,
    kind,
    seller: parties.seller,
    buyer: parties.buyer,
    lines: lines.map(({ description, amountPaise, tax }, i) => {
      const half = tax.percent / 2;
      return {
        serial: i + 1,
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
    }),
    subtotalPaise: sum("taxablePaise"),
    cgstPaise: sum("cgstPaise"),
    sgstPaise: sum("sgstPaise"),
    igstPaise: sum("igstPaise"),
    totalTaxPaise: sum("totalTaxPaise"),
    totalPaise,
    totalInWords: amountInWords(totalPaise),
    placeOfSupply: parties.buyer.state || config.gst?.placeOfSupplyState || "",
    interState: lines.some((l) => l.tax.interState),
    status: "PAID",
    paidAt: new Date(),
    ledgerEntryId,
    periodStart: period?.start || null,
    periodEnd: period?.end || null,
  });
};

/**
 * Debit the wallet for `bill`, then issue its invoice. `duplicate` means the
 * idempotency key was already spent -- a repeated request -- and nothing was
 * charged or issued this time. Short of money: 402 with the shortfall.
 */
const charge = async ({ subscription, bill, kind, ledgerKind = "SUBSCRIPTION", description, idempotencyKey, config, period = null, createdBy = null, meta = {} }) => {
  if (bill.totalPaise <= 0) return { invoice: null, duplicate: false, charged: 0 };
  let entry;
  let duplicate;
  try {
    ({ entry, duplicate } = await debit({
      restaurantId: subscription.restaurantId,
      kind: ledgerKind,
      amountPaise: bill.totalPaise,
      description,
      refType: "PlatformSubscription",
      refId: subscription._id,
      meta,
      idempotencyKey,
      createdBy,
    }));
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      throw new SubscriptionError(
        `Top up the wallet: you need ${formatINR(bill.totalPaise - err.availablePaise)} more.`,
        402,
        { code: "INSUFFICIENT_BALANCE", requiredPaise: bill.totalPaise, availablePaise: err.availablePaise },
      );
    }
    throw err;
  }
  if (duplicate) return { invoice: null, duplicate: true, charged: 0 };

  // ponytail: a crash between the debit above and this invoice leaves a paid charge with no invoice; fix by hand.
  const invoice = await issueInvoice({
    restaurantId: subscription.restaurantId,
    storeId: subscription.storeId,
    kind,
    lines: bill.lines,
    config,
    parties: await partiesFor(subscription.restaurantId, config),
    period,
    ledgerEntryId: entry._id,
  });
  return { invoice, duplicate: false, charged: bill.totalPaise };
};

/**
 * The fingerprint of what was accepted. Keys are sorted so the same values
 * always hash the same, whatever order they were assembled in.
 */
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        if (value[k] !== undefined) acc[k] = canonical(value[k]);
        return acc;
      }, {});
  }
  return value instanceof Date ? value.toISOString() : value;
};

const scheduleHash = (values) =>
  crypto.createHash("sha256").update(JSON.stringify(canonical(values))).digest("hex");

/**
 * Record what was accepted for a purchase. `acceptance` is what the route
 * knows about the person accepting; the values are what the app showed them.
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
    throw new SubscriptionError("Review the order summary and accept the terms to continue.", 409, { code: "ACCEPTANCE_REQUIRED" });
  }
};

/** Add-ons and tablets are prorated against a running POS period, so they need one. */
const requireActivePeriod = (subscription, on) => {
  if (subscription.status !== "ACTIVE" || !isActiveAt(subscription, on)) {
    throw new SubscriptionError(RENEW_FIRST, 409, { code: "PLAN_NOT_ACTIVE" });
  }
};

const acceptedValues = ({ bill, item }) => ({
  item,
  lines: bill.lines.map((l) => ({ description: l.description, amountPaise: l.amountPaise })),
  gst: bill.lines[0]
    ? { applicable: bill.lines[0].tax.applicable, percent: bill.lines[0].tax.percent, mode: bill.lines[0].tax.mode }
    : null,
  totalPaise: bill.totalPaise,
});

/**
 * Give the store what it paid for, as one atomic update that is safe to
 * repeat. It runs after the debit on the first request AND on a retry whose
 * debit was already taken (`duplicate`), so a purchase whose save failed
 * after the money moved (a crash, or another purchase changing the record at
 * the same moment) is completed by the next try instead of being lost.
 * false means it was already granted.
 */
const grant = async (subscription, filter, update) => {
  const res = await PlatformSubscription.updateOne({ _id: subscription._id, ...filter }, update);
  return Number(res?.modifiedCount) > 0;
};

// ---------------------------------------------------------------------------
// What a purchase would charge. The quote and the purchase both come from
// these, so the price shown is the price taken.
// ---------------------------------------------------------------------------

const addonPurchase = async ({ config, subscription, override, restaurant }, rawCode, on) => {
  const code = String(rawCode || "").trim().toUpperCase();
  const owned = (subscription.addons || []).find((a) => a.code === code && liveAt(a, on));
  // One CSD has retired can still be taken back by a store that has it this period.
  const addon = (config.addons || []).find((a) => a.code === code && (a.isActive !== false || owned));
  if (!addon) throw new SubscriptionError("That add-on is not available.", 404);
  requireActivePeriod(subscription, on);
  const pricePaise = await priceFor({ code, config, override });
  // Taking back one stopped this period is free: the period is already paid.
  const amountPaise = owned
    ? 0
    : prorate({ pricePaise, periodEnd: subscription.currentPeriodEnd, days: config.subscriptionDays, on });
  const lines = owned ? [] : [{ description: `${addon.name} add-on, until ${istDate(subscription.currentPeriodEnd)}`, amountPaise }];
  return { addon, owned, pricePaise, bill: priceLines(lines, { config, restaurant, on }) };
};

const tabletPurchase = async ({ config, subscription, override, restaurant }, on) => {
  requireActivePeriod(subscription, on);
  const tablets = subscription.tablets || [];
  const code = tablets.some((t) => liveAt(t, on)) ? "TABLET_EXTRA" : "TABLET_FIRST";
  const pricePaise = await priceFor({ code, config, override });
  const serial = tablets.reduce((max, t) => Math.max(max, Number(t.serial) || 0), 0) + 1;
  const amountPaise = prorate({ pricePaise, periodEnd: subscription.currentPeriodEnd, days: config.subscriptionDays, on });
  const lines = [{ description: `Tablet #${serial} rental, until ${istDate(subscription.currentPeriodEnd)}`, amountPaise }];
  return { code, serial, pricePaise, bill: priceLines(lines, { config, restaurant, on }) };
};

const printerPurchase = async ({ config, override, restaurant }, rawCode, on) => {
  const code = String(rawCode || "").trim().toUpperCase();
  const printer = (config.printers || []).find((p) => p.code === code && p.isActive !== false);
  if (!printer) throw new SubscriptionError("That printer is not available.", 404);
  const pricePaise = await priceFor({ code, config, override });
  const lines = [{ description: `${printer.name} (one-time purchase)`, amountPaise: pricePaise }];
  return { printer, pricePaise, bill: priceLines(lines, { config, restaurant, on }) };
};

/** What buying `item` would charge right now: "ADDON:<code>", "TABLET" or "PRINTER:<code>". */
const quote = async ({ restaurantId, item, on = new Date() }) => {
  const ctx = await load(restaurantId);
  if (ctx.exempt) throw new SubscriptionError(DEMO_STORE, 409);
  const [type, code] = String(item || "").split(":");
  if (type === "ADDON") return (await addonPurchase(ctx, code, on)).bill;
  if (type === "TABLET") return (await tabletPurchase(ctx, on)).bill;
  if (type === "PRINTER") return (await printerPurchase(ctx, code, on)).bill;
  throw new SubscriptionError("Say what to price: ADDON:<code>, TABLET or PRINTER:<code>.", 400);
};

// ---------------------------------------------------------------------------
// Activation, from the first qualifying top-up
// ---------------------------------------------------------------------------

/** Start the POS plan now: the plan price + GST from the wallet, period from today. */
const activate = async ({ restaurantId, on = new Date() }) => {
  const { config, subscription, override, restaurant, exempt } = await load(restaurantId);
  if (exempt || subscription.activatedAt) return null;

  const base = config.basePlan || {};
  const code = base.code || "POS";
  const name = base.name || code;
  const period = nextPeriod({ subscription: null, days: config.subscriptionDays, on });
  const bill = priceLines(
    [{ description: `${name} plan — ${span(config)}`, amountPaise: await priceFor({ code, config, override }) }],
    { config, restaurant, on },
  );

  // Once per store, ever. A spent key (the debit went through but the save
  // below did not) still activates: the plan was paid for.
  const { invoice } = await charge({
    subscription,
    bill,
    kind: "SUBSCRIPTION",
    description: `${name} plan`,
    idempotencyKey: `activation-${restaurantId}`,
    config,
    period,
    meta: { planCode: code, activation: true },
  });

  subscription.planCode = code;
  subscription.planName = name;
  subscription.status = "ACTIVE";
  subscription.currentPeriodStart = period.start;
  subscription.currentPeriodEnd = period.end;
  subscription.activatedAt = new Date(on);
  subscription.lastPaidAt = new Date(on);
  subscription.lastPaidPricePaise = bill.subtotalPaise;
  subscription.lastInvoiceId = invoice?._id || null;
  subscription.lastRenewalError = "";
  await subscription.save();

  // Starting the plan is what lifts a new store's lock.
  await settleLock(restaurantId);
  return { subscription, invoice, charged: bill.totalPaise };
};

/**
 * A top-up (RECHARGE) was just credited. Only services/recharge calls this,
 * so a CSD credit never activates anything or earns a tablet.
 *   not activated yet, and this one top-up is at least the minimum:
 *     the POS plan starts now
 *   activated before this top-up, and it is at least the tablet amount:
 *     one tablet credit (so the activation top-up never counts)
 * Then anything due renews at once -- which is what unlocks an expired store.
 */
const afterRecharge = async ({ restaurantId, amountPaise, on = new Date() }) => {
  const [config, subscription, override] = await Promise.all([
    getPlatformConfig(),
    getSubscription(restaurantId),
    getOverride(restaurantId),
  ]);
  if (override?.billingExempt) return { activated: false, tabletCredit: false };

  const paid = Math.round(Number(amountPaise) || 0);
  let activated = false;
  let tabletCredit = false;
  if (!subscription.activatedAt) {
    if (paid >= (Number(config.firstRechargeMinPaise) || 0)) activated = Boolean(await activate({ restaurantId, on }));
  } else if (paid >= (Number(config.tablet?.rechargeRequiredPaise) || 0)) {
    // Atomic, so two top-ups landing together both count.
    await PlatformSubscription.updateOne({ _id: subscription._id }, { $inc: { tabletRechargeCredits: 1 } });
    tabletCredit = true;
  }

  await renewDue(on, { restaurantId });
  return { activated, tabletCredit };
};

/** The smallest top-up this store may open now, in paise: the activation minimum until it has activated. */
const minimumTopUpPaise = async (restaurantId) => {
  const [config, subscription, override] = await Promise.all([
    getPlatformConfig(),
    PlatformSubscription.findOne({ restaurantId }).select("activatedAt").lean(),
    getOverride(restaurantId),
  ]);
  if (override?.billingExempt || subscription?.activatedAt) return 0;
  return Number(config.firstRechargeMinPaise) || 0;
};

// ---------------------------------------------------------------------------
// Buying
// ---------------------------------------------------------------------------

/** Add an add-on for the rest of this period (prorated), renewing with the plan after. */
const addAddon = async ({ restaurantId, code, acceptance, createdBy = null, on = new Date() }) => {
  const ctx = await load(restaurantId);
  const { config, subscription } = ctx;
  if (ctx.exempt) throw new SubscriptionError(DEMO_STORE, 409);
  const p = await addonPurchase(ctx, code, on);

  if (p.owned && !p.owned.endsAt) return { subscription, invoice: null, charged: 0, already: true };
  if (p.owned) {
    // Stopped earlier this period and taken back: keeps renewing, no charge.
    p.owned.endsAt = null;
    await subscription.save();
    return { subscription, invoice: null, charged: 0, already: false };
  }
  requireAcceptance(acceptance);

  const { invoice, duplicate, charged } = await charge({
    subscription,
    bill: p.bill,
    kind: "ADDON",
    description: `${p.addon.name} add-on`,
    idempotencyKey: `addon-${subscription._id}-${p.addon.code}-${iso(subscription.currentPeriodEnd)}`,
    config,
    period: { start: new Date(on), end: subscription.currentPeriodEnd },
    createdBy,
    meta: { addon: p.addon.code },
  });
  // A lapsed entry for the same add-on makes way for the new one.
  await PlatformSubscription.updateOne(
    { _id: subscription._id },
    { $pull: { addons: { code: p.addon.code, endsAt: { $ne: null, $lte: new Date(on) } } } },
  );
  const granted = await grant(
    subscription,
    { "addons.code": { $ne: p.addon.code } },
    { $push: { addons: { code: p.addon.code, name: p.addon.name, feature: p.addon.feature || "", pricePaise: p.pricePaise, activatedAt: new Date(on), endsAt: null } } },
  );
  if (!duplicate) {
    await recordSchedule({
      restaurantId,
      storeId: subscription.storeId,
      reason: "ADDON",
      values: acceptedValues({ bill: p.bill, item: { addon: p.addon.code, name: p.addon.name, monthlyPricePaise: p.pricePaise } }),
      acceptance,
    });
  }
  if (granted) await settleLock(restaurantId);
  return { subscription: await getSubscription(restaurantId), invoice, charged, already: !granted };
};

/** Stop an add-on at renewal. No refund: it keeps working until the period it was paid for ends. */
const removeAddon = async ({ restaurantId, code, on = new Date() }) => {
  const subscription = await getSubscription(restaurantId);
  const key = String(code || "").trim().toUpperCase();
  const addon = (subscription.addons || []).find((a) => a.code === key && liveAt(a, on));
  if (!addon) throw new SubscriptionError("That add-on is not on your plan.", 404);
  if (!addon.endsAt) {
    addon.endsAt = subscription.currentPeriodEnd || new Date(on);
    await subscription.save();
  }
  return { subscription, endsAt: addon.endsAt };
};

/**
 * Rent one more tablet. Each needs its own qualifying top-up (a credit).
 * Paid now; KnotKitchen then delivers it to `shipTo` (a hardware request).
 */
const rentTablet = async ({ restaurantId, acceptance, shipTo = null, createdBy = null, on = new Date() }) => {
  const ctx = await load(restaurantId);
  const { config, subscription } = ctx;
  if (ctx.exempt) throw new SubscriptionError(DEMO_STORE, 409);
  const p = await tabletPurchase(ctx, on);
  if ((Number(subscription.tabletRechargeCredits) || 0) < 1) {
    throw new SubscriptionError(
      `Top up at least ${formatINR(config.tablet?.rechargeRequiredPaise || 0)} in one go to rent a tablet. The money stays in your wallet and pays your bills.`,
      409,
      { code: "TABLET_TOPUP_REQUIRED" },
    );
  }
  requireAcceptance(acceptance);

  const { invoice, duplicate, charged } = await charge({
    subscription,
    bill: p.bill,
    kind: "TABLET",
    description: `Tablet #${p.serial} rental`,
    // Two requests racing for the same tablet number pay once.
    idempotencyKey: `tablet-${subscription._id}-${p.serial}`,
    config,
    period: { start: new Date(on), end: subscription.currentPeriodEnd },
    createdBy,
    meta: { tablet: p.serial, priceCode: p.code },
  });
  // The tablet and the credit it uses, in one step: two requests at once (a
  // free first tablet has no debit to de-duplicate them) get one tablet.
  const granted = await grant(
    subscription,
    { "tablets.serial": { $ne: p.serial }, tabletRechargeCredits: { $gte: 1 } },
    {
      $push: { tablets: { serial: p.serial, pricePaise: p.pricePaise, rentedAt: new Date(on), endsAt: null, shipTo } },
      $inc: { tabletRechargeCredits: -1 },
    },
  );
  if (granted && !duplicate) {
    await recordSchedule({
      restaurantId,
      storeId: subscription.storeId,
      reason: "TABLET",
      values: acceptedValues({ bill: p.bill, item: { tablet: p.serial, priceCode: p.code, monthlyPricePaise: p.pricePaise } }),
      acceptance,
    });
  }
  if (granted) {
    // Paid: KnotKitchen now delivers it. Never fails the rental -- a request
    // that did not open is opened when the store next opens Billing.
    try {
      await openRequest({
        type: "TABLET",
        key: `tablet-${subscription._id}-${p.serial}`,
        restaurantId,
        item: { code: p.code, name: `Tablet #${p.serial}`, tabletSerial: p.serial },
        payment: { invoiceId: invoice?._id || null },
        shipTo,
        on,
      });
    } catch (err) {
      console.warn("[Subscription] opening the tablet request failed:", err.message);
    }
    await settleLock(restaurantId);
  }
  return { subscription: await getSubscription(restaurantId), invoice, charged, serial: p.serial, already: !granted };
};

/** CSD only: a tablet came back. It stops renewing at the current period end. */
const endTablet = async ({ restaurantId, serial, on = new Date() }) => {
  const subscription = await getSubscription(restaurantId);
  const tablet = (subscription.tablets || []).find((t) => t.serial === Number(serial));
  if (!tablet) throw new SubscriptionError("This store has no tablet with that number.", 404);
  if (!tablet.endsAt) {
    tablet.endsAt = subscription.currentPeriodEnd || new Date(on);
    await subscription.save();
  }
  return { subscription, tablet };
};

/**
 * A printer is paid through the payment gateway, never from the wallet:
 * this prices it and records what was accepted; services/recharge opens the
 * Cashfree order, and recordPrinterPayment records the printer once Cashfree
 * says it is paid.
 */
const preparePrinterPayment = async ({ restaurantId, code, acceptance, on = new Date() }) => {
  const ctx = await load(restaurantId);
  if (ctx.exempt) throw new SubscriptionError(DEMO_STORE, 409);
  const p = await printerPurchase(ctx, code, on);
  // A gateway cannot take Rs 0; a free printer is handed over by KnotKitchen.
  if (!(p.bill.totalPaise > 0)) throw new SubscriptionError("This printer has no price here. Contact KnotKitchen to have it sent.", 409);
  requireAcceptance(acceptance);
  await recordSchedule({
    restaurantId,
    storeId: ctx.subscription.storeId,
    reason: "HARDWARE",
    values: acceptedValues({ bill: p.bill, item: { printer: p.printer.code, name: p.printer.name, paidVia: "gateway" } }),
    acceptance,
  });
  // The priced lines go with the payment, so the invoice is exactly what was charged.
  return { printer: p.printer, pricePaise: p.pricePaise, totalPaise: p.bill.totalPaise, lines: p.bill.lines };
};

/**
 * Cashfree has confirmed a printer payment: add the printer and its invoice.
 * The payment's own gateway order id is the key, so the return from checkout
 * and the webhook arriving together record it once.
 */
const recordPrinterPayment = async ({ intent, paidPaise, on = new Date() }) => {
  const restaurantId = intent.restaurantId;
  const subscription = await getSubscription(restaurantId);
  const key = `printer-pay-${intent.gatewayOrderId}`;
  // The invoice id is fixed with the printer row, so a retry after a failure
  // between the two issues the missing invoice, and never a second one.
  const newInvoiceId = new mongoose.Types.ObjectId();
  const granted = await grant(
    subscription,
    { "hardware.key": { $ne: key } },
    {
      $push: {
        hardware: {
          key,
          code: intent.item?.code || "",
          name: intent.item?.name || "Printer",
          pricePaise: Number(intent.item?.pricePaise) || 0,
          totalPaise: paidPaise,
          invoiceId: newInvoiceId,
          purchasedAt: new Date(on),
        },
      },
    },
  );
  const invoiceId = granted
    ? newInvoiceId
    : ((await getSubscription(restaurantId)).hardware || []).find((h) => h.key === key)?.invoiceId;
  if (!invoiceId || (await PlatformInvoice.exists({ _id: invoiceId }))) return { recorded: granted, already: !granted };

  const config = await getPlatformConfig();
  // What Cashfree charged, as priced when the payment was opened.
  let lines = intent.item?.lines;
  if (!Array.isArray(lines) || !lines.length) {
    const restaurant = await Restaurant.findById(restaurantId).select("address").lean();
    lines = priceLines(
      [{ description: `${intent.item?.name || "Printer"} (one-time purchase)`, amountPaise: Number(intent.item?.pricePaise) || 0 }],
      { config, restaurant, on },
    ).lines;
  }
  try {
    const invoice = await issueInvoice({
      _id: invoiceId,
      restaurantId,
      storeId: subscription.storeId,
      kind: "HARDWARE",
      lines,
      config,
      parties: await partiesFor(restaurantId, config),
      period: null,
      ledgerEntryId: null,
    });
    return { recorded: true, invoice };
  } catch (err) {
    // The webhook and the till's return issuing it at the same moment.
    if (err?.code === 11000) return { recorded: false, already: true };
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------

/**
 * What the next renewal charges: the POS plan, and every add-on and tablet
 * still renewing, at this store's prices today. Stopped ones (endsAt at or
 * before the period end) lapse and are left out. The first tablet is priced
 * as the first, the rest as extras. `target` is the entry a line renews.
 */
const renewalLines = async ({ config, subscription, override }) => {
  const periodEnd = subscription.currentPeriodEnd;
  const keep = (x) => !x.endsAt || new Date(x.endsAt) > new Date(periodEnd);
  const addons = (subscription.addons || []).filter(keep);
  const tablets = (subscription.tablets || []).filter(keep).sort((a, b) => a.serial - b.serial);
  const base = config.basePlan || {};
  const lines = [
    { description: `${base.name || "POS"} plan — ${span(config)}`, amountPaise: await priceFor({ code: base.code || "POS", config, override }), target: null },
  ];
  for (const a of addons) {
    const price = await priceFor({ code: a.code, config, override });
    // An add-on CSD has since removed from the catalogue renews at what it was bought for.
    lines.push({ description: `${a.name} add-on — ${span(config)}`, amountPaise: price === null ? Number(a.pricePaise) || 0 : price, target: a });
  }
  for (const [i, t] of tablets.entries()) {
    const amountPaise = await priceFor({ code: i === 0 ? "TABLET_FIRST" : "TABLET_EXTRA", config, override });
    lines.push({ description: `Tablet #${t.serial} rental — ${span(config)}`, amountPaise, target: t });
  }
  return { lines, addons, tablets };
};

/**
 * Renew one subscription whose period has ended: plan, add-ons and tablets in
 * one invoice, all or nothing. Short of money -> EXPIRED with the reason, and
 * the lock rules (grace, then lock) take over until a top-up renews it.
 */
const renewOne = async (subscription, { config, on }) => {
  const restaurantId = subscription.restaurantId;
  if (!["ACTIVE", "EXPIRED"].includes(subscription.status)) return { renewed: false };
  if (!subscription.currentPeriodEnd || new Date(subscription.currentPeriodEnd) > new Date(on)) return { renewed: false };
  const override = await getOverride(restaurantId);
  if (override?.billingExempt) return { renewed: false };
  const restaurant = await Restaurant.findById(restaurantId).select("address").lean();

  const { lines, addons, tablets } = await renewalLines({ config, subscription, override });
  const bill = priceLines(lines, { config, restaurant, on });
  // On time, the new period continues from the old end; late, renewalPolicy decides.
  const period = nextPeriod({ subscription, days: config.subscriptionDays, policy: config.renewalPolicy, on });
  subscription.lastRenewalAttemptAt = new Date(on);

  let result;
  try {
    result = await charge({
      subscription,
      bill,
      kind: "SUBSCRIPTION",
      description: `${subscription.planName || "POS"} plan renewal`,
      // One renewal per period, however many sweeps and top-ups try it.
      idempotencyKey: `renewal-${subscription._id}-${iso(subscription.currentPeriodEnd)}`,
      config,
      period,
      meta: { renewal: true, lines: lines.length },
    });
  } catch (err) {
    if (!(err instanceof SubscriptionError)) throw err;
    subscription.status = "EXPIRED";
    subscription.lastRenewalError = err.message;
    await subscription.save();
    await settleLock(restaurantId);
    return { renewed: false, error: err.message };
  }

  for (const l of lines) if (l.target) l.target.pricePaise = l.amountPaise;
  // Stopped add-ons lapse here. Returned tablets stay listed (ended) so tablet
  // numbers, and the payment keys built from them, never repeat.
  subscription.addons = addons;
  subscription.status = "ACTIVE";
  subscription.currentPeriodStart = period.start;
  subscription.currentPeriodEnd = period.end;
  subscription.lastRenewalError = "";
  if (result.invoice) {
    subscription.lastInvoiceId = result.invoice._id;
    subscription.lastPaidAt = new Date(on);
    subscription.lastPaidPricePaise = bill.subtotalPaise;
  }
  await subscription.save();
  await settleLock(restaurantId);
  return { renewed: true, invoice: result.invoice, charged: result.charged };
};

/**
 * Renew every subscription whose period has ended (or just this restaurant's).
 * Run by the lock sweep, after every top-up, and by POST /api/subscription/renew.
 */
// ponytail: an EXPIRED store is retried every sweep (a few reads each); skip ones whose balance has not moved if that grows.
const renewDue = async (on = new Date(), { restaurantId } = {}) => {
  const config = await getPlatformConfig();
  const due = await PlatformSubscription.find({
    ...(restaurantId ? { restaurantId } : {}),
    status: { $in: ["ACTIVE", "EXPIRED"] },
    currentPeriodEnd: { $ne: null, $lte: new Date(on) },
  });
  let renewed = 0;
  let failed = 0;
  for (const s of due) {
    try {
      const r = await renewOne(s, { config, on });
      if (r.renewed) renewed += 1;
      else if (r.error) failed += 1;
    } catch (err) {
      // A top-up and the sweep renewing at once: the loser's save hits a
      // VersionError after the (shared, idempotent) debit. Reload and finish
      // it now; the spent renewal key makes this retry free.
      let failure = err;
      if (err?.name === "VersionError") {
        try {
          const r = await renewOne(await getSubscription(s.restaurantId), { config, on });
          if (r.renewed) renewed += 1;
          continue;
        } catch (retryErr) {
          failure = retryErr;
        }
      }
      console.warn(`[Subscription] renewal ${s.restaurantId}:`, failure.message);
    }
  }
  return { considered: due.length, renewed, failed };
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Status as of now, without changing anything (bar creating the empty record). */
const statusFor = async (restaurantId, on = new Date()) => {
  const { config, subscription, override, restaurant, exempt } = await load(restaurantId);
  const price = (code) => priceFor({ code, config, override });
  const active = subscription.status === "ACTIVE" && isActiveAt(subscription, on);
  const graceEnds = subscription.currentPeriodEnd
    ? new Date(new Date(subscription.currentPeriodEnd).getTime() + Math.max(0, Number(config.graceHours || 0)) * 3600 * 1000)
    : null;
  const balance = await BusinessBalance.findOne({ restaurantId }).select("balancePaise").lean();

  // The whole catalogue on sale, marked with what this store has. One it
  // owns that has since been retired still shows, so it can be stopped.
  const addons = [];
  for (const a of [...(config.addons || [])].sort((x, y) => (x.sortOrder || 0) - (y.sortOrder || 0))) {
    const owned = (subscription.addons || []).find((o) => o.code === a.code && liveAt(o, on));
    if (a.isActive === false && !owned) continue;
    addons.push({
      code: a.code,
      name: a.name,
      description: a.description || "",
      feature: a.feature || "",
      price: asAmount(await price(a.code)),
      // On the plan (a stopped one stays until its endsAt)...
      owned: Boolean(owned),
      // ...and paid up: the POS period it rides on is running.
      active: Boolean(owned) && active,
      endsAt: owned?.endsAt || null,
    });
  }

  const tablets = (subscription.tablets || []).map((t) => ({
    serial: t.serial,
    price: asAmount(t.pricePaise),
    rentedAt: t.rentedAt,
    endsAt: t.endsAt || null,
    active: liveAt(t, on),
  }));
  const [firstPrice, extraPrice] = await Promise.all([price("TABLET_FIRST"), price("TABLET_EXTRA")]);
  const printers = [];
  for (const p of (config.printers || []).filter((x) => x.isActive !== false)) {
    printers.push({
      code: p.code,
      name: p.name,
      price: asAmount(await price(p.code)),
      owned: (subscription.hardware || []).filter((h) => h.code === p.code && !h.cancelledAt).length,
    });
  }

  let nextRenewal = null;
  if (!exempt && subscription.activatedAt && subscription.currentPeriodEnd) {
    const { lines } = await renewalLines({ config, subscription, override });
    nextRenewal = { at: subscription.currentPeriodEnd, ...billView(priceLines(lines, { config, restaurant, on })) };
  }

  const base = config.basePlan || {};
  return {
    status: subscription.status,
    active,
    // Set by CSD: a demo store, never billed and never locked.
    exempt,
    needsActivation: !exempt && !subscription.activatedAt,
    firstRechargeMin: asAmount(Number(config.firstRechargeMinPaise) || 0),
    basePlan: { code: base.code || "POS", name: base.name || "POS", price: asAmount(await price(base.code || "POS")) },
    periodDays: config.subscriptionDays,
    activatedAt: subscription.activatedAt,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    inGrace: !active && Boolean(subscription.activatedAt) && Boolean(graceEnds) && new Date(on) < graceEnds,
    graceEndsAt: graceEnds,
    lastRenewalError: subscription.lastRenewalError || "",
    addons,
    tablets,
    tablet: {
      firstPrice: asAmount(firstPrice),
      extraPrice: asAmount(extraPrice),
      rechargeRequired: asAmount(Number(config.tablet?.rechargeRequiredPaise) || 0),
      nextPrice: asAmount(tablets.some((t) => t.active) ? extraPrice : firstPrice),
      credits: Number(subscription.tabletRechargeCredits) || 0,
    },
    printers,
    hardware: (subscription.hardware || []).map((h) => ({
      code: h.code,
      name: h.name,
      price: asAmount(h.pricePaise),
      total: asAmount(h.totalPaise),
      invoiceId: h.invoiceId || null,
      purchasedAt: h.purchasedAt,
      cancelled: Boolean(h.cancelledAt),
    })),
    // Where a printer or tablet is delivered unless the store says otherwise.
    shipTo: defaultShipTo(restaurant),
    nextRenewal,
    // What the add-ons unlock (services/planFeatures). The POS locks its tiles from this.
    features: featuresFor({ subscription, exempt, on }),
    balance: asAmount(balance?.balancePaise || 0),
  };
};

module.exports = {
  getSubscription,
  quote,
  billView,
  activate,
  afterRecharge,
  minimumTopUpPaise,
  addAddon,
  removeAddon,
  rentTablet,
  endTablet,
  preparePrinterPayment,
  recordPrinterPayment,
  renewDue,
  statusFor,
  issueInvoice,
  scheduleHash,
  AGREEMENT_VERSION,
  SubscriptionError,
};
