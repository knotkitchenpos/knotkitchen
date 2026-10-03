/**
 * Billing v3, end to end: a top-up activates the POS plan, add-ons are bought
 * mid-period (the yearly Website whole, on its own clock), devices once, and
 * everything else renews from the wallet in one invoice -- or the store
 * expires, locks after the grace period, and the next top-up renews and
 * unlocks it.
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
    requests: [],
    failNextRequest: false,
    requestStatus: "REQUESTED",
    settled: [],
    store: { storeId: "148379", status: "active", closureReason: "" },
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
  "../models/platformBillingModel": {
    ...require("../models/platformBillingModel"),
    PlatformBillingConfig: { findOne: () => q(() => state.config) },
  },
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
        for (const [k, v] of Object.entries(update.$set || {})) {
          const [arr, , field] = k.split(".");
          const match = filter[`${arr}.key`];
          const e = (s[arr] || []).find((x) => x.key === match);
          if (e) e[field] = v;
        }
        return { matchedCount: 1, modifiedCount: 1 };
      },
    },
    PlatformInvoice: {
      exists: async ({ _id }) => (state.invoices.some((i) => String(i._id) === String(_id)) ? { _id } : null),
      create: async (d) => {
        if (state.failNextInvoice) {
          state.failNextInvoice = false;
          throw new Error("database blip");
        }
        const invoice = { _id: `inv${state.invoices.length + 1}`, ...d };
        state.invoices.push(invoice);
        return invoice;
      },
    },
    CommercialSchedule: {
      findOne: () => q(() => state.schedules[state.schedules.length - 1] || null),
      exists: async ({ reason }) => (state.schedules.some((s) => s.reason === reason) ? { _id: "cs" } : null),
      create: async (d) => {
        if (state.failNextSchedule) {
          state.failNextSchedule = false;
          throw new Error("database blip");
        }
        state.schedules.push(d);
        return d;
      },
    },
  },
  // The store row a cancellation closes: `status` is matched as given or by $nin.
  "../models/storeModel": {
    // Only "is it closed?" is ever asked (services/accountLock isStoreClosed).
    exists: async (filter) => (state.store.status === filter.status ? { _id: "st1" } : null),
    updateOne: async (filter, update) => {
      const want = filter.status;
      const ok = want === undefined || (typeof want === "string" ? state.store.status === want : !want.$nin.includes(state.store.status));
      if (!ok) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(state.store, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
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
  // The delivery side has its own tests (hardwareRequests.test.js); here, what is opened.
  "./hardwareRequests": {
    openRequest: async (a) => {
      if (state.failNextRequest) {
        state.failNextRequest = false;
        throw new Error("database blip");
      }
      state.requests.push(a);
      return { ...a, status: state.requestStatus };
    },
    settleCancellation: async (r) => (state.settled.push(r.key), r),
    defaultShipTo: (r) => ({ name: r?.name || "", phone: "", line1: "", line2: "", city: "", state: r?.address?.state || "", postalCode: "", note: "" }),
  },
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
  assert.deepEqual(invoice.lines.map((l) => [l.description, l.amountPaise]), [["POS plan — 30 days", 49900]]);
  assert.equal(invoice.totalPaise, 58882, "₹499 + 18% GST");
  // The period is today's IST midnight plus 30 days; the rest stays in the wallet.
  assert.equal(state.sub.currentPeriodStart.getTime(), startOfIstDay(new Date()).getTime());
  assert.equal(state.sub.currentPeriodEnd.getTime(), addDays(state.sub.currentPeriodStart, 30).getTime());
  assert.equal(state.balance, 200000 + 240000 + 250000 - 58882);
  assert.equal(state.balanceDoc.lockedAt, null, "and the store unlocks in the same response");

  // A second qualifying top-up never activates (or charges) again.
  await topUp(2500);
  assert.equal(state.invoices.length, 1);
  assert.equal(debits().length, 1);
});

test("after activation any top-up is fine; a demo store has no minimum and is never activated", async () => {
  reset();
  await topUp(2500);
  await topUp(100);
  assert.equal(state.balance, 250000 - 58882 + 10000);

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
  // (schedules[0] is the plan, recorded by the activation top-up.)
  assert.equal(state.schedules[1].reason, "ADDON");
  assert.equal(state.schedules[1].acceptedBy.name, "Owner");

  // A double click: already on, nothing charged.
  const again = await billing.addAddon({ restaurantId: RID, code: "TABLE_QR", acceptance: YES, on });
  assert.equal(again.already, true);
  assert.equal(again.charged, 0);
  assert.equal(state.balance, before - 11800);

  // Two requests racing: one key, one charge, one entry.
  await Promise.all([
    billing.addAddon({ restaurantId: RID, code: "GMB", acceptance: YES, on }),
    billing.addAddon({ restaurantId: RID, code: "GMB", acceptance: YES, on }),
  ]);
  assert.equal(debits("SUBSCRIPTION").filter((e) => e.meta?.addon === "GMB").length, 1);
  assert.equal(state.sub.addons.filter((a) => a.code === "GMB").length, 1);
  assert.equal(state.balance, before - 11800 - 5900);

  // What the add-ons unlock, and each one's period.
  const status = await billing.statusFor(RID, on);
  assert.deepEqual(status.features, { website: false, tableQr: true, paymentGateway: false, onlineOrdering: true });
  assert.deepEqual(
    status.addons.map((a) => [a.code, a.owned, a.active, a.periodDays, a.yearly]),
    [["TABLE_QR", true, true, 30, false], ["WEBSITE", false, false, 365, true], ["GMB", true, true, 30, false]],
  );
  assert.equal(status.addons[0].price.label, "₹200.00");
  assert.equal(status.addons[0].renewsAt.getTime(), state.sub.currentPeriodEnd.getTime(), "with the plan");
  assert.equal(status.addons[1].price.label, "₹3,600.00", "per year");
});

test("stopping an add-on keeps it to the period end without a refund; taking it back is free", async () => {
  reset();
  await topUp(10000);
  const on = addDays(state.sub.currentPeriodStart, 15);
  await billing.addAddon({ restaurantId: RID, code: "TABLE_QR", acceptance: YES, on });
  const paid = state.balance;

  const { endsAt } = await billing.removeAddon({ restaurantId: RID, code: "TABLE_QR", on });
  assert.equal(endsAt.getTime(), state.sub.currentPeriodEnd.getTime());
  assert.equal(state.balance, paid, "no refund");
  let status = await billing.statusFor(RID, on);
  assert.equal(status.features.tableQr, true, "still works until the period ends");
  assert.equal(status.addons.find((a) => a.code === "TABLE_QR").renewsAt, null);
  assert.ok(!status.nextRenewal.lines.some((l) => /QR Table/.test(l.description)), "and is not renewed");
  assert.equal((await billing.statusFor(RID, state.sub.currentPeriodEnd)).features.tableQr, false);

  // Changed their mind within the period: back on, nothing charged, no terms to accept again.
  const back = await billing.addAddon({ restaurantId: RID, code: "TABLE_QR", acceptance: null, on });
  assert.equal(back.charged, 0);
  assert.equal(state.balance, paid);
  status = await billing.statusFor(RID, on);
  assert.equal(status.addons.find((a) => a.code === "TABLE_QR").endsAt, null);
  assert.ok(status.nextRenewal.lines.some((l) => /QR Table/.test(l.description)));
});

// ---------------------------------------------------------------------------
// The yearly Website: its own period, its own renewal
// ---------------------------------------------------------------------------

test("the Website is bought whole for a year from today, never prorated, and stays off the POS renewal", async () => {
  reset();
  await topUp(10000);
  const on = addDays(state.sub.currentPeriodStart, 15);
  const quoted = await billing.quote({ restaurantId: RID, item: "ADDON:WEBSITE", on });
  assert.deepEqual([quoted.lines[0].amountPaise, quoted.totalPaise], [360000, 424800], "₹3,600 + GST, whatever is left of the POS period");

  const bought = await billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: YES, on });
  assert.equal(bought.charged, 424800);
  const yearEnd = addDays(on, 365);
  const entry = state.sub.addons.find((a) => a.code === "WEBSITE");
  assert.deepEqual([entry.periodDays, entry.paidUntil.getTime()], [365, yearEnd.getTime()]);
  const invoice = state.invoices.at(-1);
  assert.deepEqual([invoice.kind, invoice.periodStart.getTime(), invoice.periodEnd.getTime()], ["ADDON", on.getTime(), yearEnd.getTime()]);
  assert.equal(debits().at(-1).idempotencyKey, `addon-sub1-WEBSITE-${yearEnd.toISOString()}`, "keyed on its own period");
  assert.deepEqual(state.schedules.at(-1).values.item, { addon: "WEBSITE", name: "Website", pricePaise: 360000, periodDays: 365 });

  const site = (await billing.statusFor(RID, on)).addons.find((a) => a.code === "WEBSITE");
  assert.deepEqual([site.yearly, site.periodDays, site.active], [true, 365, true]);
  assert.equal(site.renewsAt.getTime(), yearEnd.getTime());
  assert.equal(site.paidUntil.getTime(), yearEnd.getTime());

  // The 30-day renewal is the plan alone; the Website keeps its year.
  const end = state.sub.currentPeriodEnd;
  assert.equal((await billing.statusFor(RID, on)).nextRenewal.total.paise, 58882);
  await billing.renewDue(new Date(end.getTime() + MIN));
  assert.deepEqual(state.invoices.at(-1).lines.map((l) => l.description), ["POS plan — 30 days"]);
  assert.equal(entry.paidUntil.getTime(), yearEnd.getTime());

  // Stopped, it runs to the end of the year paid -- not the POS period.
  const { endsAt } = await billing.removeAddon({ restaurantId: RID, code: "WEBSITE", on });
  assert.equal(endsAt.getTime(), yearEnd.getTime());
  assert.equal((await billing.statusFor(RID, addDays(yearEnd, -1))).features.website, true);
  assert.equal((await billing.statusFor(RID, yearEnd)).features.website, false);
});

test("a yearly add-on renews on its own date: on time from its end, late from the day paid, short only it lapses", async () => {
  reset();
  await topUp(20000);
  const start = state.sub.currentPeriodStart;
  await billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: YES, on: addDays(start, 1) });
  const entry = state.sub.addons.find((a) => a.code === "WEBSITE");

  // On time (the paid year ending inside this POS period, for the test).
  entry.paidUntil = addDays(start, 10);
  let r = await billing.renewDue(new Date(addDays(start, 10).getTime() + MIN));
  assert.deepEqual([r.renewed, r.addonsRenewed], [0, ["WEBSITE"]], "the plan is not due; the Website is");
  const invoice = state.invoices.at(-1);
  assert.deepEqual([invoice.kind, invoice.totalPaise, invoice.periodStart.getTime()], ["ADDON", 424800, addDays(start, 10).getTime()]);
  assert.equal(debits().at(-1).idempotencyKey, `addon-renewal-sub1-WEBSITE-${addDays(start, 10).toISOString()}`);
  assert.equal(entry.paidUntil.getTime(), addDays(start, 375).getTime(), "continuous");
  assert.equal(state.sub.currentPeriodEnd.getTime(), addDays(start, 30).getTime(), "the POS period is untouched");

  // Two days late: the new year starts the day it is paid.
  entry.paidUntil = addDays(start, 11);
  await billing.renewDue(addDays(start, 13));
  assert.equal(entry.paidUntil.getTime(), addDays(start, 13 + 365).getTime());

  // Short: only the Website lapses. The POS runs on, unlocked.
  entry.paidUntil = addDays(start, 14);
  await ledger.debit({ restaurantId: RID, kind: "ADJUSTMENT_DEBIT", amountPaise: state.balance - 10000 });
  const on = addDays(start, 15);
  r = await billing.renewDue(on);
  assert.deepEqual(r.addonErrors, [{ code: "WEBSITE", message: "Top up the wallet: you need ₹4,148.00 more." }]);
  assert.equal(entry.lastRenewalError, "Top up the wallet: you need ₹4,148.00 more.");
  let status = await billing.statusFor(RID, on);
  assert.equal(status.features.website, false);
  assert.deepEqual([status.status, status.active], ["ACTIVE", true]);
  const site = status.addons.find((a) => a.code === "WEBSITE");
  assert.deepEqual([site.owned, site.active, site.lastRenewalError], [true, false, "Top up the wallet: you need ₹4,148.00 more."]);
  assert.equal((await lock.assessAccount(RID, on)).shouldLock, false);

  // Retried every sweep, without writing the same reason again.
  let saves = 0;
  state.sub.save = async function save() {
    saves += 1;
    return this;
  };
  await billing.renewDue(new Date(on.getTime() + MIN));
  assert.equal(saves, 0);

  // The next top-up renews it, from the day it is paid.
  await ledger.credit({ restaurantId: RID, kind: "RECHARGE", amountPaise: 500000, idempotencyKey: "recharge-late" });
  await billing.afterRecharge({ restaurantId: RID, amountPaise: 500000, on });
  assert.equal(entry.paidUntil.getTime(), addDays(on, 365).getTime());
  assert.equal(entry.lastRenewalError, "");
  assert.equal((await billing.statusFor(RID, on)).features.website, true);
});

test("a yearly add-on whose catalogue went back to the POS period renews its own year at the per-day rate", async () => {
  reset();
  await topUp(20000);
  const start = state.sub.currentPeriodStart;
  await billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: YES, on: addDays(start, 1) });
  const entry = state.sub.addons.find((a) => a.code === "WEBSITE");
  // CSD's Billing period select: Website on the POS period again, ₹300 per 30 days.
  Object.assign(state.config.addons.find((a) => a.code === "WEBSITE"), { periodDays: null, pricePaise: 30000 });
  entry.paidUntil = addDays(start, 10);
  const on = new Date(addDays(start, 10).getTime() + MIN);

  const site = (await billing.statusFor(RID, on)).addons.find((a) => a.code === "WEBSITE");
  assert.deepEqual([site.periodDays, site.price.paise], [365, 365000], "shown as what the year will cost");
  const r = await billing.renewDue(on);
  assert.deepEqual(r.addonsRenewed, ["WEBSITE"]);
  const invoice = state.invoices.at(-1);
  assert.deepEqual([invoice.lines[0].amountPaise, invoice.totalPaise], [365000, 430700], "₹300 × 365/30 + GST, not ₹300 for a year");
  assert.equal(entry.paidUntil.getTime(), addDays(start, 375).getTime());
});

test("a yearly add-on never renews while the POS is being cancelled: it ends with its paid year", async () => {
  reset();
  await topUp(10000);
  const start = state.sub.currentPeriodStart;
  await billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: YES, on: addDays(start, 1) });
  const entry = state.sub.addons.find((a) => a.code === "WEBSITE");
  entry.paidUntil = addDays(start, 20);
  await billing.cancelSubscription({ restaurantId: RID, reason: "Moving out", by: { type: "RESTAURANT", name: "Owner" }, on: addDays(start, 5) });

  const debitsBefore = debits().length;
  await billing.renewDue(new Date(addDays(start, 20).getTime() + MIN));
  assert.equal(debits().length, debitsBefore, "nothing charged");
  assert.equal(entry.endsAt.getTime(), addDays(start, 20).getTime());
  assert.equal((await billing.statusFor(RID, addDays(start, 21))).features.website, false);
});

test("a Website bought monthly before it went yearly leaves the plan at its next renewal and is billed a year then", async () => {
  reset();
  await topUp(10000);
  const end = state.sub.currentPeriodEnd;
  state.sub.addons.push({ code: "WEBSITE", name: "Website", feature: "website", pricePaise: 30000, activatedAt: state.sub.currentPeriodStart, endsAt: null });
  const status = await billing.statusFor(RID);
  assert.equal(status.nextRenewal.total.paise, 58882, "no longer a 30-day line");
  const site = status.addons.find((a) => a.code === "WEBSITE");
  assert.deepEqual([site.yearly, site.periodDays, site.paidUntil], [true, 365, null]);
  assert.equal(site.renewsAt.getTime(), end.getTime(), "it moves to its own clock at the plan's renewal");

  await lock.sweepLocks(new Date(end.getTime() + MIN));
  const [plan, website] = state.invoices.slice(-2);
  assert.deepEqual(plan.lines.map((l) => l.description), ["POS plan — 30 days"]);
  assert.deepEqual([website.kind, website.totalPaise, website.periodStart.getTime()], ["ADDON", 424800, end.getTime()]);
  const entry = state.sub.addons.find((a) => a.code === "WEBSITE");
  assert.deepEqual([entry.periodDays, entry.paidUntil.getTime()], [365, addDays(end, 365).getTime()]);
});

// ---------------------------------------------------------------------------
// Devices: tablets and printers
// ---------------------------------------------------------------------------

test("a tablet is bought once, online, like a printer: ₹10,000 including GST; renting one is gone", async () => {
  reset();
  await topUp(10000);
  for (const item of ["TABLET", "PRINTER:TABLET"]) {
    const quoted = await billing.quote({ restaurantId: RID, item });
    assert.deepEqual(quoted.lines.map((l) => [l.description, l.amountPaise]), [["Tablet (one-time purchase)", 1000000]], item);
    assert.equal(quoted.totalPaise, 1000000, "GST included, nothing on top");
  }
  assert.equal("rentTablet" in billing, false);

  const walletBefore = state.balance;
  const opened = await recharge.createPrinterPayment({ restaurantId: RID, code: "TABLET", acceptance: YES });
  assert.equal(opened.amountPaise, 1000000);
  state.paid[opened.gatewayOrderId] = 10000;
  await recharge.finalizeRecharge({ gatewayOrderId: opened.gatewayOrderId });
  assert.equal(state.balance, walletBefore, "the wallet is untouched");
  assert.deepEqual(state.sub.hardware.map((h) => [h.code, h.name, h.totalPaise]), [["TABLET", "Tablet", 1000000]]);
  const inv = state.invoices.at(-1);
  assert.deepEqual([inv.kind, inv.subtotalPaise, inv.totalTaxPaise, inv.totalPaise], ["HARDWARE", 847458, 152542, 1000000]);
  const [request] = state.requests;
  assert.deepEqual([request.type, request.key, request.item.code], ["TABLET", `printer-pay-${opened.gatewayOrderId}`, "TABLET"], "a TABLET request, paid via the gateway");

  const status = await billing.statusFor(RID);
  assert.equal(status.printers.find((p) => p.code === "TABLET").owned, 1);
  assert.deepEqual(Object.keys(status.tablet).sort(), ["extraPrice", "firstPrice"], "only what rented tablets renew at");
  assert.equal(status.nextRenewal.lines.length, 1, "a bought tablet never renews");

  const route = SRC("routes/subscriptionRoute.js");
  assert.match(route, /router\.post\("\/tablets", isVerifiedUser, \(req, res, next\) =>\s*next\(createHttpError\(409, "Tablets are now bought once, like printers\.", \{ code: "TABLET_NOW_PURCHASED" \}\)\)/);
});

test("a printer is paid through the gateway, never the wallet: recorded once with its invoice, never renewed", async () => {
  reset();
  await topUp(10000);
  await rejects(recharge.createPrinterPayment({ restaurantId: RID, code: "PRINTER_2IN", acceptance: null }), 409, "ACCEPTANCE_REQUIRED");
  await rejects(recharge.createPrinterPayment({ restaurantId: RID, code: "PRINTER_9IN", acceptance: YES }), 404);

  const walletBefore = state.balance;
  const debitsBefore = debits().length;
  const opened = await recharge.createPrinterPayment({ restaurantId: RID, code: "PRINTER_2IN", acceptance: YES });
  assert.equal(opened.amountPaise, 170000, "₹1,700, GST included: nothing is added on top");
  assert.equal(opened.purpose, "PRINTER");
  assert.equal(state.sub.hardware.length, 0, "nothing is recorded before Cashfree says paid");

  state.paid[opened.gatewayOrderId] = 1700;
  const done = await recharge.finalizeRecharge({ gatewayOrderId: opened.gatewayOrderId });
  assert.equal(done.purchased, true);
  assert.equal(done.credited, false, "not a top-up");
  assert.equal(state.balance, walletBefore, "the wallet is untouched");
  assert.equal(debits().length, debitsBefore, "no wallet debit");
  assert.equal(state.invoices[state.invoices.length - 1].kind, "HARDWARE");
  assert.deepEqual(state.sub.hardware.map((h) => [h.code, h.pricePaise, h.totalPaise]), [["PRINTER_2IN", 170000, 170000]]);
  assert.equal(state.sub.hardware[0].invoiceId, state.invoices[state.invoices.length - 1]._id);
  // Registered: the invoice shows the GST contained in the price, never added to it.
  const inv = state.invoices[state.invoices.length - 1];
  assert.deepEqual([inv.subtotalPaise, inv.totalTaxPaise, inv.totalPaise], [144068, 25932, 170000]);
  assert.equal(inv.cgstPaise + inv.sgstPaise, 25932);
  assert.equal(state.requests[0].type, "PRINTER");

  assert.equal(state.settled.length, 0, "an open request is left alone");

  // The webhook arriving after the return records nothing twice.
  const invoices = state.invoices.length;
  state.intents[state.intents.length - 1].status = "CREATED";
  const again = await recharge.finalizeRecharge({ gatewayOrderId: opened.gatewayOrderId });
  assert.equal(again.already, true);
  assert.equal(again.purchased, true, "the till checking after the webhook is told it was bought");
  state.intents[state.intents.length - 1].status = "PAID";
  const settled = await recharge.finalizeRecharge({ gatewayOrderId: opened.gatewayOrderId });
  assert.deepEqual([settled.already, settled.purchased], [true, true]);
  assert.equal(state.sub.hardware.length, 1);
  assert.equal(state.invoices.length, invoices);
  const status = await billing.statusFor(RID);
  assert.equal(status.printers.find((p) => p.code === "PRINTER_2IN").owned, 1);
  assert.ok(!status.nextRenewal.lines.some((l) => /printer/i.test(l.description)));
});

test("a paid device opens one delivery request, to the address given, and never before it is paid", async () => {
  reset();
  await topUp(10000);
  const shipTo = { name: "Asha", phone: "9830012345", line1: "12 Park St", city: "Kolkata", state: "West Bengal", postalCode: "700016" };

  const opened = await recharge.createPrinterPayment({ restaurantId: RID, code: "PRINTER_3IN", acceptance: YES, shipTo });
  assert.equal(state.intents.at(-1).item.shipTo, shipTo, "the address rides on the payment");
  assert.equal(state.requests.length, 0, "nothing is requested before Cashfree says paid");
  state.paid[opened.gatewayOrderId] = opened.amountPaise / 100;
  await recharge.finalizeRecharge({ gatewayOrderId: opened.gatewayOrderId });
  const printer = state.requests[0];
  assert.deepEqual(
    [printer.type, printer.key, printer.payment.amountPaise, printer.item.code],
    ["PRINTER", `printer-pay-${opened.gatewayOrderId}`, opened.amountPaise, "PRINTER_3IN"],
  );
  assert.equal(printer.shipTo, shipTo);

  // A request that fails to open never fails what was paid for; Billing opens it later.
  const tablet = await recharge.createPrinterPayment({ restaurantId: RID, code: "TABLET", acceptance: YES, shipTo });
  state.paid[tablet.gatewayOrderId] = tablet.amountPaise / 100;
  state.failNextRequest = true;
  const done = await recharge.finalizeRecharge({ gatewayOrderId: tablet.gatewayOrderId });
  assert.equal(done.purchased, true);
  assert.equal(state.sub.hardware.length, 2);

  // A cancelled printer is no longer owned.
  state.sub.hardware[0].cancelledAt = new Date();
  const status = await billing.statusFor(RID);
  assert.equal(status.printers.find((p) => p.code === "PRINTER_3IN").owned, 0);
  assert.equal(status.hardware[0].cancelled, true);
  assert.ok(status.shipTo, "Billing gets the store's own address to start from");
});

test("REGRESSION: a paid printer whose invoice failed gets it on the next confirmation, once", async () => {
  reset();
  await topUp(10000);
  const opened = await recharge.createPrinterPayment({ restaurantId: RID, code: "PRINTER_3IN", acceptance: YES });
  state.paid[opened.gatewayOrderId] = opened.amountPaise / 100;
  const invoices = state.invoices.length;
  state.failNextInvoice = true;
  await assert.rejects(recharge.finalizeRecharge({ gatewayOrderId: opened.gatewayOrderId }), /database blip/);
  assert.equal(state.sub.hardware.length, 1, "the printer was recorded");
  assert.equal(state.invoices.length, invoices, "but its invoice was not");

  const retry = await recharge.finalizeRecharge({ gatewayOrderId: opened.gatewayOrderId });
  assert.equal(retry.purchased, true);
  assert.equal(state.invoices.length, invoices + 1, "the webhook or the till's retry issues it");
  assert.equal(String(state.invoices[state.invoices.length - 1]._id), String(state.sub.hardware[0].invoiceId));
  assert.equal(state.invoices[state.invoices.length - 1].totalPaise, opened.amountPaise, "exactly what Cashfree charged");
  state.intents[state.intents.length - 1].status = "CREATED";
  await recharge.finalizeRecharge({ gatewayOrderId: opened.gatewayOrderId });
  assert.equal(state.invoices.length, invoices + 1, "never a second one");
});

test("REGRESSION: a printer cancelled and refunded before its invoice existed has the late invoice settled too", async () => {
  reset();
  await topUp(10000);
  const opened = await recharge.createPrinterPayment({ restaurantId: RID, code: "PRINTER_2IN", acceptance: YES });
  state.paid[opened.gatewayOrderId] = opened.amountPaise / 100;
  state.failNextInvoice = true;
  await assert.rejects(recharge.finalizeRecharge({ gatewayOrderId: opened.gatewayOrderId }), /database blip/);
  // Billing opened the request from the printer row and the store cancelled it.
  state.requestStatus = "CANCELLED";
  await recharge.finalizeRecharge({ gatewayOrderId: opened.gatewayOrderId });
  assert.equal(state.invoices.at(-1).kind, "HARDWARE", "the missing invoice is issued now");
  assert.deepEqual(state.settled, [`printer-pay-${opened.gatewayOrderId}`], "and the cancellation is applied to it");
});

test("a Rs 0 printer is refused before anything is recorded", async () => {
  reset();
  state.override = { billingExempt: false, planPrices: [{ code: "PRINTER_2IN", price: 0 }] };
  await topUp(10000);
  const schedules = state.schedules.length;
  await rejects(recharge.createPrinterPayment({ restaurantId: RID, code: "PRINTER_2IN", acceptance: YES }), 409);
  assert.equal(state.schedules.length, schedules, "no acceptance left behind");
  assert.equal(state.intents.filter((i) => i.purpose === "PRINTER").length, 0);
});

// ---------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------

test("at the period end the plan, add-ons and rented tablets renew from the wallet in one invoice", async () => {
  reset();
  await topUp(10000);
  const on = addDays(state.sub.currentPeriodStart, 15);
  await billing.addAddon({ restaurantId: RID, code: "TABLE_QR", acceptance: YES, on });
  await billing.addAddon({ restaurantId: RID, code: "GMB", acceptance: YES, on });
  // A tablet rented before tablets were sold keeps renewing at its rental price.
  state.sub.tablets.push({ serial: 1, pricePaise: 60000, rentedAt: on, endsAt: null });
  await billing.removeAddon({ restaurantId: RID, code: "GMB", on });

  const end = state.sub.currentPeriodEnd;
  const quoted = (await billing.statusFor(RID, on)).nextRenewal;
  assert.equal(quoted.total.paise, 153282);
  const before = state.balance;
  const invoicesBefore = state.invoices.length;

  // The 15-minute sweep does it.
  await lock.sweepLocks(new Date(end.getTime() + MIN));
  assert.equal(state.invoices.length, invoicesBefore + 1, "one invoice");
  const invoice = state.invoices[state.invoices.length - 1];
  assert.equal(invoice.kind, "SUBSCRIPTION");
  assert.deepEqual(invoice.lines.map((l) => [l.description, l.amountPaise]), [
    ["POS plan — 30 days", 49900],
    ["QR Table Ordering add-on — 30 days", 20000],
    ["Tablet #1 rental — 30 days", 60000],
  ]);
  assert.equal(invoice.totalPaise, 153282, "each line + GST; the stopped GMB add-on lapsed");
  assert.equal(invoice.totalPaise, quoted.total.paise, "what Billing said it would be");
  assert.equal(state.balance, before - 153282);
  assert.equal(state.sub.status, "ACTIVE");
  assert.equal(state.sub.currentPeriodStart.getTime(), end.getTime(), "on time: continuous from the old end");
  assert.equal(state.sub.currentPeriodEnd.getTime(), addDays(end, 30).getTime());
  assert.deepEqual(state.sub.addons.map((a) => a.code), ["TABLE_QR"]);

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
  assert.equal(state.sub.lastRenewalError, "Top up the wallet: you need ₹488.82 more.");
  assert.equal(state.balance, 10000, "all or nothing: nothing taken");
  assert.equal(state.invoices.length, 1);

  const inGrace = await lock.assessAccount(RID, new Date(end.getTime() + 23 * HOUR));
  assert.equal(inGrace.shouldLock, false);
  assert.match(inGrace.lockWarning, /subscription has ended/);
  const status = await billing.statusFor(RID, new Date(end.getTime() + HOUR));
  assert.equal(status.inGrace, true);
  assert.equal(status.active, false);
  assert.equal(status.lastRenewalError, "Top up the wallet: you need ₹488.82 more.");
  await rejects(billing.quote({ restaurantId: RID, item: "ADDON:GMB", on: new Date(end.getTime() + HOUR) }), 409, "PLAN_NOT_ACTIVE");

  await lock.evaluateLock(RID, new Date(end.getTime() + 25 * HOUR));
  assert.ok(state.balanceDoc.lockedAt, "locked once the grace period has passed");
  assert.match(state.balanceDoc.lockedReason, /expired/);

  await topUp(500);
  assert.equal(state.sub.status, "ACTIVE", "renewed at once");
  assert.equal(state.sub.lastRenewalError, "");
  assert.equal(state.sub.currentPeriodStart.getTime(), startOfIstDay(new Date()).getTime(), "late: from the day it was paid");
  assert.equal(state.balance, 10000 + 50000 - 58882);
  assert.equal(state.balanceDoc.lockedAt, null, "and unlocked");
});

// ---------------------------------------------------------------------------
// Review fixes
// ---------------------------------------------------------------------------

test("a rented tablet CSD ended stops renewing, and stays listed so its number never repeats", async () => {
  reset();
  await topUp(10000);
  const on = addDays(state.sub.currentPeriodStart, 15);
  state.sub.tablets.push({ serial: 1, pricePaise: 60000, rentedAt: on, endsAt: null });
  await billing.endTablet({ restaurantId: RID, serial: 1, on });
  const end = state.sub.currentPeriodEnd;
  await billing.renewDue(new Date(end.getTime() + MIN));
  assert.equal(state.sub.status, "ACTIVE");
  assert.ok(!state.invoices.at(-1).lines.some((l) => /Tablet/.test(l.description)));
  const tablets = (await billing.statusFor(RID, addDays(end, 15))).tablets;
  assert.deepEqual(tablets.map((t) => [t.serial, t.active]), [[1, false]]);
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

test("a stored FROM_EXPIRY reads as FROM_PAYMENT, and nothing is written for it", async () => {
  reset();
  let saves = 0;
  Object.assign(state.config, { renewalPolicy: "FROM_EXPIRY", save: async () => { saves += 1; } });
  const config = await require("../services/pricing").getPlatformConfig();
  assert.equal(config.renewalPolicy, "FROM_PAYMENT");
  assert.equal(saves, 0);
});

test("a late renewal always starts the day it is paid, whatever the config row holds", async () => {
  reset();
  // A row that insists on FROM_EXPIRY, even past the read normalisation.
  Object.defineProperty(state.config, "renewalPolicy", { get: () => "FROM_EXPIRY", set: () => {}, enumerable: true, configurable: true });
  await ledger.credit({ restaurantId: RID, kind: "RECHARGE", amountPaise: 250000, idempotencyKey: "recharge-old" });
  await billing.afterRecharge({ restaurantId: RID, amountPaise: 250000, on: new Date(Date.now() - 35 * 24 * HOUR) });
  const end = state.sub.currentPeriodEnd;
  assert.ok(end.getTime() < Date.now() - 4 * 24 * HOUR, "five days late, inside what FROM_EXPIRY would backdate");
  await billing.renewDue();
  assert.equal(state.sub.status, "ACTIVE");
  assert.equal(state.sub.currentPeriodStart.getTime(), startOfIstDay(new Date()).getTime(), "FROM_PAYMENT: from today");
});

test("CSD closed the store mid-period: the Owner is sent to support, CSD to Store status", async () => {
  reset();
  await topUp(10000);
  const on = addDays(state.sub.currentPeriodStart, 10);
  // What csdStoreController does on close: the status first, then the cancel.
  state.store.status = "closed";
  await billing.cancelSubscription({ restaurantId: RID, reason: "Store closed in CSD", by: CSD, on });
  assert.equal(state.sub.status, "ACTIVE", "runs to its period end");
  assert.equal((await billing.statusFor(RID, on)).storeClosed, true, "so both UIs can hide Undo");

  await rejects(billing.reinstateSubscription({ restaurantId: RID, by: OWNER }), 409, "CONTACT_SUPPORT");
  await assert.rejects(billing.reinstateSubscription({ restaurantId: RID, by: CSD }), (err) => {
    assert.equal(err.status, 409);
    assert.equal(err.code, "STORE_CLOSED");
    assert.equal(err.message, "Re-open the store from Store status.");
    return true;
  });
  assert.ok(state.sub.cancelAt, "still set to end");

  // Re-opening from Store status saves the status first, then reinstates.
  state.store.status = "active";
  await billing.reinstateSubscription({ restaurantId: RID, by: CSD });
  assert.equal(state.sub.cancelAt, null);
});

// ---------------------------------------------------------------------------
// Demo stores
// ---------------------------------------------------------------------------

test("a demo store gets every feature and is never charged", async () => {
  reset({ exempt: true });
  const status = await billing.statusFor(RID);
  assert.equal(status.exempt, true);
  assert.equal(status.needsActivation, false);
  assert.deepEqual(status.features, { website: true, tableQr: true, paymentGateway: true, onlineOrdering: true });
  assert.equal(status.nextRenewal, null);

  await topUp(100);
  for (const attempt of [
    () => billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: YES }),
    () => billing.preparePrinterPayment({ restaurantId: RID, code: "TABLET", acceptance: YES }),
    () => billing.preparePrinterPayment({ restaurantId: RID, code: "PRINTER_2IN", acceptance: YES }),
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
// Activation record, invoice parties, printer GST
// ---------------------------------------------------------------------------

test("activation records the plan taken, once, under the current agreement, and never fails for it", async () => {
  reset();
  await topUp(2500);
  const rows = state.schedules.filter((s) => s.reason === "SUBSCRIPTION");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agreementVersion, "v3.0");
  assert.deepEqual(rows[0].values.item, { plan: "POS", name: "POS", pricePaise: 49900, periodDays: 30, acceptedVia: "ACTIVATION_TOP_UP" });
  assert.equal(rows[0].values.totalPaise, 58882);
  // A retried activation (the save lost after the debit) does not record it twice.
  state.sub.activatedAt = null;
  await billing.activate({ restaurantId: RID });
  assert.equal(state.schedules.filter((s) => s.reason === "SUBSCRIPTION").length, 1);

  reset();
  state.failNextSchedule = true;
  const ok = await topUp(2500);
  assert.equal(ok.plan.activated, true, "the record failing never stops the plan");
  assert.equal(state.sub.status, "ACTIVE");
});

test("the invoice names the store by its legal name, with its GSTIN only when it is GST-registered", async () => {
  reset();
  Object.assign(state.restaurant, {
    legalName: "Spice Garden Foods LLP",
    taxId: "19ABCDE1234F1Z5",
    gstRegistered: true,
    address: { line1: "12 Park St", city: "Kolkata", postalCode: "700016", state: "West Bengal" },
  });
  await topUp(2500);
  const { buyer, seller } = state.invoices[0];
  assert.deepEqual([buyer.name, buyer.gstin], ["Spice Garden Foods LLP", "19ABCDE1234F1Z5"]);
  assert.deepEqual(buyer.addressLines, ["12 Park St", "Kolkata – 700016"]);
  assert.equal(seller.name, "KnotKitchen");
  assert.deepEqual(seller.addressLines, ["J/183 Baishnabghata Patuli", "Kolkata – 700094"]);

  reset();
  Object.assign(state.restaurant, { taxId: "19ABCDE1234F1Z5", gstRegistered: false });
  await topUp(2500);
  assert.deepEqual([state.invoices[0].buyer.name, state.invoices[0].buyer.gstin], ["Spice Garden", ""]);
});

test("before GST registration a printer costs its price with no GST, and its invoice says so", async () => {
  reset();
  state.config.gst = { registered: false, percent: 0 };
  await topUp(2500);
  const opened = await recharge.createPrinterPayment({ restaurantId: RID, code: "PRINTER_3IN", acceptance: YES });
  assert.equal(opened.amountPaise, 430000);
  state.paid[opened.gatewayOrderId] = 4300;
  await recharge.finalizeRecharge({ gatewayOrderId: opened.gatewayOrderId });
  const inv = state.invoices.at(-1);
  assert.deepEqual([inv.subtotalPaise, inv.totalTaxPaise, inv.totalPaise], [430000, 0, 430000]);
  assert.equal(state.invoices[0].totalPaise, 49900, "and nothing else carries GST either");

  const html = require("../services/invoiceDocument").renderInvoice(inv);
  assert.ok(!html.includes("TAX INVOICE"));
  assert.match(html, /not registered under GST/);
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

const OWNER = { type: "RESTAURANT", name: "Owner" };
const CSD = { type: "CSD", name: "Ria" };

test("a cancelled subscription runs to its period end, sells nothing new, then is CANCELLED and the store closed", async () => {
  reset();
  await topUp(10000);
  const on = addDays(state.sub.currentPeriodStart, 10);
  const end = state.sub.currentPeriodEnd;

  const { already } = await billing.cancelSubscription({ restaurantId: RID, reason: "Moving out", by: OWNER, on });
  assert.equal(already, false);
  assert.equal(state.sub.status, "ACTIVE", "still running until the paid period ends");
  assert.equal(state.sub.cancelAt.getTime(), end.getTime());
  const status = await billing.statusFor(RID, on);
  assert.equal(status.cancelAt.getTime(), end.getTime());
  assert.equal(status.cancelReason, "Moving out");
  assert.deepEqual(status.cancelledBy, OWNER);
  assert.equal(status.nextRenewal, null, "it will not renew");

  await rejects(billing.addAddon({ restaurantId: RID, code: "GMB", acceptance: YES, on }), 409, "SUBSCRIPTION_ENDING");
  await rejects(billing.addAddon({ restaurantId: RID, code: "WEBSITE", acceptance: YES, on }), 409, "SUBSCRIPTION_ENDING");
  assert.equal((await billing.cancelSubscription({ restaurantId: RID, by: OWNER, on })).already, true, "asking twice changes nothing");

  // A top-up opened while it was still running, and paid only after it closed.
  const { gatewayOrderId: lateTopUp } = await recharge.createRecharge({ restaurantId: RID, amountPaise: 250000 });
  state.paid[lateTopUp] = 2500;

  const debitsBefore = debits().length;
  await lock.sweepLocks(new Date(end.getTime() + MIN));
  assert.equal(state.sub.status, "CANCELLED");
  assert.equal(state.sub.cancelledAt.getTime(), end.getTime() + MIN);
  assert.equal(debits().length, debitsBefore, "nothing debited at the end");
  assert.equal(state.store.status, "closed");
  assert.equal(state.store.closureReason, "Moving out");
  assert.ok(state.balanceDoc.lockedAt, "locked at once");
  assert.ok(state.balance > 0, "the unused balance stays in the (non-refundable) wallet");

  // N2: no new top-up is opened for a closed store...
  await rejects(recharge.createRecharge({ restaurantId: RID, amountPaise: 250000 }), 409, "SUBSCRIPTION_CANCELLED");
  assert.equal((await billing.statusFor(RID)).topUpBlocked, true);
  // ...but money already paid is never lost: it is credited, and never brings the plan back.
  const before = state.balance;
  const late = await recharge.finalizeRecharge({ gatewayOrderId: lateTopUp });
  assert.equal(late.credited, true);
  assert.equal(state.balance, before + 250000);
  assert.equal(state.sub.status, "CANCELLED");
  assert.equal(debits().length, debitsBefore);
  assert.equal(state.balanceDoc.lockedReason, lock.STORE_CLOSED_MESSAGE, "still locked, as closed");
});

test("the restaurant can undo its cancellation until it takes effect; after that only CSD, which reopens the store", async () => {
  reset();
  await topUp(10000);
  const on = addDays(state.sub.currentPeriodStart, 10);
  const end = state.sub.currentPeriodEnd;
  await billing.cancelSubscription({ restaurantId: RID, by: OWNER, on });
  await billing.reinstateSubscription({ restaurantId: RID, by: OWNER });
  assert.equal(state.sub.cancelAt, null);
  assert.ok((await billing.statusFor(RID, on)).nextRenewal, "renewing again");
  await billing.renewDue(new Date(end.getTime() + MIN));
  assert.equal(state.sub.status, "ACTIVE", "and it renewed");

  // CSD's cancellation is CSD's to undo. This plan's period ended two days ago.
  reset();
  await ledger.credit({ restaurantId: RID, kind: "RECHARGE", amountPaise: 250000, idempotencyKey: "recharge-old" });
  await billing.afterRecharge({ restaurantId: RID, amountPaise: 250000, on: new Date(Date.now() - 32 * 24 * HOUR) });
  const lastEnd = state.sub.currentPeriodEnd;
  await billing.cancelSubscription({ restaurantId: RID, reason: "Closed by CSD", by: CSD, on: new Date(lastEnd.getTime() - 24 * HOUR) });
  await rejects(billing.reinstateSubscription({ restaurantId: RID, by: OWNER }), 409, "CONTACT_SUPPORT");

  Object.assign(state.store, { status: "closed", closureReason: "Closed in CSD" }); // CSD closed the store itself
  await billing.renewDue();
  assert.equal(state.sub.status, "CANCELLED");
  assert.deepEqual([state.store.status, state.store.closureReason], ["closed", "Closed in CSD"], "CSD's own reason is kept");
  await rejects(billing.reinstateSubscription({ restaurantId: RID, by: OWNER }), 409, "CONTACT_SUPPORT");

  await billing.reinstateSubscription({ restaurantId: RID, by: CSD });
  assert.equal(state.sub.status, "EXPIRED", "the next top-up renews it");
  assert.equal(state.store.status, "active", "the store is reopened");
  await topUp(500);
  assert.equal(state.sub.status, "ACTIVE");
  assert.equal(state.balanceDoc.lockedAt, null);
});

test("cancelling a store with no running period ends it at once, and a top-up never activates it", async () => {
  reset();
  await billing.cancelSubscription({ restaurantId: RID, reason: "Never opened", by: CSD });
  assert.equal(state.sub.status, "CANCELLED");
  assert.equal(state.store.status, "closed");
  await rejects(recharge.createRecharge({ restaurantId: RID, amountPaise: 250000 }), 409, "SUBSCRIPTION_CANCELLED");
  assert.equal(state.sub.status, "CANCELLED");
  assert.equal(state.invoices.length, 0);
  await billing.reinstateSubscription({ restaurantId: RID, by: CSD });
  assert.equal(state.sub.status, "NONE", "never activated: back to waiting for its first top-up");
  await rejects(billing.cancelSubscription({ restaurantId: RID, by: { type: "SOMEONE" } }), 400);
});

test("N1: a store closed by CSD is locked at once, never renews, and cannot top up", async () => {
  reset();
  await topUp(10000);
  const end = state.sub.currentPeriodEnd;
  // CSD closed it, but cancelling its renewals failed (no cancelAt set).
  state.store.status = "closed";
  await lock.evaluateLock(RID);
  assert.equal(state.balanceDoc.lockedReason, lock.STORE_CLOSED_MESSAGE, "locked with money in the wallet");
  assert.equal((await billing.statusFor(RID)).storeClosed, true);
  await rejects(recharge.createRecharge({ restaurantId: RID, amountPaise: 400000 }), 409, "SUBSCRIPTION_CANCELLED");

  const debitsBefore = debits().length;
  await lock.sweepLocks(new Date(end.getTime() + MIN));
  assert.equal(state.sub.status, "CANCELLED", "the period end cancels instead of renewing");
  assert.equal(debits().length, debitsBefore, "nothing debited");
});

test("SOURCE: cancelling is the Owner's alone, answered with the Billing status; CSD's is admin-only and audited", () => {
  const route = SRC("routes/subscriptionRoute.js");
  for (const r of ['router.post("/cancel"', 'router.post("/reinstate"']) {
    assert.ok(route.includes(`${r}, isVerifiedUser, requireOwnerOnly, requireProtectedAction,`), r);
  }
  const csd = SRC("routes/csdRoute.js");
  assert.match(csd, /router\.post\("\/billing\/accounts\/:restaurantId\/subscription\/cancel", requireCsdAdmin, cancelAccountSubscription\);/);
  assert.match(csd, /router\.post\("\/billing\/accounts\/:restaurantId\/subscription\/reinstate", requireCsdAdmin, reinstateAccountSubscription\);/);
  const ctrl = SRC("controllers/csdBillingConfigController.js");
  assert.match(ctrl, /BILLING\.SUBSCRIPTION\.CANCEL/);
  assert.match(ctrl, /reason\.length < 3 \|\| reason\.length > 300/);
});

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

test("SOURCE: a period that ends renews within a minute, and on the reads the till makes", () => {
  assert.match(SRC("services/accountLock.js"), /renewEveryMs = 60 \* 1000/);
  assert.match(SRC("routes/businessBalanceRoute.js"), /renewDue\(new Date\(\), \{ restaurantId \}\);/);
  assert.match(SRC("routes/subscriptionRoute.js"), /await renewDue\(new Date\(\), \{ restaurantId \}\);\s*res\.status\(200\)\.json\(\{ success: true, data: await statusFor\(restaurantId\) \}\);/);
});

test("SOURCE: every charge carries its idempotency key", () => {
  const src = SRC("services/subscription.js");
  for (const key of [
    "idempotencyKey: `activation-${restaurantId}`",
    "idempotencyKey: `renewal-${subscription._id}-${iso(subscription.currentPeriodEnd)}`",
    "idempotencyKey: `addon-${subscription._id}-${p.addon.code}-${iso(p.period.end)}`",
    "idempotencyKey: `addon-renewal-${subscription._id}-${a.code}-${iso(a.paidUntil)}`",
    "const key = `printer-pay-${intent.gatewayOrderId}`",
  ]) {
    assert.ok(src.includes(key), key);
  }
});

test("SOURCE: buying needs the Owner or the Store PIN; reading is scoped to the caller's own store", () => {
  const route = SRC("routes/subscriptionRoute.js");
  for (const r of ['router.post("/addons"', 'router.delete("/addons/:code"', 'router.post("/printers"', 'router.post("/renew"']) {
    assert.ok(route.includes(`${r}, isVerifiedUser, requireProtectedAction,`), r);
  }
  // A manual renewal reports the add-ons on their own clock too.
  assert.match(route, /addonsRenewed: result\.addonsRenewed,\s*addonErrors: result\.addonErrors,/);
  assert.ok(!/\/plans|\/purchase|\/installation|\/terms/.test(route), "the plan, installation and terms routes are gone");
  assert.match(route, /accepted: req\.body\?\.accepted === true/, "only a literal true accepts the terms");
});

test("SOURCE: only a real top-up reaches the activation hook, and only once", () => {
  const src = SRC("services/recharge.js");
  assert.match(src, /const \{ entry, duplicate \} = await credit\(\{\s*restaurantId: intent\.restaurantId,\s*kind: "RECHARGE",/);
  assert.match(src, /if \(!duplicate\) \{\s*try \{\s*plan = await afterRecharge\(\{ restaurantId: intent\.restaurantId, amountPaise: paidPaise \}\);/);
  assert.ok(!/afterRecharge/.test(SRC("services/ledger.js")), "a CSD credit goes through the ledger alone");
});
