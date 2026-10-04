/**
 * Knot Eats order page and reviews (/api/eats/orders/:token[/review]).
 *
 * No accounts: the signed `v_` link is the diner's only credential, so it
 * must not be interchangeable with any other token kind, and the review rules
 * (completed, not refunded, within 14 days, once) are enforced server-side.
 */
process.env.RECEIPT_LINK_SECRET = "knot-eats-review-test-secret-0123456789";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const db = {};
const invalidations = [];
let seq = 0;
const oid = () => (++seq).toString(16).padStart(24, "0");

const mocks = {
  "../models/orderModel": {
    findOne: async ({ _id }) => db.orders.find((o) => o._id === _id && !o.isDeleted) || null,
  },
  "../models/websiteSettingsModel": {
    findOne: () => ({
      select: async () => ({ storeId: "100001", displayName: "Spice Hub", branding: { logo: { url: "/l.png" } },
        contact: { phone: "+91 33 4000 0000", mapUrl: "https://maps.example/spice" }, publishedSnapshot: null }),
    }),
  },
  "../models/restaurantModel": {
    findById: () => ({ lean: async () => ({ name: "Spice Hub Pvt", ownerPhone: "9000000000", address: {} }) }),
  },
  "../models/knotEatsReviewModel": {
    findOne: ({ orderId }) => ({
      select: () => ({ lean: async () => db.reviews.find((r) => String(r.orderId) === String(orderId)) || null }),
    }),
    create: async (doc) => {
      if (db.reviews.some((r) => String(r.orderId) === String(doc.orderId))) {
        throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
      }
      const row = { ...doc, hidden: false, createdAt: new Date() };
      db.reviews.push(row);
      return row;
    },
  },
  "../services/knotEats": {
    UNAVAILABLE_MESSAGE: "This restaurant isn't on Knot Eats right now.",
    invalidateListing: () => invalidations.push(1),
  },
};
const orig = Module._load;
Module._load = function (request, parent) {
  if (/controllers[\\/]knotEatsController\.js$/.test(parent?.filename || "") && request in mocks) return mocks[request];
  return orig.apply(this, arguments);
};
const ctrl = require("../controllers/knotEatsController");
const { tokenForOrder, tokenForCheckout, tokenForEatsOrder } = require("../services/receiptLink");

const DAY = 24 * 60 * 60 * 1000;
const addOrder = (o = {}) => {
  const order = {
    _id: oid(),
    storeId: "100001",
    restaurantId: oid(),
    orderNumber: "W-1042",
    orderStatus: "Completed",
    orderType: "delivery",
    salesChannel: "KNOT_EATS",
    source: "WEBSITE",
    completedAt: new Date(Date.now() - DAY),
    updatedAt: new Date(),
    createdAt: new Date(Date.now() - DAY),
    refundStatus: "NOT_REFUNDED",
    customerDetails: { name: "Asmit Ghosh", phone: "9876543210" },
    deliveryAddress: { line1: "12 Park St", line2: "Flat 3", city: "Kolkata", lat: 22.55, lng: 88.35, distanceKm: 2.1 },
    items: [{ name: "Veg Thali", quantity: 1, unitPrice: 150, total: 150 }],
    bills: { total: 150, tax: 7.5, totalWithTax: 157.5, platformFee: 10.62 },
    ...o,
  };
  db.orders.push(order);
  return { order, token: tokenForEatsOrder(order._id) };
};

const call = async (handler, req) => {
  let status = 200;
  let body = null;
  let err = null;
  const res = { set: () => res, status: (c) => ((status = c), res), json: (b) => ((body = b), res) };
  await handler({ params: {}, query: {}, body: {}, headers: {}, ...req }, res, (e) => (err = e));
  return { status: err ? err.status : status, code: err?.code, message: err?.message, data: body?.data };
};
const review = (token, body) => call(ctrl.postReview, { params: { token }, body });

beforeEach(() => {
  db.orders = [];
  db.reviews = [];
  invalidations.length = 0;
});

test("SECURITY: only a valid v_ token for a Knot Eats order opens it", async () => {
  const { order, token } = addOrder();
  const website = addOrder({ salesChannel: "" });
  const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  for (const t of [tokenForOrder(order._id), tokenForCheckout(order._id), tampered, website.token, "v_nope", ""]) {
    assert.equal((await call(ctrl.getOrder, { params: { token: t } })).status, 404, t);
    assert.equal((await review(t, { rating: 5 })).status, 404, t);
  }
  const deleted = addOrder({ isDeleted: true });
  assert.equal((await call(ctrl.getOrder, { params: { token: deleted.token } })).status, 404);
  assert.equal((await call(ctrl.getOrder, { params: { token } })).status, 200);
});

test("the order page: stage, review state, and only what the diner needs", async () => {
  const { token } = addOrder();
  const { data } = await call(ctrl.getOrder, { params: { token } });
  assert.equal(data.order.stage, "completed");
  assert.equal(data.order.orderNumber, "W-1042");
  assert.equal(data.order.totalPaid, 168.12);
  assert.deepEqual(data.order.deliveryAddress, { line1: "12 Park St", line2: "Flat 3" });
  assert.equal(data.order.customer, undefined);
  assert.equal(data.order.orderId, undefined);
  assert.deepEqual(data.store, {
    storeId: "100001", name: "Spice Hub", logo: "/l.png", phone: "+91 33 4000 0000", mapUrl: "https://maps.example/spice",
  });
  // authorName is the masked name the form's notice shows, never the full name.
  assert.deepEqual(data.review, { canReview: true, reason: "", existing: null, authorName: "Asmit G." });
  assert.ok(!JSON.stringify(data).includes("Ghosh"), "the customer's full name never appears");
  assert.ok(!JSON.stringify(data).includes("9876543210"), "the customer's phone never appears");
  assert.ok(!JSON.stringify(data).includes("22.55"), "nor the delivery point");

  const stage = async (o) => (await call(ctrl.getOrder, { params: { token: addOrder(o).token } })).data.order.stage;
  assert.equal(await stage({ orderStatus: "Pending" }), "placed");
  assert.equal(await stage({ orderStatus: "In Progress" }), "accepted");
  assert.equal(await stage({ orderStatus: "Ready" }), "ready");
  assert.equal(await stage({ orderStatus: "Delivered" }), "completed");
  assert.equal(await stage({ orderStatus: "Cancelled" }), "cancelled");
  assert.equal(await stage({ orderStatus: "Refunded" }), "cancelled");
});

test("review refusals: not completed, cancelled/refunded, expired, invalid rating or text, twice", async () => {
  const refuse = async (o, body = { rating: 4 }) => review(addOrder(o).token, body);
  assert.deepEqual(
    [(await refuse({ orderStatus: "Pending" })).status, (await refuse({ orderStatus: "Pending" })).code],
    [409, "NOT_COMPLETED"],
  );
  assert.equal((await refuse({ orderStatus: "Cancelled" })).code, "CANCELLED");
  assert.equal((await refuse({ orderStatus: "Cancelled" })).status, 409);
  assert.equal((await refuse({ refundStatus: "REFUNDED" })).code, "CANCELLED");
  const expired = await refuse({ completedAt: new Date(Date.now() - 15 * DAY) });
  assert.deepEqual([expired.status, expired.code], [410, "EXPIRED"]);
  assert.equal((await refuse({ completedAt: null, updatedAt: new Date(Date.now() - 13 * DAY) })).status, 201);

  for (const rating of [0, 6, 2.5, "", null, true, "abc"]) assert.equal((await refuse({}, { rating })).status, 400, String(rating));
  assert.equal((await refuse({}, { rating: 4, text: "x".repeat(501) })).status, 400);
  const link = await refuse({}, { rating: 4, text: "great, see www.example.com" });
  assert.deepEqual([link.status, link.message], [400, "Links aren't allowed in reviews."]);
  assert.equal((await refuse({}, { rating: 4, text: "visit HTTPS://x.io" })).status, 400);

  const { token } = addOrder();
  assert.equal((await review(token, { rating: 5 })).status, 201);
  const again = await review(token, { rating: 1 });
  assert.deepEqual([again.status, again.code], [409, "ALREADY_REVIEWED"]);
  const view = await call(ctrl.getOrder, { params: { token } });
  assert.equal(view.data.review.reason, "ALREADY_REVIEWED");
  assert.equal(view.data.review.existing.rating, 5);
});

test("a review is stored clean, masked, and the public payload carries no order or phone", async () => {
  const { order, token } = addOrder();
  const out = await review(token, { rating: "5", text: "  Great​ food\nwill order\u0007 again  " });
  assert.equal(out.status, 201);
  assert.deepEqual(Object.keys(out.data.review).sort(), ["authorName", "createdAt", "rating", "text"]);
  assert.equal(out.data.review.text, "Great food will order again");
  assert.equal(out.data.review.authorName, "Asmit G.");
  const [row] = db.reviews;
  assert.deepEqual([row.storeId, String(row.orderId), row.orderNumber, row.rating], ["100001", order._id, "W-1042", 5]);
  assert.equal(invalidations.length, 1, "the rating aggregate is rebuilt");
});

test("author masking", () => {
  assert.equal(ctrl.maskAuthor("Asmit Ghosh"), "Asmit G.");
  assert.equal(ctrl.maskAuthor("  asmit kumar ghosh "), "asmit G.");
  assert.equal(ctrl.maskAuthor("Asmit"), "Asmit");
  assert.equal(ctrl.maskAuthor(""), "Knot Eats customer");
  assert.equal(ctrl.maskAuthor(undefined), "Knot Eats customer");
  assert.equal(ctrl.maskAuthor("98765 43210"), "Knot Eats customer");
  assert.equal(ctrl.maskAuthor("Room 12345"), "Knot Eats customer");
  assert.equal(ctrl.maskAuthor("A".repeat(60)).length, 40);
});

test("POST review is limited to 5 per 10 minutes per IP", async () => {
  const router = require("../routes/knotEatsRoute");
  const layer = router.stack.find((l) => l.route?.path === "/orders/:token/review" && l.route.methods.post);
  const limiter = layer.route.stack[0].handle;
  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    await limiter({ headers: { "x-forwarded-for": "203.0.113.9" } }, {}, (e) => statuses.push(e?.status || 200));
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  // Another IP is unaffected.
  await limiter({ headers: { "x-forwarded-for": "203.0.113.10" } }, {}, (e) => statuses.push(e?.status || 200));
  assert.equal(statuses.at(-1), 200);
});

test("checkout routes: Knot Eats only from the route, 6-digit ids only", () => {
  const { viaKnotEats } = require("../routes/knotEatsRoute");
  const req = { params: { slug: "231146" }, body: { knotEats: false } };
  let err = "unset";
  viaKnotEats(req, {}, (e) => (err = e));
  assert.equal(err, undefined);
  assert.equal(req.knotEats, true);
  for (const slug of ["my-cafe", "12345", "1234567", ""]) {
    const bad = { params: { slug } };
    viaKnotEats(bad, {}, (e) => (err = e));
    assert.deepEqual([err.status, err.code, bad.knotEats], [404, "KNOT_EATS_UNAVAILABLE", undefined]);
  }
  const router = require("../routes/knotEatsRoute");
  const paths = router.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
  assert.ok(paths.includes("post /stores/:slug/checkout"), "the reused handler reads req.params.slug");
  assert.ok(paths.includes("post /checkout/:token/verify"));
});
