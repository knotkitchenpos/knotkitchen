/**
 * CSD's manual Wallet adjustment, the renewal-policy and tax-mode lock-downs
 * on the billing config, and the per-order / e-bill charges always taxed on
 * top (N3, N5, N6).
 *
 * The real controller and charge services over an in-memory ledger: the
 * models, the ledger, the lock and the audit log are replaced below.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("module");

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const RID = "64b000000000000000000001";
const GST_INCLUSIVE = {
  registered: true, percent: 18, mode: "inclusive", effectiveFrom: new Date("2020-01-01"), placeOfSupplyState: "West Bengal",
};

const state = {};
const reset = (balance = 0) => Object.assign(state, {
  balance, entries: [], audits: [], settled: 0, evaluated: 0, saved: 0,
  config: {
    gst: { ...GST_INCLUSIVE }, websiteOrderCharge: {}, ebillCharge: {}, renewalPolicy: "FROM_PAYMENT",
    save: async () => { state.saved += 1; },
  },
  order: null,
  // The resolved per-order rate: ₹3 for the website.
  charge: { enabled: true, amountPaise: 300, taxable: true },
});

class InsufficientBalanceError extends Error {
  constructor(required, available) {
    super("Insufficient KnotKitchen Business Balance.");
    this.requiredPaise = required;
    this.availablePaise = available;
  }
}

const move = async (a, direction) => {
  const dup = a.idempotencyKey && state.entries.find((e) => e.idempotencyKey === a.idempotencyKey);
  if (dup) return { entry: dup, duplicate: true };
  if (direction === "DEBIT" && state.balance < a.amountPaise) throw new InsufficientBalanceError(a.amountPaise, state.balance);
  state.balance += direction === "CREDIT" ? a.amountPaise : -a.amountPaise;
  const entry = { _id: `le${state.entries.length + 1}`, ...a, direction, balanceAfterPaise: state.balance, createdAt: new Date() };
  state.entries.push(entry);
  return { entry, duplicate: false };
};

const q = (fn) => {
  const p = { then: (res, rej) => Promise.resolve().then(fn).then(res, rej), select: () => p, lean: () => p };
  return p;
};

const ledger = {
  credit: (a) => move(a, "CREDIT"),
  debit: (a) => move(a, "DEBIT"),
  getBalance: async () => ({ balancePaise: state.balance }),
  findByIdempotencyKey: async (k) => state.entries.find((e) => e.idempotencyKey === k) || null,
  InsufficientBalanceError,
};
const lock = {
  assessAccount: async () => ({ restaurantId: RID, balancePaise: state.balance, duesPaise: 0, locked: false }),
  evaluateLock: async () => { state.evaluated += 1; },
  fireEvaluateLock: () => {},
};
const pricing = {
  getPlatformConfig: async () => state.config,
  resolveOrderCharge: async () => state.charge,
  resolveEBillCharge: async () => ({ enabled: true, amountPaise: 25, taxable: true }),
};
const fakes = {
  "../models/restaurantModel": { exists: async () => true, findById: () => q(() => ({ address: { state: "West Bengal" } })) },
  "../models/orderModel": { findById: async () => state.order },
  "../services/ledger": ledger,
  "./ledger": ledger,
  "../services/accountLock": lock,
  "./accountLock": lock,
  "../services/pricing": pricing,
  "./pricing": pricing,
  "../services/subscription": { statusFor: async () => ({ status: "ACTIVE" }), SubscriptionError: class extends Error {} },
  "../services/csdAuditService": { csdAudit: async (a) => { state.audits.push(a); } },
};
const realLoad = Module._load;
Module._load = function load(request, parent) {
  // The controller's own orderCharge import is faked; orderCharge itself is real below.
  if (request === "../services/orderCharge" && /controllers/.test(parent?.filename || "")) {
    return { settlePendingCharges: async () => { state.settled += 1; } };
  }
  if (Object.prototype.hasOwnProperty.call(fakes, request)) return fakes[request];
  return realLoad.apply(this, arguments);
};

const ctrl = require("../controllers/csdBillingConfigController");
const { chargeOrder, quotePlatformFee } = require("../services/orderCharge");
const { chargeForEBill } = require("../services/ebillCharge");

/** Run a handler; resolve with { status, body } or the error it passed on. */
const call = (handler, { params = {}, body = {} } = {}) => new Promise((resolve) => {
  const req = { params, body, csdStaff: { _id: "s1", staffId: "KK001", fullName: "Admin One", role: "admin" } };
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(b) { resolve({ status: this.statusCode, body: b }); return this; },
  };
  handler(req, res, (err) => resolve({ status: err?.status || 500, error: err }));
});
const adjust = (body) => call(ctrl.adjustWallet, { params: { restaurantId: RID }, body });

// ---------------------------------------------------------------------------
// N3: wallet adjustment
// ---------------------------------------------------------------------------

test("a credit goes through the ledger as ADJUSTMENT_CREDIT, is audited, and answers with the account", async () => {
  reset(0);
  const r = await adjust({ direction: "CREDIT", amount: 250.5, reason: "Erroneous order charge put back", reference: "INV-12" });
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.body.data.balancePaise, 25050, "the account payload, as GET /billing/accounts/:id");
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].kind, "ADJUSTMENT_CREDIT");
  assert.equal(state.entries[0].amountPaise, 25050);
  assert.equal(state.entries[0].meta.reference, "INV-12");
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].action, "BILLING.WALLET.CREDIT");
  assert.deepEqual(state.audits[0].previousValue, { balancePaise: 0 });
  assert.equal(state.settled, 1, "money in collects pending dues, as a refund does");
  assert.equal(state.evaluated, 1);
});

test("a debit is ADJUSTMENT_DEBIT and may not exceed the balance", async () => {
  reset(100000);
  const over = await adjust({ direction: "DEBIT", amount: 1000.01, reason: "Tablet damaged", reference: "SUP-7" });
  assert.equal(over.status, 400);
  assert.match(over.error.fieldErrors.amount, /cannot be more than the Wallet balance/);
  assert.equal(state.entries.length, 0);

  const ok = await adjust({ direction: "DEBIT", amount: 1000, reason: "Bank refund paid", reference: "UTR123456" });
  assert.equal(ok.status, 200);
  assert.equal(state.entries[0].kind, "ADJUSTMENT_DEBIT");
  assert.equal(state.balance, 0);
  assert.equal(state.audits[0].action, "BILLING.WALLET.DEBIT");
  assert.equal(state.settled, 0, "a debit collects nothing");
});

test("the same adjustment repeated within a minute is applied once", async () => {
  reset(0);
  const body = { direction: "CREDIT", amount: 100, reason: "Goodwill", reference: "T-1" };
  const first = await adjust(body);
  const second = await adjust(body);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(state.entries.length, 1);
  assert.equal(state.audits.length, 1, "a replay is not audited twice");
  assert.equal(state.balance, 10000);

  // A different reference is a different movement.
  await adjust({ ...body, reference: "T-2" });
  assert.equal(state.entries.length, 2);
});

test("a client-supplied key makes a retry a no-op, even after the balance changed", async () => {
  reset(5000);
  const body = { direction: "DEBIT", amount: 50, reason: "Tablet lost", idempotencyKey: "abc-1" };
  assert.equal((await adjust(body)).status, 200);
  const retry = await adjust(body);
  assert.equal(retry.status, 200, "not refused for the now-empty balance");
  assert.equal(retry.body.duplicate, true);
  assert.equal(state.entries.length, 1);
});

test("bad input is refused before anything moves", async () => {
  reset(5000);
  for (const [body, field] of [
    [{ direction: "SIDEWAYS", amount: 10, reason: "abc" }, "direction"],
    [{ direction: "CREDIT", amount: 0, reason: "abc" }, "amount"],
    [{ direction: "CREDIT", amount: -5, reason: "abc" }, "amount"],
    [{ direction: "CREDIT", amount: "x", reason: "abc" }, "amount"],
    [{ direction: "CREDIT", amount: 10, reason: "ab" }, "reason"],
    [{ direction: "CREDIT", amount: 10 }, "reason"],
    [{ direction: "CREDIT", amount: 10, reason: "x".repeat(301) }, "reason"],
  ]) {
    const r = await adjust(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(r.error.fieldErrors[field], `${field} for ${JSON.stringify(body)}`);
  }
  assert.equal(state.entries.length, 0);
  assert.equal(state.audits.length, 0);
});

test("SOURCE: adjusting is admin-only, never touches balancePaise, never runs afterRecharge", () => {
  assert.match(SRC("routes/csdRoute.js"), /router\.post\("\/billing\/accounts\/:restaurantId\/wallet\/adjust", requireCsdAdmin, adjustWallet\)/);
  const src = SRC("controllers/csdBillingConfigController.js");
  const body = src.slice(src.indexOf("const adjustWallet"), src.indexOf("const endTabletRental"));
  assert.ok(!/\$inc|afterRecharge\(|BusinessBalance\.|\.balancePaise\s*=/.test(body));
  assert.match(body, /\(direction === "CREDIT" \? credit : debit\)\(/, "only the ledger service moves money");
});

// ---------------------------------------------------------------------------
// N6 / N5: config lock-downs
// ---------------------------------------------------------------------------

test("FROM_EXPIRY is refused with 400; FROM_PAYMENT is accepted", async () => {
  reset();
  const bad = await call(ctrl.updateBillingConfig, { body: { renewalPolicy: "FROM_EXPIRY" } });
  assert.equal(bad.status, 400);
  assert.ok(bad.error.fieldErrors.renewalPolicy);
  assert.equal(state.saved, 0);

  const ok = await call(ctrl.updateBillingConfig, { body: { renewalPolicy: "FROM_PAYMENT" } });
  assert.equal(ok.status, 200);
  assert.equal(state.config.renewalPolicy, "FROM_PAYMENT");
});

test("the tax mode is no longer editable or shown", async () => {
  reset();
  const r = await call(ctrl.updateBillingConfig, {
    body: { gst: { registered: true, percent: 18, mode: "inclusive", effectiveFrom: "2026-10-01", gstin: "19ABCDE1234F1Z5" } },
  });
  assert.equal(r.status, 200);
  assert.equal(state.config.gst.mode, "exclusive");
  assert.equal("mode" in r.body.data.gst, false);
});

test("GST registered needs a valid GSTIN and a rate above 0", async () => {
  // The invoice reads "registered" from the GSTIN: without one it would charge
  // GST and print that none was charged.
  reset();
  const gst = { registered: true, effectiveFrom: "2026-10-01", percent: 18, gstin: "" };
  const noGstin = await call(ctrl.updateBillingConfig, { body: { gst } });
  assert.equal(noGstin.status, 400);
  assert.match(noGstin.error.fieldErrors["gst.gstin"], /15-character GSTIN/);
  const zeroRate = await call(ctrl.updateBillingConfig, { body: { gst: { ...gst, gstin: "19ABCDE1234F1Z5", percent: 0 } } });
  assert.equal(zeroRate.status, 400);
  assert.match(zeroRate.error.fieldErrors["gst.percent"], /GST rate/);
  assert.equal(state.saved, 0);

  // Not registered: neither is needed.
  const off = await call(ctrl.updateBillingConfig, { body: { gst: { registered: false, gstin: "", percent: 0 } } });
  assert.equal(off.status, 200);
});

test("a saved add-on or device can go off sale but never leave the list", async () => {
  // A dropped add-on keeps renewing for the stores on it, out of their sight.
  reset();
  state.config.addons = [
    { code: "TABLE_QR", name: "QR", pricePaise: 20000, feature: "tableQr" },
    { code: "WEBSITE", name: "Website", pricePaise: 360000, periodDays: 365, feature: "website" },
  ];
  state.config.printers = [{ code: "PRINTER_2IN", name: "2-inch", pricePaise: 170000 }];
  const website = { code: "WEBSITE", name: "Website", price: 3600, periodDays: 365, feature: "website" };
  const dropped = await call(ctrl.updateBillingConfig, { body: { addons: [website] } });
  assert.equal(dropped.status, 400);
  assert.match(dropped.error.fieldErrors.addons, /"TABLE_QR" is saved: take it off sale/);
  const noDevice = await call(ctrl.updateBillingConfig, { body: { printers: [] } });
  assert.match(noDevice.error.fieldErrors.printers, /"PRINTER_2IN" is saved/);
  assert.equal(state.saved, 0);

  const offSale = await call(ctrl.updateBillingConfig, {
    body: { addons: [{ code: "TABLE_QR", name: "QR", price: 200, feature: "tableQr", isActive: false }, website] },
  });
  assert.equal(offSale.status, 200);
  assert.equal(state.config.addons[0].isActive, false);
});

test("the later top-up minimum is shown and edited in rupees; left out it keeps the saved one", async () => {
  reset();
  state.config.topUpMinPaise = 100000;
  const r = await call(ctrl.updateBillingConfig, { body: { renewalPolicy: "FROM_PAYMENT" } });
  assert.equal(r.body.data.topUpMin, 1000);
  const set = await call(ctrl.updateBillingConfig, { body: { topUpMin: 1500 } });
  assert.equal(set.status, 200);
  assert.equal(state.config.topUpMinPaise, 150000);
});

// ---------------------------------------------------------------------------
// N5: usage charges are taxed on top, whatever gst.mode says
// ---------------------------------------------------------------------------

test("the platform fee is quoted ₹3 + GST even when the stored mode is inclusive", async () => {
  reset(100000);
  const fee = await quotePlatformFee({ restaurantId: RID, source: "WEBSITE" });
  assert.deepEqual(fee, { amountPaise: 300, taxPaise: 54, totalPaise: 354, taxPercent: 18 }, "18% added on top, not taken out");

  // No GST before KnotKitchen's own registration is effective.
  state.config.gst.effectiveFrom = new Date("2099-01-01");
  assert.deepEqual(await quotePlatformFee({ restaurantId: RID, source: "WEBSITE" }), {
    amountPaise: 300, taxPaise: 0, totalPaise: 300, taxPercent: 0,
  });

  // Off, not started, zero, a demo store: no fee at all.
  for (const charge of [{ enabled: false, amountPaise: 300 }, { enabled: true, amountPaise: 0 }]) {
    state.charge = charge;
    assert.equal(await quotePlatformFee({ restaurantId: RID, source: "WEBSITE" }), null);
  }
});

test("REGRESSION: the debit equals the fee the diner paid, even after CSD changes the rate", async () => {
  reset(100000);
  const fee = await quotePlatformFee({ restaurantId: RID, source: "WEBSITE" });
  state.order = {
    _id: "o1", restaurantId: RID, orderNumber: 7, source: "WEBSITE", orderStatus: "Pending", createdAt: new Date(),
    payments: [{ status: "paid" }], paymentData: { gatewayOrderId: "KK-W-1" },
    platformCharge: { ...fee, status: null }, save: async () => {},
  };
  // Repriced between checkout and the debit.
  state.charge = { enabled: true, amountPaise: 900, taxable: true };
  state.config.gst.percent = 5;

  const r = await chargeOrder("o1");
  assert.equal(r.charged, true);
  assert.equal(state.entries[0].amountPaise, 354, "what the diner paid, not today's rate");
  assert.equal(state.entries[0].kind, "ORDER_CHARGE");
  assert.equal(state.entries[0].description, "Platform fee — #7");
  assert.deepEqual(
    [state.order.platformCharge.status, state.order.platformCharge.taxPaise, state.order.platformCharge.totalPaise],
    ["PAID", 54, 354],
  );

  // Idempotent: a second settle of the same order bills nothing more.
  await chargeOrder("o1");
  assert.equal(state.entries.length, 1);
});

test("a cash-paid order carries no fee and is only stamped", async () => {
  reset(100000);
  state.order = {
    _id: "o2", restaurantId: RID, orderNumber: 8, source: "POS", orderStatus: "Completed", createdAt: new Date(),
    payments: [{ status: "paid", method: "cash" }], save: async () => {},
  };
  const r = await chargeOrder("o2");
  assert.equal(r.charged, false);
  assert.equal(state.entries.length, 0);
  assert.deepEqual([state.order.platformCharge.status, state.order.platformCharge.reason], ["NOT_APPLICABLE", "No platform fee was collected."]);
});

test("the e-bill charge is ₹0.25 + GST even when the stored mode is inclusive", async () => {
  reset(100000);
  await chargeForEBill({ restaurantId: RID, messageId: "m1" });
  assert.equal(state.entries[0].amountPaise, 25 + 5, "25p + 18% (4.5p, rounded) on top");
});

test("the e-bill is charged once per bill: the first delivery pays, a re-send does not", async () => {
  reset(100000);
  const send = (billRef, messageId) => chargeForEBill({ restaurantId: RID, billRef, messageId, orderNumber: "42" });
  assert.equal((await send("s1", "m1")).charged, true);
  // The settle modal and the auto-send both firing, then a manual re-send.
  assert.equal((await send("s1", "m2")).charged, false);
  assert.equal((await send("s1", "m3")).charged, false);
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].description, "E-bill — #42");
  // Another bill is another charge.
  assert.equal((await send("s2", "m4")).charged, true);
  assert.equal(state.entries.length, 2);
});

// ---------------------------------------------------------------------------
// N5: table QR sessions settled through the gateway
// ---------------------------------------------------------------------------

test("SOURCE: a gateway-settled table session fires ONE charge for the whole bill", () => {
  const src = SRC("controllers/tableSessionController.js");
  const fn = src.slice(src.indexOf("const settleSessionFromGateway"), src.indexOf("const findCancelTarget"));
  const failAt = fn.indexOf("if (failure) throw failure;");
  const fireAt = fn.indexOf("fireTableSessionCharge(sessionId)");
  assert.ok(failAt !== -1 && fireAt > failAt, "only after the settle succeeded");
  assert.ok(!/fireOrderCharge/.test(fn), "not one charge per order");
  // A till-recorded settle is not a gateway payment.
  const till = src.slice(src.indexOf("const recordSessionPayment"), src.indexOf("const moveSession"));
  assert.ok(!/fireOrderCharge|fireTableSessionCharge/.test(till));
});
