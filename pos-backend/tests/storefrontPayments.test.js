/**
 * Website and Knot Eats payments (QA batch 8, N021c, N021d).
 *
 * The real storefront controller with its models and Cashfree faked in
 * memory: a second paid checkout for the same cart is refunded, never
 * absorbed; a Cashfree order never outlives our record of its checkout.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const RID = "507f1f77bcf86cd799439011";

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

/**
 * Cart K was placed as order oB, paid through checkout B (Cashfree order
 * web_B). Checkout A, opened for the same cart, was paid too (web_A).
 */
const secondPayment = ({ refund, firstOrderId = "web_B" } = {}) => {
  const state = { refunds: [], emits: 0, charges: 0, customers: 0 };
  const orderB = { _id: "oB", idempotencyKey: "K", paymentData: { gatewayOrderId: firstOrderId }, customerDetails: { phone: "9876543210" }, bills: {} };
  const A = { _id: "A", status: "PENDING", gatewayOrderId: "web_A", amount: 500, orderData: { idempotencyKey: "K" } };
  class FakeOrder {
    constructor(d) { Object.assign(this, d); }
  }
  FakeOrder.findOne = async (f) => (f.idempotencyKey === "K" ? orderB : null);
  FakeOrder.findById = async () => orderB;
  const fakes = {
    "../models/orderModel": FakeOrder,
    "../models/customerModel": {
      findOne: async () => ((state.customers += 1), null),
      create: async (d) => d,
    },
    "../models/websiteCheckoutModel": {
      findOneAndUpdate: async (f, u) => (A.status === f.status ? Object.assign(A, u.$set) : null),
      findById: async () => A,
      updateOne: async (f, u) => Object.assign(A, u.$set),
    },
    "../services/socket": { emitOrderCreated: () => { state.emits += 1; } },
    "../services/orderCharge": { fireOrderCharge: () => { state.charges += 1; } },
    "../services/paymentGateway": { resolveGateway: async () => ({ enabled: true, keyId: "k", secret: "s", environment: "TEST" }) },
    "../services/gateways/cashfree": {
      refundUnappliedPayment: async (args) => {
        state.refunds.push(args);
        if (refund) return refund(args);
        return { refundId: "ua_x", cfRefundId: "cf1", status: "PENDING", amount: args.amount };
      },
    },
  };
  const place = (ctrl) => ctrl.placePaidCheckout({ checkout: A, paid: { cfOrderId: "cf_A", amount: 500 }, restaurantId: RID, outletId: null, storeId: "123456" });
  return { state, A, fakes, place };
};

test("N021c: a second paid checkout for the same cart is refunded once, and the customer sees their one order", async () => {
  const { state, A, fakes, place } = secondPayment();
  await withFakes(fakes, "../controllers/storefrontController", async (ctrl) => {
    const out = await place(ctrl);
    assert.equal(out.placed._id, "oB");
    assert.equal(out.already, true);
  });
  assert.equal(state.refunds.length, 1);
  assert.equal(state.refunds[0].orderId, "web_A");
  assert.equal(state.refunds[0].amount, 500);
  assert.equal(state.refunds[0].note, "Order already paid");
  assert.equal(state.refunds[0].gw.keyId, "k");
  assert.deepEqual([A.status, A.orderId], ["PLACED", "oB"]);
  assert.deepEqual([state.emits, state.charges, state.customers], [0, 0, 0], "no second announce, wallet debit or customer visit");
});

test("N021c: a refund that fails leaves the checkout PENDING and throws, so the next verify or webhook retries", async () => {
  const { state, A, fakes, place } = secondPayment({ refund: async () => { throw new Error("Cashfree down"); } });
  await withFakes(fakes, "../controllers/storefrontController", async (ctrl) => {
    await assert.rejects(place(ctrl), /Cashfree down/);
  });
  assert.equal(A.status, "PENDING");
  assert.equal(state.emits, 0);
});

test("N021c: the same checkout found already placed (same Cashfree order) is adopted, not refunded", async () => {
  const { state, fakes, place } = secondPayment({ firstOrderId: "web_A" });
  await withFakes(fakes, "../controllers/storefrontController", async (ctrl) => {
    assert.equal((await place(ctrl)).placed._id, "oB");
  });
  assert.equal(state.refunds.length, 0);
});

test("N021d: the Cashfree order expires an hour before our record of the checkout", async () => {
  const ALL_DAY = { weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, openTime: "00:00", closeTime: "00:00" })) };
  const naan = { _id: "507f1f77bcf86cd799439021", name: "Naan", price: 50, showOnWebsite: true, isAvailable: true };
  const menu = { _id: "507f1f77bcf86cd799439022", published: true, items: [naan], hasPublishedToWebsite: true, websiteSnapshot: { name: "Breads", items: [naan] } };
  const settings = {
    storeId: "123456", restaurantId: RID, slug: "royal-palace", enabled: true,
    ordering: { pickupEnabled: true }, channelHours: { collection: ALL_DAY, delivery: ALL_DAY },
  };
  // The real model, so expiresAt is its real TTL default.
  const RealCheckout = require("../models/websiteCheckoutModel");
  let checkout;
  function WebsiteCheckout(doc) {
    checkout = new RealCheckout(doc);
    checkout.save = async () => checkout;
    return checkout;
  }
  let gatewayArgs;
  const fakes = {
    "../services/storefrontResolver": {
      resolveStorefront: async () => ({ ok: true, settings, store: { storeId: "123456" }, restaurantId: RID, storeId: "123456" }),
    },
    "../models/menuModel": { find: async () => [menu] },
    "../models/websiteCheckoutModel": WebsiteCheckout,
    "../services/paymentGateway": { resolveGateway: async () => ({ enabled: true, keyId: "k", secret: "s", environment: "TEST" }) },
    "../services/gateways/cashfree": {
      createOrder: async (args) => { gatewayArgs = args; return { orderId: args.orderId, paymentSessionId: "ps_1", environment: "TEST" }; },
    },
    "../services/orderCharge": { quotePlatformFee: async () => null },
  };
  await withFakes(fakes, "../controllers/storefrontController", async ({ startStorefrontCheckout }) => {
    const res = { status() { return res; }, json() { return res; } };
    let failure;
    await startStorefrontCheckout({
      params: { slug: "royal-palace" },
      headers: { host: "123456.knotkitchen.in" },
      body: { orderType: "pickup", customer: { name: "Asha", phone: "9876543210" }, items: [{ menuId: menu._id, itemId: naan._id, quantity: 1 }] },
    }, res, (err) => { failure = err; });
    assert.equal(failure, undefined, failure && failure.message);
  });
  assert.ok(gatewayArgs.expiresAt instanceof Date);
  assert.equal(checkout.expiresAt - gatewayArgs.expiresAt, 3600 * 1000);
  const ahead = gatewayArgs.expiresAt - Date.now();
  assert.ok(Math.abs(ahead - 23 * 3600 * 1000) < 60 * 1000, `about 23 h ahead, got ${ahead / 3600000} h`);
});
