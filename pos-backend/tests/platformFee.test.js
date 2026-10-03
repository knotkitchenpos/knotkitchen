/**
 * KnotKitchen's platform fee, end to end on the money path.
 *
 * The diner pays it on top of the bill when paying online, and the wallet is
 * then debited exactly that. The rules held here:
 *
 *   the fee is computed on the server, never taken from a client
 *   it sits OUTSIDE bills.totalWithTax (restaurant revenue and GST untouched)
 *   the gateway is opened, and verified, for bill + the stored fee
 *   a till settle can never inject one; a cash settle carries none
 *   every customer-facing total shows it; a cancel gives it back
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("module");

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const slice = (src, from, to) => src.slice(src.indexOf(from), to ? src.indexOf(to, src.indexOf(from)) : undefined);

// ₹3 + 18% GST.
const WEB_FEE = { amountPaise: 300, taxPaise: 54, totalPaise: 354, taxPercent: 18 };
const RESTAURANT_ID = "507f1f77bcf86cd799439011";

/** Load a module with some of its requires replaced; the fakes stay on while `run` runs. */
const withFakes = async (fakes, modulePath, run) => {
  const orig = Module._load;
  Module._load = function (r) {
    if (Object.prototype.hasOwnProperty.call(fakes, r)) return fakes[r];
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve(modulePath)];
  try {
    return await run(require(modulePath));
  } finally {
    Module._load = orig;
    delete require.cache[require.resolve(modulePath)];
  }
};

// ---------------------------------------------------------------------------
// Website checkout
// ---------------------------------------------------------------------------

test("website checkout: the gateway amount is bill + fee, and the fee stays outside totalWithTax", async () => {
  const ALL_DAY = { weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, openTime: "00:00", closeTime: "00:00" })) };
  const naan = { _id: "507f1f77bcf86cd799439021", name: "Naan", price: 50, showOnWebsite: true, isAvailable: true };
  const menu = { _id: "507f1f77bcf86cd799439022", published: true, items: [naan], hasPublishedToWebsite: true, websiteSnapshot: { name: "Breads", items: [naan] } };
  const settings = {
    storeId: "123456", restaurantId: RESTAURANT_ID, slug: "royal-palace", enabled: true,
    ordering: { pickupEnabled: true }, channelHours: { collection: ALL_DAY, delivery: ALL_DAY },
  };

  let gatewayArgs = null;
  let checkoutDoc = null;
  function WebsiteCheckout(doc) {
    Object.assign(this, doc);
    this._id = "a".repeat(24);
    this.save = async () => { checkoutDoc = this; };
  }
  const fakes = {
    "../services/storefrontResolver": {
      resolveStorefront: async () => ({ ok: true, settings, store: { storeId: "123456" }, restaurantId: RESTAURANT_ID, storeId: "123456" }),
    },
    "../models/menuModel": { find: async () => [menu] },
    "../models/websiteCheckoutModel": WebsiteCheckout,
    "../services/paymentGateway": { resolveGateway: async () => ({ enabled: true, keyId: "k", secret: "s", environment: "TEST" }) },
    "../services/gateways/cashfree": {
      createOrder: async (args) => { gatewayArgs = args; return { orderId: args.orderId, paymentSessionId: "ps_1", environment: "TEST" }; },
    },
    "../services/orderCharge": { quotePlatformFee: async ({ source }) => (source === "WEBSITE" ? { ...WEB_FEE } : null) },
  };

  let out = null;
  await withFakes(fakes, "../controllers/storefrontController", async ({ startStorefrontCheckout }) => {
    const res = { status() { return res; }, json(b) { out = b; return res; } };
    let failure;
    await startStorefrontCheckout({
      params: { slug: "royal-palace" },
      headers: { host: "123456.knotkitchen.in" },
      // A tampered browser naming its own fee and amount is ignored.
      body: { orderType: "pickup", customer: { name: "Asha", phone: "9876543210" }, items: [{ menuId: menu._id, itemId: naan._id, quantity: 2 }], platformFee: 0, amount: 1 },
    }, res, (err) => { failure = err; });
    assert.equal(failure, undefined, failure && failure.message);
  });

  const bill = checkoutDoc.orderData.bills.totalWithTax;
  assert.ok(bill > 0);
  assert.equal(checkoutDoc.orderData.bills.platformFee, 3.54);
  assert.equal(checkoutDoc.amount, Math.round((bill + 3.54) * 100) / 100, "what the gateway charges");
  assert.equal(gatewayArgs.amount, checkoutDoc.amount);
  assert.deepEqual(
    [out.data.amount, out.data.billAmount, out.data.platformFee],
    [checkoutDoc.amount, bill, 3.54],
  );
  // The snapshot the wallet is later debited, not yet debited.
  const pc = checkoutDoc.orderData.platformCharge;
  assert.deepEqual([pc.amountPaise, pc.taxPaise, pc.totalPaise, pc.taxPercent, pc.status ?? null], [300, 54, 354, 18, null]);
});

test("website: the paid order is debited at payment, its CRM spend is the bill, and the diner sees what they paid", () => {
  const ctrl = SRC("controllers/storefrontController.js");
  const place = slice(ctrl, "const placePaidCheckout", "const verifyStorefrontCheckout");
  assert.match(place, /payments: \[\{ method: "online", amount: claimed\.amount, status: "paid", transactionId \}\]/, "money received = bill + fee");
  assert.match(place, /orderCharge\(\)\.fireOrderCharge\(placed\._id\)/, "the wallet is debited when the payment is confirmed");
  assert.match(place, /total: placed\.bills\?\.totalWithTax,/, "CRM spend is restaurant revenue");
  // The cart shows it before payment.
  assert.match(slice(ctrl, "ordering: {", "contact:"), /platformFee: await platformFee,/);

  const { publicOrderView } = require("../controllers/storefrontController");
  const view = publicOrderView({ items: [], bills: { totalWithTax: 120.5, platformFee: 3.54 } });
  assert.equal(view.totalPaid, 124.04);
  assert.equal(publicOrderView({ items: [], bills: { totalWithTax: 99 } }).totalPaid, 99);
});

test("the pay page spells out the fee before money moves", async () => {
  const checkout = {
    _id: "b".repeat(24), status: "PENDING", paymentSessionId: "ps", mode: "sandbox", amount: 123.54,
    returnUrl: "https://231146.knotkitchen.com/menu", orderData: { bills: { totalWithTax: 120, platformFee: 3.54 } },
  };
  const fakes = { "../models/websiteCheckoutModel": { findById: () => ({ lean: async () => checkout }) } };
  await withFakes(fakes, "../routes/payPageRoute", async (router) => {
    const handle = router.stack.find((l) => l.route?.path === "/:checkoutId").route.stack[0].handle;
    const res = { setHeader() {}, status() { return res; }, send(b) { res.body = b; return res; }, redirect() { return res; } };
    await handle({ params: { checkoutId: checkout._id } }, res);
    assert.match(res.body, /Order ₹120\.00 \+ Platform fee ₹3\.54 = ₹123\.54/);

    checkout.orderData.bills.platformFee = 0;
    checkout.amount = 120;
    await handle({ params: { checkoutId: checkout._id } }, res);
    assert.match(res.body, /Amount: ₹120\.00/);
    assert.ok(!/Platform fee/.test(res.body), "no fee, no fee line");
  });
});

// ---------------------------------------------------------------------------
// Table QR
// ---------------------------------------------------------------------------

test("table QR: verify and the webhook expect bill + the STORED fee, and hand that fee to the settle", () => {
  const qr = SRC("controllers/qrController.js");
  const verify = slice(qr, "const paymentVerify = async", "const placeLegacyOrder");
  assert.match(verify, /const platformFee = session\.payment\?\.platformFee;/);
  assert.match(verify, /const expected = round2\(payable \+ toRupees\(platformFee\?\.totalPaise\)\);/);
  assert.match(verify, /Math\.abs\(Number\(result\.amount\) - Number\(expected\)\) > 0\.01/);
  assert.match(verify, /amount: payable,\s*platformFee,/, "the bill is the amount; the fee rides alongside");
  assert.ok(!/req\.body/.test(verify));

  const hook = slice(SRC("controllers/cashfreeWebhookController.js"), "if (session) {", "const handleWebsiteCheckout");
  assert.match(hook, /const platformFee = session\.payment\?\.platformFee;/);
  assert.match(hook, /Math\.abs\(Number\(status\.amount\) - Number\(expected\)\) > 0\.01/);
  assert.match(hook, /amount: payable,\s*platformFee,/);

  // The diner's page is told the fee before tapping Pay, and the intent
  // reports it next to the bill.
  assert.match(qr, /onlinePlatformFee: onlinePaymentEnabled\s*\? toRupees\(\(await quotePlatformFee\(\{ restaurantId, source: "QR" \}\)\)\?\.totalPaise\)\s*: 0,/);
  const intent = slice(qr, "const paymentIntent = async", "const paymentVerify = async");
  assert.match(intent, /amount: online \? gatewayAmount : payable,\s*billAmount: payable,\s*platformFee: online \? platformFee : 0,/);
});

test("table QR: the phone step already quotes bill + fee, so Pay says what the gateway will charge", async () => {
  // A table opened at the till: no phone yet, so no checkout opens.
  const session = { _id: "s1", sessionCode: "TS1", status: "PAYMENT_PENDING", bills: { totalWithTax: 500 }, customerPhone: "", timeline: [], save: async () => {} };
  const fakes = {
    "./tableSessionController": { findActiveSessionByTable: async () => session },
    "../services/paymentGateway": { resolveGateway: async () => ({ enabled: true }), PROVIDERS: { CASHFREE: "CASHFREE" } },
    "../services/orderCharge": { quotePlatformFee: async () => ({ amountPaise: 100, taxPaise: 18, totalPaise: 118, taxPercent: 18 }) },
  };
  let body;
  let failure;
  const res = { status() { return res; }, json(b) { body = b; return res; } };
  await withFakes(fakes, "../controllers/qrController", ({ paymentIntent }) =>
    paymentIntent({ scope: { table: { _id: "t1" }, restaurantId: RESTAURANT_ID }, body: {}, query: {} }, res, (e) => { failure = e; }));
  assert.equal(failure, undefined, failure && failure.message);
  const d = body.data;
  assert.deepEqual([d.needsPhone, d.onlinePaymentEnabled, d.checkout], [true, false, null]);
  assert.deepEqual([d.billAmount, d.platformFee, d.amount], [500, 1.18, 501.18], "Bill / Platform fee / Payable");
});

/** recordSessionPayment over an in-memory session, Bill, ledger and orders. */
const settleHarness = async (run) => {
  const RID = RESTAURANT_ID;
  const state = { orderSet: null, txns: [], billCreate: null, charged: [] };
  const session = {
    _id: "507f1f77bcf86cd799439077",
    sessionCode: "TS_FEE_1",
    restaurantId: RID,
    tableId: "507f1f77bcf86cd799439099",
    status: "PAYMENT_PENDING",
    bills: { totalWithTax: 500 },
    // A quote stored when an online payment was opened.
    payment: { status: "PENDING", gatewayOrderId: "tbl_1", gatewayProvider: "cashfree", platformFee: { amountPaise: 100, taxPaise: 18, totalPaise: 118, taxPercent: 18 } },
    paymentHistory: [],
    timeline: [],
    items: [],
    toObject() { return this; },
    save: async () => {},
  };
  state.session = session;
  const mongoose = require("mongoose");
  const origStart = mongoose.startSession;
  mongoose.startSession = async () => ({ startTransaction() {}, commitTransaction: async () => {}, abortTransaction: async () => {}, endSession() {} });
  const fakes = {
    "./tableBookingController": { findActiveBlock: async () => null, blockedError: () => new Error("blocked"), formatTimeOf: () => "", upcomingBookingsByTable: async () => ({}) },
    "../models/tableSessionModel": { findOne: () => ({ session: async () => session, then: (res) => res(session) }) },
    "../models/tableModel": { findOneAndUpdate: async () => ({}) },
    "../models/paymentTransactionModel": { create: async (docs) => { state.txns.push(...docs); return docs; }, updateMany: async () => {} },
    "../models/billModel": { create: async (docs) => { state.billCreate = docs[0]; return [{ _id: "b1" }]; }, findOneAndUpdate: async () => {} },
    "../models/orderModel": { updateMany: async (q, u) => { state.orderSet = u.$set; } },
    "../services/eBillService": { fireAutoEBill: () => {} },
    "../services/orderCharge": { fireTableSessionCharge: (id) => state.charged.push(id) },
  };
  try {
    await withFakes(fakes, "../controllers/tableSessionController", (ctrl) => run(ctrl, state));
  } finally {
    mongoose.startSession = origStart;
  }
};

test("SECURITY: a till settle ignores req.body.platformFee, and clears a quote an abandoned online attempt left", async () => {
  await settleHarness(async ({ recordSessionPayment }, state) => {
    let failure;
    const res = { status() { return res; }, json() { return res; } };
    await recordSessionPayment({
      user: { restaurantId: RESTAURANT_ID, _id: "u1" },
      params: { id: state.session._id },
      body: { method: "CASH", amount: 500, paymentStatus: "success", platformFee: { totalPaise: 99999 } },
    }, res, (err) => { failure = err; });
    assert.equal(failure, undefined, failure && failure.message);

    assert.equal(state.session.bills.platformFee, 0, "a cash settle carries no fee");
    assert.equal(state.session.payment.platformFee.totalPaise, undefined, "the abandoned online quote is gone");
    assert.equal(state.txns[0].amount, 500);
    assert.equal(state.billCreate.paidAmount, 500);
    assert.equal(state.orderSet["bills.totalWithTax"], 500);
    assert.equal(state.orderSet["bills.platformFee"], 0);
    assert.equal(state.orderSet.payments[0].amount, 500);
    assert.deepEqual(state.charged, [], "a till settle is never charged");
  });
});

test("a failed till attempt keeps the stored fee, so the diner's open checkout can still settle", async () => {
  await settleHarness(async ({ recordSessionPayment }, state) => {
    let failure;
    const res = { status() { return res; }, json() { return res; } };
    // An ONLINE attempt at the till without a success status: not paid.
    await recordSessionPayment({
      user: { restaurantId: RESTAURANT_ID, _id: "u1" },
      params: { id: state.session._id },
      body: { method: "ONLINE", amount: 500 },
    }, res, (err) => { failure = err; });
    assert.equal(failure, undefined, failure && failure.message);
    assert.equal(state.session.payment.status, "FAILED");
    assert.equal(state.session.payment.platformFee.totalPaise, 118, "verify and the webhook still expect bill + this");
    assert.equal(state.session.bills.platformFee, undefined, "no fee was paid");
  });
});

test("a gateway settle records bill + the stored fee as money received; the bill stays the bill", async () => {
  await settleHarness(async ({ settleSessionFromGateway }, state) => {
    const fee = state.session.payment.platformFee;
    await settleSessionFromGateway({
      sessionId: state.session._id, restaurantId: RESTAURANT_ID, method: "ONLINE",
      amount: 500, platformFee: fee, transactionId: "cf_1", idempotencyKey: "qr-online-cf_1",
    });
    assert.equal(state.session.status, "CLOSED");
    assert.equal(state.session.bills.totalWithTax, 500, "restaurant revenue untouched");
    assert.equal(state.session.bills.platformFee, 1.18);
    assert.equal(state.session.payment.platformFee.totalPaise, 118, "the snapshot the wallet is debited");
    assert.equal(state.txns[0].amount, 501.18);
    assert.equal(state.billCreate.paidAmount, 501.18);
    assert.equal(state.orderSet["bills.totalWithTax"], 500);
    assert.equal(state.orderSet["bills.platformFee"], 1.18);
    assert.equal(state.orderSet.payments[0].amount, 501.18, "a refund sums payments, so it returns the fee too");
    assert.deepEqual(state.charged, [state.session._id], "the debit fires once the settle succeeded");
  });
});

// ---------------------------------------------------------------------------
// What the diner sees afterwards, and cancels
// ---------------------------------------------------------------------------

test("the e-bill and public receipt show the fee and the total paid", () => {
  const { buildReceipt } = require("../services/receiptService");
  const { render } = require("../controllers/publicReceiptController");
  const tableSession = { sessionCode: "TS1", status: "CLOSED", payment: { status: "PAID", method: "ONLINE" }, items: [], bills: { subtotal: 476.19, tax: 23.81, totalWithTax: 500, platformFee: 1.18 } };
  const r = buildReceipt({ tableSession, restaurant: { name: "Spice Hub" } });
  assert.deepEqual([r.total, r.platformFee, r.totalPaid], [500, 1.18, 501.18]);
  const html = render(r);
  assert.match(html, /Platform fee<\/span><span>₹1\.18/);
  assert.match(html, /Total paid<\/span><span>₹501\.18/);

  const plain = buildReceipt({ order: { items: [], orderStatus: "Completed", bills: { totalWithTax: 200 } }, restaurant: {} });
  assert.deepEqual([plain.platformFee, plain.totalPaid], [0, 200]);
  assert.ok(!/Platform fee/.test(render(plain)));

  assert.match(SRC("services/eBillService.js"), /total: Number\(receipt\.totalPaid \|\| receipt\.total \|\| 0\)\.toFixed\(2\),/, "the SMS quotes what was paid");
});

test("every cancel or reject of an order returns a fee it holds", () => {
  const order = slice(SRC("controllers/orderController.js"), "const updateOrder", "const cancelOrder");
  assert.match(order, /canonicalStatus\(nextStatus\) === CANCELLED\) \{\s*\/\/[^\n]*\n\s*fireOrderChargeReversal\(order\._id\);/);
  const online = SRC("controllers/onlineOrderController.js");
  assert.match(slice(online, "const updateOnlineOrderStatus", "const resolveAddedItems"), /if \(action === "reject" \|\| action === "cancel"\) \{\s*\/\/[^\n]*\n\s*fireOrderChargeReversal\(order\._id\);/);
  assert.match(slice(online, "const resolveAddedItems"), /if \(order\.orderStatus === CANCELLED\) fireOrderChargeReversal\(order\._id\);/);
});

test("the POS lock wording names unpaid platform fees, without a rate", () => {
  const src = SRC("services/accountLock.js");
  assert.match(src, /unpaid platform fee\(s\) totalling \$\{formatINR\(dues\.totalPaise\)\}\./);
  assert.match(src, /why: `\$\{dues\.count\} unpaid platform fee\(s\)\.`/);
  assert.ok(!/order charge/.test(src));
});
