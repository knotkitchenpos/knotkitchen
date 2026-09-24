/**
 * Printer and tablet requests (services/hardwareRequests.js): the address a
 * courier needs, one request per payment, CSD moving it along, and a cancel
 * that releases the printer/tablet and refunds the wallet exactly once.
 *
 * The models, ledger and counters are replaced below by an in-memory store.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("module");

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const RID = "64b000000000000000000001";
const state = {};
let seq = 0;
const oid = () => `id${++seq}`;

const reset = () => {
  Object.assign(state, {
    restaurant: {
      _id: RID,
      name: "Spice Garden",
      storeId: "148379",
      ownerName: "Asha Roy",
      ownerPhone: "+91 98300 12345",
      address: { line1: "12 Park Street", line2: "", city: "Kolkata", state: "West Bengal", postalCode: "700016" },
    },
    sub: {
      _id: "sub1",
      restaurantId: RID,
      storeId: "148379",
      currentPeriodEnd: new Date(Date.now() + 10 * 24 * 3600 * 1000),
      tablets: [{ serial: 1, pricePaise: 60000, rentedAt: new Date(), endsAt: null }],
      tabletRechargeCredits: 0,
      hardware: [{ key: "printer-pay-KKBAL-1", code: "PRINTER_2IN", name: "2-inch printer", totalPaise: 224200, invoiceId: "invP", purchasedAt: new Date() }],
    },
    requests: [],
    entries: [{ _id: "leT", idempotencyKey: "tablet-sub1-1", amountPaise: 35400 }],
    invoices: [
      { _id: "invP", status: "PAID", notes: "" },
      { _id: "invT", status: "PAID", notes: "", ledgerEntryId: "leT" },
    ],
    intents: [{ gatewayOrderId: "KKBAL-1", item: { shipTo: { name: "Paid Via Card", phone: "9000000001" } } }],
    counter: 0,
    failNextCredit: false,
    emitted: [],
  });
};

/** A query: awaitable, and chainable like a Mongoose one. */
const q = (fn) => {
  const p = { then: (res, rej) => Promise.resolve().then(fn).then(res, rej) };
  for (const m of ["select", "lean", "sort", "limit", "skip"]) p[m] = () => p;
  return p;
};

const get = (o, k) => k.split(".").reduce((v, part) => (v == null ? v : v[part]), o);
const matches = (doc, filter) =>
  Object.entries(filter).every(([k, cond]) => {
    const v = get(doc, k);
    if (cond && typeof cond === "object" && "$in" in cond) return cond.$in.includes(v);
    if (cond === null) return v == null;
    return String(v) === String(cond);
  });

const setPath = (doc, k, v) => {
  const parts = k.split(".");
  const last = parts.pop();
  const target = parts.reduce((o, p) => (o[p] = o[p] || {}), doc);
  target[last] = v;
};

const HardwareRequest = {
  STATUSES: ["REQUESTED", "ACCEPTED", "DISPATCHED", "DELIVERED", "CANCELLED"],
  findOne: (filter) => q(() => state.requests.find((r) => matches(r, filter)) || null),
  findById: (id) => q(() => state.requests.find((r) => String(r._id) === String(id)) || null),
  find: (filter) => q(() => state.requests.filter((r) => matches(r, filter.key ? { key: filter.key } : filter))),
  create: async (d) => {
    if (state.requests.some((r) => r.key === d.key)) throw Object.assign(new Error("E11000"), { code: 11000 });
    const doc = { _id: oid(), createdAt: new Date(), updatedAt: new Date(), notes: [], dispatch: {}, cancel: {}, ...d };
    state.requests.push(doc);
    return doc;
  },
  findOneAndUpdate: (filter, update) =>
    q(() => {
      const doc = state.requests.find((r) => matches(r, filter));
      if (!doc) return null;
      for (const [k, v] of Object.entries(update.$set || {})) setPath(doc, k, v);
      for (const [k, v] of Object.entries(update.$push || {})) (doc[k] = doc[k] || []).push(k === "notes" ? { _id: oid(), ...v } : v);
      return doc;
    }),
  countDocuments: async () => state.requests.length,
  aggregate: async () => [],
};

// MongoDB's { arr: { $elemMatch } } + "arr.$.field", the only array update the service makes.
const PlatformSubscription = {
  findOne: () => q(() => state.sub),
  updateOne: async (filter, update) => {
    const [arr, cond] = Object.entries(filter).find(([, c]) => c && c.$elemMatch) || [];
    const el = (state.sub[arr] || []).find((e) =>
      Object.entries(cond.$elemMatch).every(([k, v]) => {
        if (v === null) return e[k] == null;
        // { $not: { $lte: d } }: not ended at or before d (missing counts as not ended).
        if (v && v.$not) return !(e[k] != null && new Date(e[k]) <= new Date(v.$not.$lte));
        return e[k] === v;
      }),
    );
    if (!el) return { matchedCount: 0, modifiedCount: 0 };
    for (const [k, v] of Object.entries(update.$set || {})) el[k.split(".").pop()] = v;
    for (const [k, v] of Object.entries(update.$inc || {})) state.sub[k] += v;
    return { matchedCount: 1, modifiedCount: 1 };
  },
};

const PlatformInvoice = {
  findOne: ({ ledgerEntryId }) => q(() => state.invoices.find((i) => i.ledgerEntryId === ledgerEntryId) || null),
  find: (f) =>
    q(() =>
      state.invoices.filter((i) => i.kind === f.kind && i.status === f.status && (!f.createdAt || i.createdAt >= f.createdAt.$gte)),
    ),
  updateOne: async (filter, update) => {
    const inv = state.invoices.find((i) => i._id === filter._id && (!filter.status || i.status === filter.status));
    if (inv) Object.assign(inv, update.$set);
    return { modifiedCount: inv ? 1 : 0 };
  },
};

const fakes = {
  "../models/hardwareRequestModel": HardwareRequest,
  "../models/platformSubscriptionModel": { PlatformSubscription, PlatformInvoice },
  "../models/rechargeOrderModel": { findOne: ({ gatewayOrderId }) => q(() => state.intents.find((i) => i.gatewayOrderId === gatewayOrderId) || null) },
  "../models/restaurantModel": { findById: () => q(() => state.restaurant) },
  "./invoiceNumber": { InvoiceCounter: { findOneAndUpdate: async () => ({ seq: ++state.counter }) } },
  "./ledger": {
    findByIdempotencyKey: async (key) => state.entries.find((e) => e.idempotencyKey === key) || null,
    credit: async (a) => {
      if (state.failNextCredit) {
        state.failNextCredit = false;
        throw new Error("database blip");
      }
      const dup = state.entries.find((e) => e.idempotencyKey === a.idempotencyKey);
      if (dup) return { entry: dup, duplicate: true };
      const entry = { _id: oid(), direction: "CREDIT", ...a };
      state.entries.push(entry);
      return { entry, duplicate: false };
    },
  },
  "./orderCharge": { settlePendingCharges: async () => null },
  "./accountLock": { evaluateLock: async () => null },
  "./socket": { emitToRestaurant: (rid, event, payload) => state.emitted.push([event, payload.status]) },
};

const realLoad = Module._load;
Module._load = function load(request) {
  if (Object.prototype.hasOwnProperty.call(fakes, request)) return fakes[request];
  return realLoad.apply(this, arguments);
};
const hw = require("../services/hardwareRequests");

const refunds = () => state.entries.filter((e) => e.kind === "REFUND");
const rejects = (promise, status, code) =>
  assert.rejects(promise, (err) => {
    assert.equal(err.status, status, err.message);
    if (code) assert.equal(err.code, code);
    return true;
  });

const STAFF = { _id: "st1", fullName: "Ravi (CSD)" };
const openTablet = () =>
  hw.openRequest({ type: "TABLET", key: "tablet-sub1-1", restaurantId: RID, item: { code: "TABLET_FIRST", name: "Tablet #1", tabletSerial: 1 } });
const openPrinter = () =>
  hw.openRequest({
    type: "PRINTER",
    key: "printer-pay-KKBAL-1",
    restaurantId: RID,
    item: { code: "PRINTER_2IN", name: "2-inch printer" },
    payment: { amountPaise: 224200, gatewayOrderId: "KKBAL-1" },
  });

test("a delivery address is what a courier needs, cleaned; left out, the store's own", async () => {
  reset();
  const own = await hw.resolveShipTo(RID, undefined);
  assert.deepEqual([own.name, own.phone, own.city, own.postalCode], ["Asha Roy", "9830012345", "Kolkata", "700016"]);

  const given = await hw.resolveShipTo(RID, { name: " Ravi ", phone: "098300 99999", line1: "Stall 4, New Market", city: "Kolkata", state: "WB", postalCode: "700 087" });
  assert.deepEqual([given.name, given.phone, given.postalCode], ["Ravi", "9830099999", "700087"]);

  await rejects(hw.resolveShipTo(RID, { name: "Ravi", phone: "12345", line1: "Stall 4", city: "Kolkata", state: "WB", postalCode: "70001" }), 400, "SHIP_TO_INVALID");
  await assert.rejects(hw.resolveShipTo(RID, { name: "Ravi", phone: "9830099999", line1: "Stall 4", city: "", state: "WB", postalCode: "700001" }), /Add the city for the delivery/);

  state.restaurant.address = {};
  await assert.rejects(hw.resolveShipTo(RID, null), /the address, the city, the state, a 6-digit PIN code/, "a store with no address has to type one");
});

test("one request per payment, numbered per store, with what was paid and its invoice", async () => {
  reset();
  const tablet = await openTablet();
  const again = await openTablet();
  assert.equal(state.requests.length, 1, "a retried payment opens one request");
  assert.equal(again._id, tablet._id);
  assert.equal(tablet.requestNo, "HR-148379-001");
  assert.deepEqual([tablet.payment.method, tablet.payment.amountPaise, tablet.payment.invoiceId], ["WALLET", 35400, "invT"], "read from the rental's own ledger entry");
  assert.equal(tablet.shipTo.phone, "9830012345", "the store's own contact when none was given");
  assert.equal(tablet.status, "REQUESTED");

  const printer = await openPrinter();
  assert.equal(printer.requestNo, "HR-148379-002");
  assert.deepEqual([printer.payment.method, printer.payment.amountPaise, printer.payment.invoiceId], ["GATEWAY", 224200, "invP"]);

  // A free tablet (a negotiated Rs 0) has nothing to refund.
  state.entries = [];
  const free = await hw.openRequest({ type: "TABLET", key: "tablet-sub1-9", restaurantId: RID, item: { tabletSerial: 9 } });
  assert.deepEqual([free.payment.method, free.payment.amountPaise], ["NONE", 0]);
});

test("the store cancels a request KnotKitchen has not started: everything back to the wallet, once", async () => {
  reset();
  const tablet = await openTablet();
  const cancelled = await hw.cancelRequest({ id: tablet._id, restaurantId: RID, by: { type: "STORE", name: "Owner" }, refundPaise: 1 });
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(refunds().length, 1);
  assert.equal(refunds()[0].amountPaise, 35400, "a store cannot choose a smaller refund, and gets it all");
  assert.equal(refunds()[0].idempotencyKey, `hwreq-refund-${tablet._id}`);
  assert.ok(state.sub.tablets[0].endsAt, "the tablet stops at once, so it never renews");
  assert.equal(state.sub.tabletRechargeCredits, 1, "the top-up it used is given back");
  assert.equal(state.sub.tablets.length, 1, "the row stays, so tablet numbers never repeat");
  assert.equal(state.invoices.find((i) => i._id === "invT").status, "VOID");
  assert.ok(cancelled.cancel.settledAt);
  assert.deepEqual(state.emitted.at(-1), ["hardwareRequest:updated", "CANCELLED"], "the till refreshes");

  const twice = await hw.cancelRequest({ id: tablet._id, restaurantId: RID, by: { type: "STORE" } });
  assert.equal(twice.status, "CANCELLED");
  assert.equal(refunds().length, 1, "never refunded twice");
  assert.equal(state.sub.tabletRechargeCredits, 1);

  // Another store's request is not found.
  await rejects(hw.cancelRequest({ id: tablet._id, restaurantId: "someone-else", by: { type: "STORE" } }), 404);
});

test("once KnotKitchen has accepted it, only CSD can cancel, choosing the refund", async () => {
  reset();
  const printer = await openPrinter();
  await hw.advance({ id: printer._id, action: "accept", staff: STAFF });
  await rejects(hw.cancelRequest({ id: printer._id, restaurantId: RID, by: { type: "STORE" } }), 409, "NOT_CANCELLABLE");

  await rejects(hw.cancelRequest({ id: printer._id, by: { type: "CSD", name: "Ravi" }, reason: "Out of stock", refundPaise: 224201 }), 400, "REFUND_TOO_LARGE");
  await rejects(hw.cancelRequest({ id: printer._id, by: { type: "CSD", name: "Ravi" }, reason: "" }), 400);

  const cancelled = await hw.cancelRequest({ id: printer._id, by: { type: "CSD", name: "Ravi" }, reason: "Store changed its mind after dispatch", refundPaise: 200000 });
  assert.equal(refunds()[0].amountPaise, 200000);
  assert.ok(state.sub.hardware[0].cancelledAt, "no longer counted as owned");
  const invoice = state.invoices.find((i) => i._id === "invP");
  assert.equal(invoice.status, "PAID", "a part refund keeps the invoice");
  assert.match(invoice.notes, /HR-148379-001 cancelled\. ₹2,000\.00 refunded/);
  assert.equal(cancelled.history.at(-1).from, "ACCEPTED");
});

test("CSD moves a request along: accept, dispatch with tracking, deliver; never backwards", async () => {
  reset();
  const r = await openPrinter();
  await rejects(hw.advance({ id: r._id, action: "deliver", staff: STAFF }), 409, "BAD_MOVE");
  await hw.advance({ id: r._id, action: "accept", staff: STAFF });
  await rejects(hw.advance({ id: r._id, action: "accept", staff: STAFF }), 409, "BAD_MOVE");

  await rejects(hw.advance({ id: r._id, action: "dispatch", staff: STAFF, fields: { courier: "" } }), 400);
  await rejects(hw.advance({ id: r._id, action: "dispatch", staff: STAFF, fields: { courier: "Delhivery", trackingUrl: "javascript:alert(1)" } }), 400);
  const { request: sent } = await hw.advance({
    id: r._id,
    action: "dispatch",
    staff: STAFF,
    fields: { courier: "Delhivery", trackingNo: "DL123", trackingUrl: "https://track.example/DL123", expectedBy: "2026-10-01" },
  });
  assert.equal(sent.status, "DISPATCHED");
  const firstDispatch = sent.dispatch.at;

  const { request: fixed, from } = await hw.advance({ id: r._id, action: "dispatch", staff: STAFF, fields: { courier: "Delhivery", trackingNo: "DL124" } });
  assert.equal(from, "DISPATCHED");
  assert.equal(fixed.dispatch.trackingNo, "DL124");
  assert.equal(fixed.dispatch.at, firstDispatch, "correcting the tracking keeps when it left");
  assert.match(fixed.history.at(-1).note, /Tracking updated/);

  const { request: done } = await hw.advance({ id: r._id, action: "deliver", staff: STAFF, fields: { deviceSerial: "SN-9981" } });
  assert.deepEqual([done.status, done.deviceSerial], ["DELIVERED", "SN-9981"]);
  assert.deepEqual(done.history.map((h) => h.to), ["REQUESTED", "ACCEPTED", "DISPATCHED", "DISPATCHED", "DELIVERED"]);
  await rejects(hw.cancelRequest({ id: r._id, by: { type: "CSD", name: "Ravi" }, reason: "Too late" }), 409, "NOT_CANCELLABLE");

  const view = hw.storeView(done);
  assert.ok(view.history.every((h) => h.by !== "Ravi (CSD)"), "the store never sees staff names");
  assert.equal(view.canCancel, false);
  assert.equal("notes" in view, false, "internal notes stay internal");
});

test("a cancel interrupted before the refund is finished by the next look, and refunds once", async () => {
  reset();
  const tablet = await openTablet();
  state.failNextCredit = true;
  await assert.rejects(hw.cancelRequest({ id: tablet._id, restaurantId: RID, by: { type: "STORE" } }), /database blip/);
  assert.equal(tablet.status, "CANCELLED");
  assert.equal(tablet.cancel.settledAt, null);
  assert.equal(refunds().length, 0);

  await hw.reconcile(RID);
  assert.equal(refunds().length, 1);
  assert.equal(state.sub.tabletRechargeCredits, 1, "the credit came back once, on the first try");
  assert.ok(tablet.cancel.settledAt);
  await hw.reconcile(RID);
  assert.equal(refunds().length, 1);
});

test("a paid printer or tablet whose request never opened gets one when the store opens Billing", async () => {
  reset();
  state.sub.tablets.push({ serial: 0, pricePaise: 60000, rentedAt: new Date("2026-01-01"), endsAt: null });
  await hw.reconcile(RID);
  assert.deepEqual(state.requests.map((r) => r.key).sort(), ["printer-pay-KKBAL-1", "tablet-sub1-1"], "not the one from before requests existed");
  assert.equal(state.requests.find((r) => r.type === "PRINTER").shipTo.name, "Paid Via Card", "the address given when paying");
  await hw.reconcile(RID);
  assert.equal(state.requests.length, 2);
});

test("a tablet renewed while still waiting for delivery is refunded that renewal too", async () => {
  reset();
  const tablet = await openTablet();
  // The period rolled over before KnotKitchen got to it: the renewal billed a month for it.
  state.invoices.push({
    _id: "invR",
    kind: "SUBSCRIPTION",
    status: "PAID",
    createdAt: new Date(Date.now() + 1000),
    lines: [
      { description: "POS plan — 30 days", totalPaise: 47082 },
      { description: "Tablet #1 rental — 30 days", totalPaise: 70800 },
      { description: "Tablet #11 rental — 30 days", totalPaise: 59000 },
    ],
  });
  const view = (await hw.listForStore(RID)).find((r) => r.id === tablet._id);
  assert.equal(view.refundable.paise, 35400 + 70800, "what the Cancel button promises");

  await hw.cancelRequest({ id: tablet._id, restaurantId: RID, by: { type: "STORE" } });
  assert.equal(refunds()[0].amountPaise, 35400 + 70800, "the prorated rent and the month the renewal took, not Tablet #11's");
  assert.equal(state.invoices.find((i) => i._id === "invT").status, "VOID");
  assert.equal(state.invoices.find((i) => i._id === "invR").status, "PAID", "the renewal also paid the plan; it stays");

  // CSD's cap is the same total.
  reset();
  const again = await openTablet();
  state.invoices.push({ _id: "invR", kind: "SUBSCRIPTION", status: "PAID", createdAt: new Date(Date.now() + 1000), lines: [{ description: "Tablet #1 rental — 30 days", totalPaise: 70800 }] });
  await rejects(hw.cancelRequest({ id: again._id, by: { type: "CSD", name: "Ravi" }, reason: "No stock", refundPaise: 106201 }), 400, "REFUND_TOO_LARGE");
  await hw.cancelRequest({ id: again._id, by: { type: "CSD", name: "Ravi" }, reason: "No stock", refundPaise: 50000 });
  assert.equal(state.invoices.find((i) => i._id === "invT").status, "PAID", "a part refund of the total keeps the invoice");
});

test("a cancelled tablet on an expired plan ends at that period's end, so the next renewal never bills it", async () => {
  reset();
  const periodEnd = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  state.sub.currentPeriodEnd = periodEnd;
  const tablet = await openTablet();
  await hw.cancelRequest({ id: tablet._id, restaurantId: RID, by: { type: "STORE" } });
  assert.equal(state.sub.tablets[0].endsAt.getTime(), periodEnd.getTime());
  assert.equal(state.sub.tabletRechargeCredits, 1);
});

test("a tablet CSD had already set to end later is ended now by the cancel, and its top-up comes back", async () => {
  reset();
  const tablet = await openTablet();
  state.sub.tablets[0].endsAt = state.sub.currentPeriodEnd; // CSD pressed End rental on the store page
  const cancelled = await hw.cancelRequest({ id: tablet._id, restaurantId: RID, by: { type: "STORE" } });
  assert.equal(state.sub.tablets[0].endsAt.getTime(), new Date(cancelled.cancel.at).getTime());
  assert.equal(state.sub.tabletRechargeCredits, 1);
  await hw.reconcile(RID);
  assert.equal(state.sub.tabletRechargeCredits, 1, "once");
});

test("CSD cancelling one the store already cancelled is refused, not recorded as a second refund", async () => {
  reset();
  const printer = await openPrinter();
  await hw.cancelRequest({ id: printer._id, restaurantId: RID, by: { type: "STORE" } });
  await rejects(hw.cancelRequest({ id: printer._id, by: { type: "CSD", name: "Ravi" }, reason: "Duplicate", refundPaise: 0 }), 409, "ALREADY_CANCELLED");
  assert.equal(refunds().length, 1);
});

test("CSD opening a cancel that stopped halfway finishes it", async () => {
  reset();
  const printer = await openPrinter();
  state.failNextCredit = true;
  await assert.rejects(hw.cancelRequest({ id: printer._id, by: { type: "CSD", name: "Ravi" }, reason: "No stock" }), /database blip/);
  const view = await hw.getForCsd(printer._id);
  assert.equal(view.cancel.settled, true);
  assert.equal(refunds().length, 1);
  assert.equal(state.invoices.find((i) => i._id === "invP").status, "VOID");
});

test("a tablet's typed address survives when its request is opened late", async () => {
  reset();
  state.sub.tablets[0].shipTo = { name: "Branch 2", phone: "9830011111", line1: "4 Lake Rd", city: "Kolkata", state: "West Bengal", postalCode: "700029" };
  await hw.reconcile(RID);
  assert.equal(state.requests.find((r) => r.type === "TABLET").shipTo.name, "Branch 2");
});

test("SOURCE: routes, gates and the money rule", () => {
  const pos = SRC("routes/subscriptionRoute.js");
  assert.match(pos, /router\.get\("\/hardware-requests", isVerifiedUser,/);
  assert.match(pos, /router\.post\("\/hardware-requests\/:id\/cancel", isVerifiedUser, requireProtectedAction,/);
  assert.match(pos, /restaurantId: ownRestaurantId\(req\),\s*by: \{ type: "STORE"/, "a store cancels only its own");
  assert.match(pos, /shipTo: await resolveShipTo\(restaurantId, req\.body\?\.shipTo\)/);

  const csd = SRC("routes/csdRoute.js");
  assert.match(csd, /router\.post\("\/hardware-requests\/:id\/cancel", requireCsdAdmin, cancelHardwareRequest\)/, "refunds are admin-only");
  assert.ok(csd.indexOf('"/hardware-requests"') > csd.indexOf("router.use(requireCsdAuth)"), "behind the CSD session");

  const service = SRC("services/hardwareRequests.js");
  assert.doesNotMatch(service.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /afterRecharge/, "a refund is not a top-up");
  assert.match(service, /kind: "REFUND"/);
  assert.match(SRC("controllers/csdBillingConfigController.js"), /severity: "WARNING"/);
  assert.doesNotMatch(SRC("controllers/csdBillingConfigController.js"), /severity: "WARN"/);
});
