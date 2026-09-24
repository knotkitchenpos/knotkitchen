/**
 * Billing v3, end to end: a top-up activates the POS plan, add-ons and
 * tablets are bought mid-period, printers once, and everything renews from
 * the wallet in one invoice -- or the store expires, locks after the grace
 * period, and the next top-up renews and unlocks it.
 *
 * Real services (subscription, recharge, accountLock, pricing, tax, periods,
 * planFeatures) over an in-memory store: the models, the ledger and the
 * gateway are replaced below, for one restaurant.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("module");

const { PlatformBillingConfig } = require("../models/platformBillingModel");
const { startOfIstDay, addDays } = require("../services/subscriptionPeriod");

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const RID = "64b000000000000000000001";
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const GST = { registered: true, percent: 18, mode: "exclusive", effectiveFrom: new Date("2020-01-01"), placeOfSupplyState: "West Bengal" };
const YES = { accepted: true, user: { _id: "u1", name: "Owner", role: "Admin" } };

const state = {};

const reset = ({ exempt = false } = {}) => {
  Object.assign(state, {
    // The shipped defaults, exactly as a new install gets them.
    config: { ...new PlatformBillingConfig({ gst: GST }).toObject(), save: async () => {} },
    override: exempt ? { billingExempt: true, planPrices: [] } : null,
    restaurant: { _id: RID, storeId: "148379", name: "Spice Garden", address: { state: "West Bengal" } },
    sub: null,
    invoices: [],
    schedules: [],
    entries: [],
    intents: [],
    paid: {},
    balance: 0,
  });
  state.balanceDoc = {
    restaurantId: RID,
    get balancePaise() {
      return state.balance;
    },
    lockedAt: null,
    lockedReason: "",
    save: async () => {},
  };
};

/** A query: awaitable, and chainable like a Mongoose one. */
const q = (fn) => {
  const p = {
    then: (res, rej) => Promise.resolve().then(fn).then(res, rej),
    select: () => p,
    lean: () => p,
    sort: () => p,
    limit: () => p,
  };
  return p;
};

class InsufficientBalanceError extends Error {
  constructor(required, available) {
    super("Insufficient KnotKitchen Business Balance.");
    this.requiredPaise = required;
    this.availablePaise = available;
  }
}

/** The ledger's contract: idempotency keys, never negative. */
const move = async (a, direction) => {
  const dup = a.idempotencyKey && state.entries.find((e) => e.idempotencyKey === a.idempotencyKey);
  if (dup) return { entry: dup, duplicate: true };
  if (direction === "DEBIT" && state.balance < a.amountPaise) throw new InsufficientBalanceError(a.amountPaise, state.balance);
  state.balance += direction === "CREDIT" ? a.amountPaise : -a.amountPaise;
  const entry = { _id: `le${state.entries.length + 1}`, ...a, direction, balanceAfterPaise: state.balance, createdAt: new Date() };
  state.entries.push(entry);
  return { entry, duplicate: false };
};

const fakes = {
  "../models/platformBillingModel": { PlatformBillingConfig: { findOne: () => q(() => state.config) } },
  "../models/csdStoreChargesModel": { findOne: () => q(() => state.override) },
  "../models/restaurantModel": { findById: () => q(() => state.restaurant) },
  "../models/orderModel": { distinct: async () => [] },
  "../models/platformSubscriptionModel": {
    PlatformSubscription: {
      findOne: () => q(() => state.sub),
      create: async (d) => {
        state.sub = {
          _id: "sub1",
          restaurantId: d.restaurantId,
          storeId: d.storeId,
          planCode: "",
          planName: "",
          status: "NONE",
          currentPeriodStart: null,
          currentPeriodEnd: null,
          lastPaidPricePaise: 0,
          lastInvoiceId: null,
          lastPaidAt: null,
          activatedAt: null,
          addons: [],
          tablets: [],
          tabletRechargeCredits: 0,
          hardware: [],
          lastRenewalAttemptAt: null,
          lastRenewalError: "",
          save: async function save() {
            return this;
          },
        };
        return state.sub;
      },
      // Filters are re-checked by the service; one restaurant lives here.
      find: () => q(() => (state.sub ? [state.sub] : [])),
      distinct: async () => (state.sub ? [RID] : []),
      // Enough of MongoDB's updateOne for the service's atomic grants:
      // "arr.field": { $ne }, field: { $gte }, and $inc / $push / $pull.
      updateOne: async (filter, update) => {
        if (state.failNextUpdate) {
          state.failNextUpdate = false;
          throw new Error("simulated crash after the debit");
        }
        const s = state.sub;
        const ok =
          s &&
          Object.entries(filter).every(([k, cond]) => {
            if (k === "_id") return true;
            const [arr, field] = k.split(".");
            if (field) return !(s[arr] || []).some((e) => e[field] === cond.$ne);
            return cond.$gte === undefined || s[k] >= cond.$gte;
          });
        if (!ok) return { matchedCount: 0, modifiedCount: 0 };
        for (const [k, v] of Object.entries(update.$inc || {})) s[k] += v;
        for (const [k, v] of Object.entries(update.$push || {})) s[k].push({ ...v });
        for (const [k, c] of Object.entries(update.$pull || {})) {
          s[k] = s[k].filter((e) => !(e.code === c.code && e.endsAt && e.endsAt <= c.endsAt.$lte));
        }
        return { matchedCount: 1, modifiedCount: 1 };
      },
    },
    PlatformInvoice: {
      create: async (d) => {
        const invoice = { _id: `inv${state.invoices.length + 1}`, ...d };
        state.invoices.push(invoice);
        return invoice;
      },
    },
    CommercialSchedule: {
      findOne: () => q(() => state.schedules[state.schedules.length - 1] || null),
      create: async (d) => (state.schedules.push(d), d),
    },
  },
  "../models/businessBalanceModel": {
    BusinessBalance: { findOne: () => q(() => state.balanceDoc), distinct: async () => [] },
    LedgerEntry: { findOne: () => q(() => state.entries[state.entries.length - 1] || null) },
  },
  "../models/rechargeOrderModel": {
    create: async (d) => {
      const intent = { _id: `ro${state.intents.length + 1}`, status: "CREATED", ...d, save: async () => {} };
      state.intents.push(intent);
      return intent;
    },
    findOne: async ({ gatewayOrderId }) => state.intents.find((i) => i.gatewayOrderId === gatewayOrderId) || null,
  },
  "./ledger": {
    InsufficientBalanceError,
    credit: (a) => move(a, "CREDIT"),
    debit: (a) => move(a, "DEBIT"),
    getBalance: async () => state.balanceDoc,
  },
  "./invoiceNumber": { nextInvoiceNumber: async () => `KK-148379-${String(state.invoices.length + 1).padStart(4, "0")}` },
  "./orderCharge": {
    settlePendingCharges: async () => null,
    outstandingDues: async () => ({ count: 0, totalPaise: 0, oldestAt: null }),
  },
  "./paymentGateway": { resolvePlatformGateway: () => ({ enabled: true, environment: "TEST", keyId: "k", secret: "s" }) },
  "./gateways/cashfree": {
    createOrder: async () => ({ paymentSessionId: "session" }),
    isOrderPaid: async ({ orderId }) => ({ paid: true, orderStatus: "PAID", amount: state.paid[orderId], cfOrderId: `cf-${orderId}` }),
  },
  "../config/config": { cashfreeNotifyUrl: "" },
};

// Installed for the whole file (each test file runs in its own process), so
// lazy requires inside the services resolve to the same fakes.
const realLoad = Module._load;
Module._load = function load(request) {
  if (Object.prototype.hasOwnProperty.call(fakes, request)) return fakes[request];
  return realLoad.apply(this, arguments);
};

const billing = require("../services/subscription");
const recharge = require("../services/recharge");
const lock = require("../services/accountLock");
const ledger = fakes["./ledger"];

/** Open a top-up through the real flow, and have Cashfree report `paid` rupees. */
const topUp = async (rupees, { paid = rupees } = {}) => {
  const { gatewayOrderId } = await recharge.createRecharge({ restaurantId: RID, amountPaise: rupees * 100 });
  state.paid[gatewayOrderId] = paid;
  return recharge.finalizeRecharge({ gatewayOrderId });
};

const rejects = (promise, status, code) =>
  assert.rejects(promise, (err) => {
    assert.equal(err.status, status, err.message);
    if (code) assert.equal(err.code, code);
    return true;
  });

const debits = (kind) => state.entries.filter((e) => e.direction === "DEBIT" && (!kind || e.kind === kind));

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

test("a CSD credit never activates: only a real top-up can", async () => {
  reset();
  assert.equal((await billing.statusFor(RID)).needsActivation, true);
  await lock.evaluateLock(RID);
  assert.ok(state.balanceDoc.lockedAt, "a new store starts locked");
  assert.match(state.balanceDoc.lockedReason, /No plan is active yet\. Recharge at least ₹2,500\.00 to start\. The POS plan starts automatically\./);

  await ledger.credit({ restaurantId: RID, kind: "ADJUSTMENT_CREDIT", amountPaise: 500000, description: "Goodwill" });
  const status = await billing.statusFor(RID);
  assert.equal(status.status, "NONE");
  assert.equal(status.needsActivation, true);
  assert.equal(status.balance.paise, 500000);
  assert.equal(state.invoices.length, 0);
  await rejects(billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: YES }), 409, "PLAN_NOT_ACTIVE");
});

test("activation only on a single top-up at or above the minimum, never below", async () => {
  reset();
  // Refused up front while the plan has not started...
  await rejects(recharge.createRecharge({ restaurantId: RID, amountPaise: 249900 }), 400, "FIRST_TOPUP_MINIMUM");
  await assert.rejects(recharge.createRecharge({ restaurantId: RID, amountPaise: 100000 }), /at least ₹2,500\.00/);
  // ...and if less arrives than was opened, it is credited but starts nothing.
  const short = await topUp(2500, { paid: 2000 });
  assert.equal(short.credited, true);
  assert.equal(state.balance, 200000);
  assert.equal(state.sub.status, "NONE");
  assert.equal(state.invoices.length, 0);

  // Two small top-ups adding up to the minimum do not count either: one top-up must.
  await topUp(2500, { paid: 2400 });
  assert.equal(state.sub.status, "NONE");

  const ok = await topUp(2500);
  assert.equal(ok.plan.activated, true);
  assert.equal(state.sub.status, "ACTIVE");
  assert.equal(state.sub.planCode, "POS");
  const [invoice] = state.invoices;
  assert.equal(invoice.kind, "SUBSCRIPTION");
  assert.deepEqual(invoice.lines.map((l) => [l.description, l.amountPaise]), [["POS plan — 30 days", 39900]]);
  assert.equal(invoice.totalPaise, 47082, "₹399 + 18% GST");
  // The period is today's IST midnight plus 30 days; the rest stays in the wallet.
  assert.equal(state.sub.currentPeriodStart.getTime(), startOfIstDay(new Date()).getTime());
  assert.equal(state.sub.currentPeriodEnd.getTime(), addDays(state.sub.currentPeriodStart, 30).getTime());
  assert.equal(state.balance, 200000 + 240000 + 250000 - 47082);
  assert.equal(state.balanceDoc.lockedAt, null, "and the store unlocks in the same response");

  // A second qualifying top-up never activates (or charges) again.
  await topUp(2500);
  assert.equal(state.invoices.length, 1);
  assert.equal(debits().length, 1);
  assert.equal(state.sub.tabletRechargeCredits, 0, "below the tablet amount");
});

test("after activation any top-up is fine; a demo store has no minimum and is never activated", async () => {
  reset();
  await topUp(2500);
  await topUp(100);
  assert.equal(state.balance, 250000 - 47082 + 10000);

  reset({ exempt: true });
  await topUp(100);
  assert.equal(state.balance, 10000);
  assert.equal(state.sub?.status || "NONE", "NONE");
  assert.equal(state.invoices.length, 0);
});

// ---------------------------------------------------------------------------
// Add-ons
// ---------------------------------------------------------------------------

test("an add-on is prorated for the rest of the period, taxed, and charged once however often it is asked for", async () => {
  reset();
  await topUp(10000);
  const on = addDays(state.sub.currentPeriodStart, 15); // 15 of 30 days left
  const before = state.balance;

  const quoted = await billing.quote({ restaurantId: RID, item: "ADDON:TABLE_QR", on });
  assert.equal(quoted.lines[0].amountPaise, 10000, "half of ₹200");
  assert.equal(quoted.totalPaise, 11800, "+ 18% GST");

  await rejects(billing.addAddon({ restaurantId: RID, code: "TABLE_QR", acceptance: { accepted: false }, on }), 409, "ACCEPTANCE_REQUIRED");
  assert.equal(state.balance, before, "nothing taken without the terms accepted");

  const bought = await billing.addAddon({ restaurantId: RID, code: "table_qr", acceptance: YES, on });
  assert.equal(bought.charged, 11800, "the quote is the charge");
  const invoice = state.invoices.find((i) => i.kind === "ADDON");
  assert.equal(invoice.lines[0].amountPaise, 10000);
  assert.equal(invoice.cgstPaise + invoice.sgstPaise, 1800);
  assert.equal(state.schedules[0].reason, "ADDON");
  assert.equal(state.schedules[0].acceptedBy.name, "Owner");

  // A double click: already on, nothing charged.
  const again = await billing.addAddon({ restaurantId: RID, code: "TABLE_QR", acceptance: YES, on });
  assert.equal(again.already, true);
  assert.equal(again.charged, 0);
  assert.equal(state.balance, before - 11800);

  // Two requests racing: one key, one charge, one entry.
  await Promise.all([
    billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: YES, on }),
    billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: YES, on }),
  ]);
  assert.equal(debits("SUBSCRIPTION").filter((e) => e.meta?.addon === "WEBSITE").length, 1);
  assert.equal(state.sub.addons.filter((a) => a.code === "WEBSITE").length, 1);
  assert.equal(state.balance, before - 11800 - 17700);

  // What the add-ons unlock.
  const status = await billing.statusFor(RID, on);
  assert.deepEqual(status.features, { website: true, tableQr: true, paymentGateway: true });
  assert.deepEqual(status.addons.map((a) => [a.code, a.owned, a.active]), [["TABLE_QR", true, true], ["WEBSITE", true, true], ["GMB", false, false]]);
  assert.equal(status.addons[0].price.label, "₹200.00");
});

test("stopping an add-on keeps it to the period end without a refund; taking it back is free", async () => {
  reset();
  await topUp(10000);
  const on = addDays(state.sub.currentPeriodStart, 15);
  await billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: YES, on });
  const paid = state.balance;

  const { endsAt } = await billing.removeAddon({ restaurantId: RID, code: "WEBSITE", on });
  assert.equal(endsAt.getTime(), state.sub.currentPeriodEnd.getTime());
  assert.equal(state.balance, paid, "no refund");
  let status = await billing.statusFor(RID, on);
  assert.equal(status.features.website, true, "still works until the period ends");
  assert.ok(!status.nextRenewal.lines.some((l) => /Website/.test(l.description)), "and is not renewed");
  assert.equal((await billing.statusFor(RID, state.sub.currentPeriodEnd)).features.website, false);

  // Changed their mind within the period: back on, nothing charged, no terms to accept again.
  const back = await billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: null, on });
  assert.equal(back.charged, 0);
  assert.equal(state.balance, paid);
  status = await billing.statusFor(RID, on);
  assert.equal(status.addons.find((a) => a.code === "WEBSITE").endsAt, null);
  assert.ok(status.nextRenewal.lines.some((l) => /Website/.test(l.description)));
});

// ---------------------------------------------------------------------------
// Tablets and printers
// ---------------------------------------------------------------------------

test("each tablet needs its own ₹4,000 top-up, never the activation one; first ₹600, then ₹500", async () => {
  reset();
  await topUp(10000); // activates; does not count, however large
  assert.equal(state.sub.tabletRechargeCredits, 0);
  const on = addDays(state.sub.currentPeriodStart, 15);
  await rejects(billing.rentTablet({ restaurantId: RID, acceptance: YES, on }), 409, "TABLET_TOPUP_REQUIRED");
  await assert.rejects(billing.rentTablet({ restaurantId: RID, acceptance: YES, on }), /Top up at least ₹4,000\.00 in one go/);

  await topUp(3999);
  assert.equal(state.sub.tabletRechargeCredits, 0, "₹1 short does not count");
  const r = await topUp(4000);
  assert.equal(r.plan.tabletCredit, true);
  assert.equal(state.sub.tabletRechargeCredits, 1);
  // A redelivered callback for the same top-up counts once.
  await recharge.finalizeRecharge({ gatewayOrderId: state.intents[state.intents.length - 1].gatewayOrderId });
  assert.equal(state.sub.tabletRechargeCredits, 1);

  assert.equal((await billing.quote({ restaurantId: RID, item: "TABLET", on })).totalPaise, 35400);
  const first = await billing.rentTablet({ restaurantId: RID, acceptance: YES, on });
  assert.equal(first.charged, 35400, "half of ₹600 + GST");
  assert.equal(state.invoices[state.invoices.length - 1].kind, "TABLET");
  assert.equal(state.sub.tabletRechargeCredits, 0, "one credit per tablet");
  await rejects(billing.rentTablet({ restaurantId: RID, acceptance: YES, on }), 409, "TABLET_TOPUP_REQUIRED");

  await topUp(4000);
  const second = await billing.rentTablet({ restaurantId: RID, acceptance: YES, on });
  assert.equal(second.charged, 29500, "half of ₹500 + GST");
  assert.deepEqual(state.sub.tablets.map((t) => [t.serial, t.pricePaise]), [[1, 60000], [2, 50000]]);

  const status = await billing.statusFor(RID, on);
  assert.equal(status.tablet.nextPrice.paise, 50000);
  assert.equal(status.tablet.credits, 0);
  assert.equal(status.tablets.length, 2);
  // The money stays in the wallet.
  assert.equal(state.balance, 1000000 - 47082 + 399900 + 400000 - 35400 + 400000 - 29500);
});

test("a printer is one purchase at full price + GST, recorded as hardware, never renewed", async () => {
  reset();
  await topUp(10000);
  await rejects(billing.buyPrinter({ restaurantId: RID, code: "PRINTER_2IN", acceptance: null }), 409, "ACCEPTANCE_REQUIRED");
  await rejects(billing.buyPrinter({ restaurantId: RID, code: "PRINTER_9IN", acceptance: YES }), 404);

  const r = await billing.buyPrinter({ restaurantId: RID, code: "PRINTER_2IN", acceptance: YES });
  assert.equal(r.charged, 224200, "₹1,900 + 18% GST");
  assert.equal(debits("HARDWARE").length, 1);
  assert.equal(state.invoices[state.invoices.length - 1].kind, "HARDWARE");
  assert.deepEqual(state.sub.hardware.map((h) => [h.code, h.pricePaise, h.totalPaise]), [["PRINTER_2IN", 190000, 224200]]);
  const status = await billing.statusFor(RID);
  assert.equal(status.printers.find((p) => p.code === "PRINTER_2IN").owned, 1);
  assert.ok(!status.nextRenewal.lines.some((l) => /printer/i.test(l.description)));
});

// ---------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------

test("at the period end the plan, add-ons and tablets renew from the wallet in one invoice", async () => {
  reset();
  await topUp(10000);
  await topUp(4000);
  const on = addDays(state.sub.currentPeriodStart, 15);
  await billing.addAddon({ restaurantId: RID, code: "TABLE_QR", acceptance: YES, on });
  await billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: YES, on });
  await billing.rentTablet({ restaurantId: RID, acceptance: YES, on });
  await billing.removeAddon({ restaurantId: RID, code: "WEBSITE", on });

  const end = state.sub.currentPeriodEnd;
  const quoted = (await billing.statusFor(RID, on)).nextRenewal;
  assert.equal(quoted.total.paise, 141482);
  const before = state.balance;
  const invoicesBefore = state.invoices.length;

  // The 15-minute sweep does it.
  await lock.sweepLocks(new Date(end.getTime() + MIN));
  assert.equal(state.invoices.length, invoicesBefore + 1, "one invoice");
  const invoice = state.invoices[state.invoices.length - 1];
  assert.equal(invoice.kind, "SUBSCRIPTION");
  assert.deepEqual(invoice.lines.map((l) => [l.description, l.amountPaise]), [
    ["POS plan — 30 days", 39900],
    ["QR Table Ordering add-on — 30 days", 20000],
    ["Tablet #1 rental — 30 days", 60000],
  ]);
  assert.equal(invoice.totalPaise, 141482, "each line + GST; the stopped Website add-on lapsed");
  assert.equal(invoice.totalPaise, quoted.total.paise, "what Billing said it would be");
  assert.equal(state.balance, before - 141482);
  assert.equal(state.sub.status, "ACTIVE");
  assert.equal(state.sub.currentPeriodStart.getTime(), end.getTime(), "on time: continuous from the old end");
  assert.equal(state.sub.currentPeriodEnd.getTime(), addDays(end, 30).getTime());
  assert.deepEqual(state.sub.addons.map((a) => a.code), ["TABLE_QR"]);
  assert.equal((await billing.statusFor(RID, end)).features.website, false);

  // Nothing is due again until the new end, however often it runs.
  await billing.renewDue(new Date(end.getTime() + 2 * MIN));
  await lock.sweepLocks(new Date(end.getTime() + HOUR));
  assert.equal(state.invoices.length, invoicesBefore + 1);
});

test("short at renewal: EXPIRED, locked after the grace period, and the next top-up renews and unlocks", async () => {
  reset();
  // Activated 32 days ago, so the period has ended.
  await ledger.credit({ restaurantId: RID, kind: "RECHARGE", amountPaise: 250000, idempotencyKey: "recharge-old" });
  await billing.afterRecharge({ restaurantId: RID, amountPaise: 250000, on: new Date(Date.now() - 32 * 24 * HOUR) });
  assert.equal(state.sub.status, "ACTIVE");
  await ledger.debit({ restaurantId: RID, kind: "ADJUSTMENT_DEBIT", amountPaise: state.balance - 10000 });
  const end = state.sub.currentPeriodEnd;
  assert.ok(end.getTime() < Date.now() - 24 * HOUR);

  const result = await billing.renewDue(new Date(end.getTime() + MIN));
  assert.equal(result.failed, 1);
  assert.equal(state.sub.status, "EXPIRED");
  assert.equal(state.sub.lastRenewalError, "Top up the wallet: you need ₹370.82 more.");
  assert.equal(state.balance, 10000, "all or nothing: nothing taken");
  assert.equal(state.invoices.length, 1);

  const inGrace = await lock.assessAccount(RID, new Date(end.getTime() + 23 * HOUR));
  assert.equal(inGrace.shouldLock, false);
  assert.match(inGrace.lockWarning, /subscription has ended/);
  const status = await billing.statusFor(RID, new Date(end.getTime() + HOUR));
  assert.equal(status.inGrace, true);
  assert.equal(status.active, false);
  assert.equal(status.lastRenewalError, "Top up the wallet: you need ₹370.82 more.");
  await rejects(billing.quote({ restaurantId: RID, item: "ADDON:GMB", on: new Date(end.getTime() + HOUR) }), 409, "PLAN_NOT_ACTIVE");

  await lock.evaluateLock(RID, new Date(end.getTime() + 25 * HOUR));
  assert.ok(state.balanceDoc.lockedAt, "locked once the grace period has passed");
  assert.match(state.balanceDoc.lockedReason, /expired/);

  await topUp(500);
  assert.equal(state.sub.status, "ACTIVE", "renewed at once");
  assert.equal(state.sub.lastRenewalError, "");
  assert.equal(state.sub.currentPeriodStart.getTime(), startOfIstDay(new Date()).getTime(), "late: from the day it was paid");
  assert.equal(state.balance, 10000 + 50000 - 47082);
  assert.equal(state.balanceDoc.lockedAt, null, "and unlocked");
});

// ---------------------------------------------------------------------------
// Review fixes
// ---------------------------------------------------------------------------

test("REGRESSION: after a returned tablet lapses, the next top-up still rents a new one", async () => {
  // Removing ended tablets reused their number, and the payment key built
  // from it: the store paid its ₹4,000 top-up and could never rent again.
  reset();
  await topUp(10000);
  await topUp(4000);
  const on = addDays(state.sub.currentPeriodStart, 15);
  await billing.rentTablet({ restaurantId: RID, acceptance: YES, on });
  await billing.endTablet({ restaurantId: RID, serial: 1, on });
  const end = state.sub.currentPeriodEnd;
  await billing.renewDue(new Date(end.getTime() + MIN));
  assert.equal(state.sub.status, "ACTIVE");

  await topUp(4000);
  const again = await billing.rentTablet({ restaurantId: RID, acceptance: YES, on: addDays(end, 15) });
  assert.equal(again.already, false);
  assert.ok(again.charged > 0, "charged for the new tablet");
  assert.equal(state.sub.tabletRechargeCredits, 0);
  const live = (await billing.statusFor(RID, addDays(end, 15))).tablets;
  assert.deepEqual(live.filter((t) => t.active).map((t) => t.serial), [2], "a new number; the returned one stays, ended");
});

test("REGRESSION: a purchase whose save failed after the debit is completed by the retry, charged once", async () => {
  reset();
  await topUp(10000);
  const on = addDays(state.sub.currentPeriodStart, 15);
  state.failNextUpdate = true;
  await assert.rejects(billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: YES, on }), /simulated crash/);
  assert.equal(debits("SUBSCRIPTION").length, 2, "activation + the add-on: the money moved");
  assert.equal((await billing.statusFor(RID, on)).features.website, false);

  const retry = await billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: YES, on });
  assert.equal(retry.already, false, "granted now");
  assert.equal(retry.charged, 0, "not charged again");
  assert.equal(debits("SUBSCRIPTION").length, 2);
  assert.equal((await billing.statusFor(RID, on)).features.website, true);
});

test("REGRESSION: two rentals at once use one credit and add one tablet, even when it is free", async () => {
  reset();
  state.override = { billingExempt: false, planPrices: [{ code: "TABLET_FIRST", price: 0 }] };
  await topUp(10000);
  await topUp(4000);
  const on = addDays(state.sub.currentPeriodStart, 15);
  const results = await Promise.all([
    billing.rentTablet({ restaurantId: RID, acceptance: YES, on }),
    billing.rentTablet({ restaurantId: RID, acceptance: YES, on }),
  ]);
  assert.deepEqual(results.map((r) => r.already).sort(), [false, true]);
  assert.equal(state.sub.tablets.length, 1);
  assert.equal(state.sub.tabletRechargeCredits, 0, "never negative");
});

test("REGRESSION: backdated renewal never sells a period that has already ended", async () => {
  reset();
  state.config.renewalPolicy = "FROM_EXPIRY";
  await ledger.credit({ restaurantId: RID, kind: "RECHARGE", amountPaise: 250000, idempotencyKey: "recharge-old" });
  await billing.afterRecharge({ restaurantId: RID, amountPaise: 250000, on: new Date(Date.now() - 70 * 24 * HOUR) });
  await ledger.debit({ restaurantId: RID, kind: "ADJUSTMENT_DEBIT", amountPaise: state.balance });
  await billing.renewDue(new Date(state.sub.currentPeriodEnd.getTime() + MIN));
  assert.equal(state.sub.status, "EXPIRED");

  const renewalsBefore = state.invoices.length;
  await topUp(2000); // 40 days after the period ended
  assert.equal(state.sub.status, "ACTIVE");
  assert.ok(state.sub.currentPeriodEnd.getTime() > Date.now(), "the paid period is in the future");
  assert.equal(state.invoices.length, renewalsBefore + 1, "one renewal, not one per missed month");
  assert.equal(state.balanceDoc.lockedAt, null, "paying unlocks");
});

// ---------------------------------------------------------------------------
// Demo stores
// ---------------------------------------------------------------------------

test("a demo store gets every feature and is never charged", async () => {
  reset({ exempt: true });
  const status = await billing.statusFor(RID);
  assert.equal(status.exempt, true);
  assert.equal(status.needsActivation, false);
  assert.deepEqual(status.features, { website: true, tableQr: true, paymentGateway: true });
  assert.equal(status.nextRenewal, null);

  await topUp(100);
  for (const attempt of [
    () => billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: YES }),
    () => billing.rentTablet({ restaurantId: RID, acceptance: YES }),
    () => billing.buyPrinter({ restaurantId: RID, code: "PRINTER_2IN", acceptance: YES }),
    () => billing.quote({ restaurantId: RID, item: "TABLET" }),
  ]) {
    await assert.rejects(attempt(), /demo store/);
  }

  // Even a subscription that looks due is left alone.
  Object.assign(state.sub, { status: "ACTIVE", activatedAt: new Date("2026-01-01"), currentPeriodEnd: new Date("2026-02-01") });
  assert.equal((await billing.renewDue()).renewed, 0);
  assert.equal(debits().length, 0);
  assert.equal(state.invoices.length, 0);
  assert.equal((await lock.assessAccount(RID)).shouldLock, false);
});

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

test("SOURCE: every charge carries its idempotency key", () => {
  const src = SRC("services/subscription.js");
  for (const key of [
    "idempotencyKey: `activation-${restaurantId}`",
    "idempotencyKey: `renewal-${subscription._id}-${iso(subscription.currentPeriodEnd)}`",
    "idempotencyKey: `addon-${subscription._id}-${p.addon.code}-${iso(subscription.currentPeriodEnd)}`",
    "idempotencyKey: `tablet-${subscription._id}-${p.serial}`",
    "const key = `printer-${subscription._id}-${p.printer.code}-${n}`",
  ]) {
    assert.ok(src.includes(key), key);
  }
});

test("SOURCE: buying needs the Owner or the Store PIN; reading is scoped to the caller's own store", () => {
  const route = SRC("routes/subscriptionRoute.js");
  for (const r of ['router.post("/addons"', 'router.delete("/addons/:code"', 'router.post("/tablets"', 'router.post("/printers"', 'router.post("/renew"']) {
    assert.ok(route.includes(`${r}, isVerifiedUser, requireProtectedAction,`), r);
  }
  assert.ok(!/\/plans|\/purchase|\/installation|\/terms/.test(route), "the plan, installation and terms routes are gone");
  assert.match(route, /accepted: req\.body\?\.accepted === true/, "only a literal true accepts the terms");
});

test("SOURCE: only a real top-up reaches the activation hook, and only once", () => {
  const src = SRC("services/recharge.js");
  assert.match(src, /const \{ entry, duplicate \} = await credit\(\{\s*restaurantId: intent\.restaurantId,\s*kind: "RECHARGE",/);
  assert.match(src, /if \(!duplicate\) \{\s*try \{\s*plan = await afterRecharge\(\{ restaurantId: intent\.restaurantId, amountPaise: paidPaise \}\);/);
  assert.ok(!/afterRecharge/.test(SRC("services/ledger.js")), "a CSD credit goes through the ledger alone");
});
