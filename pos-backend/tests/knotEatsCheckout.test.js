/**
 * Knot Eats checkout: a store-website checkout that came through another front
 * door. Same pricing, payment, verify and settlement; what differs is the
 * listing check, the delivery point and distance, the fee source, where the
 * customer returns to, and signed tokens in place of bare ids.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

process.env.RECEIPT_LINK_SECRET = "knot-eats-checkout-test-signing-key-0123456789";
process.env.PAYMENT_PUBLIC_URL = "https://pay.example.com";

const realConfig = require("../config/config");
const Order = require("../models/orderModel");
const Customer = require("../models/customerModel");
const link = require("../services/receiptLink");
const { buildStorefrontUrl } = require("../services/websiteProvisioningService");

const STORE = "231146";
const RID = "507f1f77bcf86cd799439011";
const EATS_URL = "https://eats.example.com";
const WEB_FEE = { amountPaise: 300, taxPaise: 54, totalPaise: 354, taxPercent: 18 };
const KE_FEE = { amountPaise: 900, taxPaise: 162, totalPaise: 1062, taxPercent: 18 };
const ALL_DAY = { weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, openTime: "00:00", closeTime: "00:00" })) };
const naan = { _id: "507f1f77bcf86cd799439021", name: "Naan", price: 50, showOnWebsite: true, isAvailable: true };
const menu = { _id: "507f1f77bcf86cd799439022", published: true, items: [naan], hasPublishedToWebsite: true, websiteSnapshot: { name: "Breads", items: [naan] } };
const POINT = { lat: 22.5801, lng: 88.4102 };
const C_ID = "c".repeat(24);

const isIndiaPoint = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= 6 && lat <= 37.5 && lng >= 68 && lng <= 97.5;

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

const mkRes = () => {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.set = () => res;
  res.type = () => res;
  res.send = (b) => { res.body = b; return res; };
  return res;
};

/** The storefront controller against an in-memory store, gateway and Knot Eats listing. */
const world = (over = {}) => {
  const w = {
    listed: true,
    km: 3.2,
    eatsUrl: EATS_URL,
    paid: { paid: true },
    settings: {
      storeId: STORE, restaurantId: RID, slug: STORE, enabled: true,
      ordering: { pickupEnabled: true, deliveryEnabled: true, deliveryFee: 30, deliverySlabsConfig: { maxDistanceKm: 5, slabs: [] } },
      channelHours: { collection: ALL_DAY, delivery: ALL_DAY },
      couponsConfig: [],
    },
    checkouts: new Map(),
    gatewayCalls: [],
    distanceCalls: [],
    listedAsked: [],
    incs: [],
    ...over,
  };
  function WebsiteCheckout(doc) {
    Object.assign(this, doc);
    this._id = C_ID;
    this.status = "PENDING";
    this.save = async () => { w.checkouts.set(String(this._id), this); };
  }
  WebsiteCheckout.findById = async (id) => w.checkouts.get(String(id)) || null;
  WebsiteCheckout.findOne = async ({ _id, storeId }) => {
    const c = w.checkouts.get(String(_id));
    return c && c.storeId === storeId ? c : null;
  };
  WebsiteCheckout.findOneAndUpdate = async ({ _id }, { $set }) => {
    const c = w.checkouts.get(String(_id));
    if (!c || c.status !== "PENDING") return null;
    Object.assign(c, $set);
    return c;
  };
  WebsiteCheckout.updateOne = async ({ _id }, { $set }) => { Object.assign(w.checkouts.get(String(_id)) || {}, $set); };
  w.fakes = {
    "../services/storefrontResolver": {
      REASON_MESSAGES: {},
      resolveStorefront: async () => ({
        ok: true, settings: w.settings, store: { storeId: STORE }, restaurantId: RID, storeId: STORE,
        restaurant: { _id: RID, address: { lat: 22.5726, lng: 88.3639 } }, timezone: "Asia/Kolkata",
      }),
    },
    "../models/menuModel": { find: async () => [menu] },
    "../models/websiteCheckoutModel": WebsiteCheckout,
    "../models/websiteSettingsModel": { updateOne: async (q, u) => { w.incs.push([q, u]); } },
    "../services/paymentGateway": { resolveGateway: async () => ({ enabled: true, keyId: "k", secret: "s", environment: "TEST" }) },
    "../services/gateways/cashfree": {
      createOrder: async (args) => { w.gatewayCalls.push(args); return { orderId: args.orderId, paymentSessionId: "ps_1", environment: "TEST" }; },
      isOrderPaid: async () => ({ paid: w.paid.paid, amount: w.checkouts.get(C_ID)?.amount, cfOrderId: "cf_1" }),
    },
    "../services/orderCharge": {
      quotePlatformFee: async ({ source }) => ({ WEBSITE: { ...WEB_FEE }, KNOT_EATS: { ...KE_FEE } })[source] || null,
      fireOrderCharge: () => {},
    },
    "../services/knotEats": {
      getListedStore: async (id) => { w.listedAsked.push(id); return w.listed ? { storeId: id } : null; },
      isIndiaPoint,
      invalidateListing: () => {},
    },
    "../services/distanceService": {
      roadDistances: async (args) => {
        w.distanceCalls.push(args);
        return new Map([[args.stores[0].key, { km: w.km, minutes: 12, source: "road" }]]);
      },
    },
    "../services/socket": { emitOrderCreated: () => {} },
    "../config/config": Object.defineProperty({ ...realConfig }, "knotEatsPublicUrl", { get: () => w.eatsUrl }),
  };
  w.run = (fn) => withFakes(w.fakes, "../controllers/storefrontController", fn);
  /** Start a checkout through Knot Eats (the route sets req.knotEats) or the website. */
  w.start = (body, { knotEats = true } = {}) =>
    w.run(async ({ startStorefrontCheckout }) => {
      const res = mkRes();
      let error;
      await startStorefrontCheckout(
        { params: { slug: STORE }, headers: { host: "api.example.com" }, body, ...(knotEats ? { knotEats: true } : {}) },
        res,
        (err) => { error = err; },
      );
      return { res, error, checkout: w.checkouts.get(C_ID) };
    });
  return w;
};

const pickup = (over = {}) => ({
  orderType: "pickup", customer: { name: "Asha Roy", phone: "9876543210" },
  items: [{ menuId: menu._id, itemId: naan._id, quantity: 2 }], ...over,
});
const delivery = (over = {}) => pickup({
  orderType: "delivery", deliveryAddress: { line1: "12 Park Street", line2: "Flat 3", ...POINT }, ...over,
});

/** The DB-backed calls placing an order makes, answered in memory. */
const withOrderStubs = async (run) => {
  const saved = { save: Order.prototype.save, findById: Order.findById, cFind: Customer.findOne, cCreate: Customer.create };
  Order.prototype.save = async function save() { return this; };
  Customer.findOne = async () => null;
  Customer.create = async (d) => d;
  try {
    return await run();
  } finally {
    Order.prototype.save = saved.save;
    Order.findById = saved.findById;
    Customer.findOne = saved.cFind;
    Customer.create = saved.cCreate;
  }
};

test("a store that is not listed (or was delisted) cannot be checked out through Knot Eats", async () => {
  const w = world({ listed: false });
  const { error } = await w.start(pickup());
  assert.equal(error.status, 404);
  assert.equal(error.code, "KNOT_EATS_UNAVAILABLE");
  assert.equal(error.message, "This restaurant isn't on Knot Eats right now.");
  assert.deepEqual(w.listedAsked, [STORE], "asked about the store the URL resolved to");
  assert.equal(w.gatewayCalls.length, 0);
});

test("Knot Eats delivery needs a real point in India", async () => {
  for (const addr of [{}, { lat: 0, lng: 0 }, { lat: 88.4, lng: 22.58 }, { lat: "x", lng: 88 }]) {
    const w = world();
    const { error } = await w.start(delivery({ deliveryAddress: { line1: "12 Park Street", ...addr } }));
    assert.equal(error?.status, 400, JSON.stringify(addr));
    assert.equal(error.code, "LOCATION_REQUIRED");
    assert.equal(w.distanceCalls.length, 0);
  }
});

test("a road distance beyond the radius is refused with the slab message", async () => {
  const w = world({ km: 9.4 });
  const { error } = await w.start(delivery());
  assert.equal(error.status, 400);
  assert.match(error.message, /exceeds maximum allowed limit of 5 km/);
  assert.equal(w.gatewayCalls.length, 0);
});

test("the Knot Eats checkout: channel, point, distance, Knot Eats fee, return URL, gateway tags and a signed token", async () => {
  const w = world();
  const { res, error, checkout } = await w.start(delivery());
  assert.equal(error, undefined, error?.message);
  const data = checkout.orderData;

  assert.equal(data.salesChannel, "KNOT_EATS");
  assert.equal(data.source, "WEBSITE", "every website flow still applies");
  assert.deepEqual(
    [data.deliveryAddress.lat, data.deliveryAddress.lng, data.deliveryAddress.distanceKm, data.deliveryAddress.distanceSource],
    [POINT.lat, POINT.lng, 3.2, "road"],
  );
  assert.deepEqual(w.distanceCalls[0].origin, POINT);
  assert.deepEqual(w.distanceCalls[0].stores, [{ key: STORE, lat: 22.5726, lng: 88.3639 }], "from the store's own pin");

  const pc = data.platformCharge;
  assert.deepEqual([pc.amountPaise, pc.taxPaise, pc.totalPaise], [900, 162, 1062], "the KNOT_EATS quote, not the website's");
  assert.equal(data.bills.platformFee, 10.62);
  assert.equal(checkout.amount, Math.round((data.bills.totalWithTax + 10.62) * 100) / 100);
  assert.equal(w.gatewayCalls[0].amount, checkout.amount);

  assert.equal(checkout.returnUrl, `${EATS_URL}/store/${STORE}`);
  assert.deepEqual(w.gatewayCalls[0].tags, { websiteCheckoutId: C_ID, restaurantId: RID, salesChannel: "KNOT_EATS" });

  assert.match(res.body.data.checkoutToken, /^c_[a-f0-9]{24}_[A-Za-z0-9_-]{22}$/);
  const parsed = link.readToken(res.body.data.checkoutToken);
  assert.deepEqual([parsed.isCheckout, parsed.id], [true, C_ID]);
  assert.equal(res.body.data.platformFee, 10.62);
  // The pay page is keyed by that token too, never the bare id.
  assert.equal(res.body.data.payUrl, `https://pay.example.com/c/${res.body.data.checkoutToken}`);
  assert.equal(w.gatewayCalls[0].returnUrl, `https://pay.example.com/c/${res.body.data.checkoutToken}/done`);
});

test("without KNOT_EATS_PUBLIC_URL there is no Knot Eats checkout (503), and the gateway is never opened", async () => {
  const w = world({ eatsUrl: "" });
  const { error } = await w.start(pickup());
  assert.equal(error.status, 503);
  assert.equal(error.code, "KNOT_EATS_NOT_CONFIGURED");
  assert.equal(w.gatewayCalls.length, 0);
});

test("a channel, price, fee or distance in the body is ignored", async () => {
  const w = world();
  const tampered = delivery({
    salesChannel: "", platformFee: 0, amount: 1,
    deliveryAddress: { line1: "12 Park Street", ...POINT, distanceKm: 0.1, distanceSource: "road" },
    items: [{ menuId: menu._id, itemId: naan._id, quantity: 2, price: 1 }],
  });
  const { checkout } = await w.start(tampered);
  assert.equal(checkout.orderData.salesChannel, "KNOT_EATS");
  assert.equal(checkout.orderData.deliveryAddress.distanceKm, 3.2);
  assert.equal(checkout.orderData.items[0].total, 100);
  assert.equal(checkout.orderData.platformCharge.totalPaise, 1062);

  // ...and the body cannot opt a website order into Knot Eats either.
  const web = world();
  const { checkout: webCheckout } = await web.start(pickup({ salesChannel: "KNOT_EATS" }), { knotEats: false });
  assert.equal(webCheckout.orderData.salesChannel, "");
  assert.equal(webCheckout.orderData.platformCharge.totalPaise, 354);
});

test("REGRESSION: the website checkout and its order view are what they were", async () => {
  const w = world();
  const { res, checkout } = await w.start(delivery(), { knotEats: false });
  assert.deepEqual(Object.keys(res.body.data), ["checkoutId", "amount", "billAmount", "platformFee", "currency", "payUrl", "checkout"]);
  assert.equal(res.body.data.payUrl, `https://pay.example.com/c/${C_ID}`);
  assert.equal(checkout.returnUrl, `${buildStorefrontUrl(w.settings)}/menu`);
  assert.deepEqual(w.gatewayCalls[0].tags, { websiteCheckoutId: C_ID, restaurantId: RID });
  assert.equal(checkout.orderData.salesChannel, "");
  assert.equal(checkout.orderData.deliveryAddress.lat, undefined, "the website path stores no point");
  assert.equal(checkout.orderData.deliveryAddress.distanceKm, undefined);
  assert.deepEqual([w.distanceCalls.length, w.listedAsked.length], [0, 0], "nothing from Knot Eats is consulted");

  const { publicOrderView } = require("../controllers/storefrontController");
  const view = publicOrderView(new Order({ orderNumber: "123456", items: [], bills: { totalWithTax: 99 }, source: "WEBSITE" }));
  assert.deepEqual(Object.keys(view), ["orderId", "orderNumber", "status", "orderType", "placedAt", "scheduledFor", "items", "bills", "totalPaid", "customer"]);

  const eats = new Order({ orderNumber: "123457", items: [], bills: { totalWithTax: 99 }, source: "WEBSITE", salesChannel: "KNOT_EATS" });
  const eatsView = publicOrderView(eats);
  assert.equal(eatsView.salesChannel, "KNOT_EATS");
  assert.equal(eatsView.customer, undefined, "no name or phone on a Knot Eats view");
  const parsed = link.readToken(eatsView.orderToken);
  assert.deepEqual([parsed.isEatsOrder, parsed.id], [true, String(eats._id)]);
});

test("the pay page: a Knot Eats checkout only by its c_ token (a bare id is 404), a website one by its raw id", async () => {
  const checkouts = {
    [C_ID]: { _id: C_ID, status: "PLACED", returnUrl: `${EATS_URL}/store/${STORE}`, orderData: { salesChannel: "KNOT_EATS" } },
    ["d".repeat(24)]: { _id: "d".repeat(24), status: "PLACED", returnUrl: `https://${STORE}.example.com/menu`, orderData: { salesChannel: "" } },
  };
  const fakes = { "../models/websiteCheckoutModel": { findById: (id) => ({ lean: async () => checkouts[id] || null }) } };
  await withFakes(fakes, "../routes/payPageRoute", async (router) => {
    const done = router.stack.find((l) => l.route?.path === "/:checkoutId/done").route.stack[0].handle;
    const go = async (id) => {
      let to = null;
      let status = 302;
      const res = { setHeader() {}, redirect: (code, url) => { to = url; }, status: (c) => ((status = c), res), send: () => res };
      await done({ params: { checkoutId: id } }, res);
      return status === 404 ? 404 : new URL(to);
    };
    assert.equal(await go(C_ID), 404, "a guessed bare id never turns into a c_ token");
    const eats = await go(link.tokenForCheckout(C_ID));
    assert.equal(eats.origin + eats.pathname, `${EATS_URL}/store/${STORE}`);
    const token = eats.searchParams.get("checkout");
    assert.match(token, /^c_/);
    assert.deepEqual([link.readToken(token).isCheckout, link.readToken(token).id], [true, C_ID]);

    assert.equal((await go("d".repeat(24))).searchParams.get("checkout"), "d".repeat(24));
  });
});

test("Knot Eats verify: only its own signed c_ token; paid places the order with an order token, unpaid is 402", async () => {
  const w = world();
  await w.start(pickup());
  const token = link.tokenForCheckout(C_ID);

  const verify = (t) =>
    w.run(async ({ verifyKnotEatsCheckout }) => {
      const res = mkRes();
      let error;
      const req = { params: { token: t }, headers: { host: "api.example.com" } };
      await verifyKnotEatsCheckout(req, res, (err) => { error = err; });
      return { res, error };
    });

  await withOrderStubs(async () => {
    for (const bad of [`${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`, link.tokenForOrder(C_ID), C_ID, "c_nope"]) {
      assert.equal((await verify(bad)).error?.status, 404, bad);
    }

    w.paid.paid = false;
    assert.equal((await verify(token)).error.status, 402);

    w.paid.paid = true;
    const { res, error } = await verify(token);
    assert.equal(error, undefined, error?.message);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.salesChannel, "KNOT_EATS");
    const parsed = link.readToken(res.body.data.orderToken);
    assert.equal(parsed.isEatsOrder, true);
    assert.equal(w.checkouts.get(C_ID).status, "PLACED");
  });

  // A website checkout cannot be confirmed through Knot Eats, even with a valid c_ token.
  const web = world();
  await web.start(pickup(), { knotEats: false });
  const { error } = await web.run(async ({ verifyKnotEatsCheckout }) => {
    let err;
    await verifyKnotEatsCheckout({ params: { token }, headers: {} }, mkRes(), (e) => { err = e; });
    return { error: err };
  });
  assert.equal(error.status, 404);
});

test("the storefront verify refuses a Knot Eats checkout by its bare id", async () => {
  const w = world();
  await w.start(pickup());
  const { error } = await w.run(async ({ verifyStorefrontCheckout }) => {
    let err;
    await verifyStorefrontCheckout({ params: { slug: STORE, checkoutId: C_ID }, headers: {} }, mkRes(), (e) => { err = e; });
    return { error: err };
  });
  assert.equal(error.status, 404, "a guessed id must not mint an order token");
});

test("/r/<token>: c_ and v_ tokens are not bills (404); s_ and o_ still render; a finished Knot Eats order invites a review", async () => {
  const ORDER_ID = "e".repeat(24);
  let sessionLookups = 0;
  const order = { _id: ORDER_ID, restaurantId: RID, salesChannel: "KNOT_EATS", orderStatus: "Completed" };
  const receipt = {
    paymentStatus: "PAID", dateTime: new Date(), items: [], restaurant: { name: "Spice Route" }, orderNumber: "123456",
    subtotal: 100, total: 100, totalPaid: 100, quantities: 1,
  };
  const fakes = {
    "../models/orderModel": { findOne: async () => order },
    "../models/billModel": { findOne: async () => null, findById: async () => null },
    "../models/tableSessionModel": { findOne: () => { sessionLookups += 1; return { populate: async () => ({ _id: "s1", restaurantId: RID }) }; } },
    "../models/restaurantModel": { findById: async () => ({ name: "Spice Route" }) },
    "../services/receiptService": { buildReceipt: () => receipt },
    "../services/eBillService": { orderForSession: async () => null },
    "../config/config": { ...realConfig, knotEatsPublicUrl: EATS_URL },
  };
  await withFakes(fakes, "../controllers/publicReceiptController", async ({ viewPublicReceipt }) => {
    const view = async (token) => {
      const res = mkRes();
      await viewPublicReceipt({ params: { token } }, res);
      return res;
    };
    for (const token of [link.tokenForCheckout(C_ID), link.tokenForEatsOrder(ORDER_ID)]) {
      assert.equal((await view(token)).statusCode, 404, token.slice(0, 2));
    }
    assert.equal(sessionLookups, 0, "never looked up as a table session");
    assert.equal((await view(link.tokenForSession("f".repeat(24)))).statusCode, 200, "a table bill still renders");

    const bill = await view(link.tokenForOrder(ORDER_ID));
    assert.equal(bill.statusCode, 200);
    const href = /href="([^"]+)">Rate this order on Knot Eats/.exec(bill.body)?.[1];
    assert.ok(href, "the review link is on the bill");
    const m = /^https:\/\/eats\.example\.com\/order\/(v_[^#]+)#review$/.exec(href);
    assert.ok(m, href);
    assert.deepEqual([link.readToken(m[1]).isEatsOrder, link.readToken(m[1]).id], [true, ORDER_ID]);

    order.orderStatus = "Preparing";
    assert.doesNotMatch((await view(link.tokenForOrder(ORDER_ID))).body, /Rate this order/, "not before it is finished");
    order.orderStatus = "Completed";
    order.salesChannel = "";
    assert.doesNotMatch((await view(link.tokenForOrder(ORDER_ID))).body, /Rate this order/, "not on a website order");
  });
});

test("the webhook's settlement places a Knot Eats order with its channel and delivery point", async () => {
  const w = world();
  await w.start(delivery());
  const checkout = w.checkouts.get(C_ID);
  await withOrderStubs(() =>
    w.run(async ({ placePaidCheckout }) => {
      const out = await placePaidCheckout({ checkout, paid: { cfOrderId: "cf_9" }, restaurantId: RID, outletId: null, storeId: STORE });
      assert.equal(out.already, false);
      assert.equal(out.placed.salesChannel, "KNOT_EATS");
      assert.equal(out.placed.source, "WEBSITE");
      assert.deepEqual([out.placed.deliveryAddress.lat, out.placed.deliveryAddress.distanceSource], [POINT.lat, "road"]);
      assert.equal(out.placed.platformCharge.totalPaise, 1062);
    }),
  );
});

test("the Knot Eats fee is debited under its own name and returned when the order is rejected", async () => {
  const order = {
    _id: "e".repeat(24), restaurantId: RID, orderNumber: "123456", source: "WEBSITE", salesChannel: "KNOT_EATS",
    orderStatus: "Pending", payments: [{ method: "online", status: "paid" }], paymentData: { gatewayOrderId: "web_x" },
    platformCharge: { ...KE_FEE }, save: async () => order,
  };
  const ledger = [];
  const fakes = {
    "../models/orderModel": {
      findById: async () => order,
      find: () => ({ select: () => ({ sort: () => ({ lean: async () => [] }) }) }),
    },
    "./ledger": {
      debit: async (e) => { ledger.push({ direction: "DEBIT", ...e }); return { entry: { _id: "l1" } }; },
      credit: async (e) => { ledger.push({ direction: "CREDIT", ...e }); return { entry: { _id: "l2" } }; },
      findByIdempotencyKey: async () => ({ _id: "l1", direction: "DEBIT", kind: "ORDER_CHARGE", restaurantId: RID, amountPaise: 1062 }),
      InsufficientBalanceError: class extends Error {},
    },
    "./accountLock": { fireEvaluateLock: () => {} },
  };
  await withFakes(fakes, "../services/orderCharge", async ({ chargeOrder, reverseOrderCharge }) => {
    assert.equal((await chargeOrder(order._id)).charged, true);
    assert.equal(ledger[0].description, "Knot Eats fee — #123456");
    assert.equal(ledger[0].amountPaise, 1062);
    assert.equal(ledger[0].meta.source, "KNOT_EATS");

    order.orderStatus = "Cancelled";
    const back = await reverseOrderCharge(order._id);
    assert.deepEqual([back.reversed, back.credited], [true, true]);
    assert.deepEqual([ledger[1].direction, ledger[1].amountPaise], ["CREDIT", 1062]);
    assert.equal(order.platformCharge.status, "WAIVED");
  });
});

// ---------------------------------------------------------------------------
// Coupons at checkout (website and Knot Eats alike)
// ---------------------------------------------------------------------------

const WELCOME = { code: "WELCOME50", type: "percent", value: 50, usageLimitPerPhone: 1, quantityTotal: 100, quantityUsed: 3, isActive: true };

test("a coupon is limited per phone (409 COUPON_USED) and recorded on the order", async () => {
  const saved = Order.countDocuments;
  const asked = [];
  let used = 1;
  Order.countDocuments = async (q) => { asked.push(q); return used; };
  try {
    const w = world();
    w.settings.couponsConfig = [{ ...WELCOME }];
    const { error } = await w.start(pickup({ couponCode: "welcome50" }));
    assert.equal(error.status, 409);
    assert.equal(error.code, "COUPON_USED");
    assert.equal(error.message, "You've already used this coupon.");
    assert.equal(asked[0].couponCode, "WELCOME50");
    assert.equal(asked[0]["customerDetails.phone"], "9876543210");
    assert.equal(String(asked[0].restaurantId), RID);
    assert.ok(asked[0].orderStatus.$nin.includes("Cancelled"), "a cancelled order does not use it up");

    used = 0;
    const ok = await w.start(pickup({ couponCode: " welcome50 " }));
    assert.equal(ok.error, undefined, ok.error?.message);
    assert.equal(ok.checkout.orderData.couponCode, "WELCOME50");
    assert.equal(ok.checkout.orderData.bills.discount, 50);

    // No limit: nothing to count.
    asked.length = 0;
    w.settings.couponsConfig = [{ ...WELCOME, usageLimitPerPhone: 0 }];
    assert.equal((await w.start(pickup({ couponCode: "WELCOME50" }))).error, undefined);
    assert.equal(asked.length, 0);

    // No coupon, no code on the order.
    assert.equal((await w.start(pickup())).checkout.orderData.couponCode, "");
  } finally {
    Order.countDocuments = saved;
  }
});

test("a coupon's use is counted once, when its order is paid and placed, and never again", async () => {
  const saved = Order.countDocuments;
  Order.countDocuments = async () => 0;
  try {
    const w = world();
    w.settings.couponsConfig = [{ ...WELCOME }];
    await w.start(pickup({ couponCode: "WELCOME50" }));
    const checkout = w.checkouts.get(C_ID);
    await withOrderStubs(() =>
      w.run(async ({ placePaidCheckout }) => {
        const first = await placePaidCheckout({ checkout, paid: {}, restaurantId: RID, storeId: STORE });
        assert.equal(first.already, false);
        await new Promise((r) => setImmediate(r));
        assert.deepEqual(w.incs, [[
          { storeId: STORE, "couponsConfig.code": "WELCOME50" },
          { $inc: { "couponsConfig.$.quantityUsed": 1 } },
        ]]);

        // The browser's verify and the webhook both arrive: the second adopts the order.
        Order.findById = async () => first.placed;
        const again = await placePaidCheckout({ checkout, paid: {}, restaurantId: RID, storeId: STORE });
        assert.equal(again.already, true);
        await new Promise((r) => setImmediate(r));
        assert.equal(w.incs.length, 1, "not counted on `already`");
      }),
    );
  } finally {
    Order.countDocuments = saved;
  }
});

test("Store Properties refuses a map pin outside India (swapped pairs), clears a blank one, and refreshes the listing", async () => {
  const bcrypt = require("bcrypt");
  const Restaurant = require("../models/restaurantModel");
  const AuditLog = require("../models/auditLogModel");
  const doc = { name: "Spice Route", securityPin: await bcrypt.hash("1234", 4), address: {}, save: async () => doc };
  const saved = { find: Restaurant.findOne, log: AuditLog.create };
  Restaurant.findOne = async () => doc;
  AuditLog.create = async () => ({});
  let invalidations = 0;
  const fakes = { "../services/knotEats": { isIndiaPoint, invalidateListing: () => { invalidations += 1; } } };
  try {
    await withFakes(fakes, "../controllers/restaurantController", async ({ updateStoreProperties }) => {
      const run = async (latitude, longitude) => {
        let error;
        await updateStoreProperties(
          { body: { pin: "1234", latitude, longitude }, user: { restaurantId: RID, role: "Owner" } },
          mkRes(),
          (err) => { error = err; },
        );
        return error;
      };
      const swapped = await run("88.3639", "22.5726");
      assert.equal(swapped.status, 400);
      assert.match(swapped.message, /outside India/);
      assert.equal((await run("22.5726", "")).status, 400, "half a pin is not a pin");
      assert.equal(invalidations, 0, "nothing saved, nothing to refresh");

      assert.equal(await run("22.5726", "88.3639"), undefined);
      assert.deepEqual([doc.address.lat, doc.address.lng], [22.5726, 88.3639]);
      assert.equal(await run("", ""), undefined, "blank clears it");
      assert.deepEqual([doc.address.lat, doc.address.lng], [null, null]);
      assert.equal(await run("0", "0"), undefined, "0,0 is stored as no pin, as before");
      assert.deepEqual([doc.address.lat, doc.address.lng], [null, null]);
      assert.equal(invalidations, 3);
    });
  } finally {
    Restaurant.findOne = saved.find;
    AuditLog.create = saved.log;
  }
});

test("order types, timings, holidays and Closed for Today each refresh the Knot Eats listing", async () => {
  const doc = { _id: RID, save: async () => doc };
  let invalidations = 0;
  const writes = [];
  const fakes = {
    "../services/knotEats": { invalidateListing: () => { invalidations += 1; } },
    "../models/restaurantModel": { findOne: async () => doc, findById: () => ({ select: () => ({ lean: async () => doc }) }) },
    "../models/websiteSettingsModel": { findOneAndUpdate: async (q, u) => { writes.push(u.$set); return {}; } },
  };
  await withFakes(fakes, "../controllers/restaurantController", async (ctrl) => {
    const user = { restaurantId: RID, role: "Owner" };
    const bodies = {
      updateOrderToggles: { collection: true, delivery: false },
      updateChannelTimings: { channel: "delivery", data: ALL_DAY },
      updateHolidays: { holidays: [{ startDate: "2026-10-20", endDate: "2026-10-21" }] },
      toggleClosedForToday: { enabled: true },
    };
    for (const [name, body] of Object.entries(bodies)) {
      const before = invalidations;
      let error;
      await ctrl[name]({ body, user }, mkRes(), (e) => { error = e; });
      assert.equal(error, undefined, `${name}: ${error?.message}`);
      assert.equal(invalidations, before + 1, name);
    }
    assert.equal(writes.length, 4);
  });
});

test("Send e-bill on a Knot Eats order goes only to the diner's phone and never hands the store the bill link", async () => {
  const sent = [];
  const order = { _id: "e".repeat(24), salesChannel: "KNOT_EATS", customerDetails: { phone: "9876543210" } };
  const fakes = {
    "../services/eBillService": {
      loadEBillSubject: async () => ({ order }),
      deliverEBill: async ({ phone }) => {
        sent.push(phone);
        return { receipt: {}, billUrl: "https://api.example.com/r/o_x", result: { sent: true, deliveryStatus: "DELIVERED", devMessage: "View receipt: https://api.example.com/r/o_x" } };
      },
    },
  };
  await withFakes(fakes, "../controllers/receiptController", async ({ sendEBill }) => {
    const send = async () => {
      const res = mkRes();
      let error;
      await sendEBill({ body: { orderId: order._id, phone: "9000000001" }, user: { restaurantId: RID } }, res, (e) => { error = e; });
      assert.equal(error, undefined, error?.message);
      return res.body.data;
    };
    const eats = await send();
    assert.equal(sent[0], undefined, "the body's phone is ignored: the diner's own is used");
    assert.equal(eats.billUrl, null);
    assert.doesNotMatch(JSON.stringify(eats), /o_x/);

    order.salesChannel = "";
    const web = await send();
    assert.equal(sent[1], "9000000001", "a website or POS order still goes where staff say");
    assert.equal(web.billUrl, "https://api.example.com/r/o_x");
  });
});
