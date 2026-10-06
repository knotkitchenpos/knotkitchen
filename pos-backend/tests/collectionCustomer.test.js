const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_ID = "111111111111111111111111";
const USER_ID = "222222222222222222222222";

test("addOrder normalizes collection order type and handles optional customer details", async () => {
  let createdOrder = null;
  let customerFound = null;
  let customerCreated = null;

  const OrderMock = function (data) {
    this.data = data;
    this.save = async function () {
      createdOrder = this.data;
      return this;
    };
  };

  const CustomerMock = {
    findOne: async (q) => customerFound,
    create: async (data) => {
      customerCreated = data;
      return { _id: "cust-1", ...data, save: async () => {} };
    },
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/orderModel") return OrderMock;
    if (r === "../models/customerModel") return CustomerMock;
    if (r === "../models/tableModel") return {};
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/orderController")];
  const { addOrder } = require("../controllers/orderController");
  Module._load = orig;

  const req = {
    body: {
      orderType: "Collection",
      customerDetails: { name: "", phone: "", guests: 1 },
      bills: { subtotal: 100, total: 100, tax: 0, totalWithTax: 100 },
    },
    user: { _id: USER_ID, restaurantId: RESTAURANT_ID },
  };

  let jsonResult = null;
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      jsonResult = data;
      return this;
    },
  };

  await addOrder(req, res, (err) => {
    if (err) throw err;
  });

  assert.equal(res.statusCode, 201);
  assert.equal(createdOrder.orderType, "collection");
  assert.equal(createdOrder.customerDetails.name, "");
  assert.equal(createdOrder.customerDetails.phone, "");
  assert.equal(createdOrder.customerId, undefined);
});

test("addOrder creates or updates customer in CRM when phone is provided", async () => {
  let createdOrder = null;
  let savedCustomer = null;

  const existingCustomer = {
    _id: "cust-100",
    restaurantId: RESTAURANT_ID,
    name: "Old Name",
    phone: "9876543210",
    visitCount: 1,
    totalSpent: 100,
    save: async function () {
      savedCustomer = this;
    },
  };

  const OrderMock = function (data) {
    this.data = data;
    this.save = async function () {
      createdOrder = this.data;
      return this;
    };
  };

  const CustomerMock = {
    findOne: async (q) => {
      if (q.phone === "9876543210") return existingCustomer;
      return null;
    },
    create: async (data) => ({ _id: "cust-new", ...data, save: async () => {} }),
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/orderModel") return OrderMock;
    if (r === "../models/customerModel") return CustomerMock;
    if (r === "../models/tableModel") return {};
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/orderController")];
  const { addOrder } = require("../controllers/orderController");
  Module._load = orig;

  const req = {
    body: {
      orderType: "collection",
      customerDetails: { name: "Alice Smith", phone: "9876543210", guests: 1 },
      bills: { subtotal: 200, total: 200, tax: 0, totalWithTax: 200 },
    },
    user: { _id: USER_ID, restaurantId: RESTAURANT_ID },
  };

  const res = {
    status(code) {
      return this;
    },
    json(data) {
      return this;
    },
  };

  await addOrder(req, res, (err) => {
    if (err) throw err;
  });

  assert.equal(savedCustomer.name, "Alice Smith");
  assert.equal(savedCustomer.visitCount, 2);
  assert.equal(savedCustomer.totalSpent, 300);
  assert.equal(createdOrder.customerId, "cust-100");
});

const { runAddOrder } = require("./addOrderHarness");

const BILL_105 = { subtotal: 105, total: 105, tax: 0, totalWithTax: 105 };

test("REGRESSION: a card payment at the counter is paid, not left Preparing", async () => {
  // 'card' used to normalise to no method at all: the order sat in the
  // kitchen unpaid although the card machine had taken the money.
  const out = await runAddOrder({ body: { orderType: "Collection", paymentMethod: "card", bills: BILL_105 } });
  assert.equal(out.status, 201, out.error?.message);
  const order = out.saved[0];
  assert.equal(order.orderStatus, "Completed");
  assert.equal(order.paymentMethod, "Card");
  assert.deepEqual(order.payments.map((p) => [p.method, p.amount, p.status]), [["card", 105, "paid"]]);
});

test("a split at the counter keeps each part's own method, and the parts must add up", async () => {
  const splits = [{ method: "CASH", amount: 60 }, { method: "UPI", amount: 45 }];
  const out = await runAddOrder({ body: { orderType: "collection", paymentMethod: "split", splits, bills: BILL_105 } });
  assert.equal(out.status, 201, out.error?.message);
  const order = out.saved[0];
  assert.equal(order.orderStatus, "Completed");
  assert.equal(order.isSplit, true);
  assert.deepEqual(order.payments.map((p) => [p.method, p.amount]), [["cash", 60], ["upi", 45]]);
  assert.equal(order.paymentMethod, "Split (Cash ₹60.00 + UPI ₹45.00)");

  const short = await runAddOrder({
    body: { orderType: "collection", paymentMethod: "split", splits: [{ method: "CASH", amount: 60 }, { method: "UPI", amount: 40 }], bills: BILL_105 },
  });
  assert.equal(short.error?.status, 400);
  assert.equal(short.saved.length, 0);
});

test("REGRESSION: a phone that is not a mobile number is refused, before any CRM write", async () => {
  // Any string used to be saved, become a CRM customer and get an e-bill.
  const bad = await runAddOrder({ body: { orderType: "collection", customerDetails: { name: "Asha", phone: "abc" }, bills: BILL_105 } });
  assert.equal(bad.error?.status, 400);
  assert.equal(bad.saved.length, 0);
  assert.equal(bad.customerWrites, 0);

  // +91 / spaces are fine and stored as the 10 digits.
  const ok = await runAddOrder({ body: { orderType: "collection", customerDetails: { name: "Asha", phone: "+91 98765 43210" }, bills: BILL_105 } });
  assert.equal(ok.status, 201, ok.error?.message);
  assert.equal(ok.saved[0].customerDetails.phone, "9876543210");
});

test("REGRESSION: a retried till order with the same Idempotency-Key is created once", async () => {
  // The answer to the first POST was lost, so the till retried (or queued it
  // offline under the same id). The retry must return the first order.
  const headers = { "Idempotency-Key": "local-abc" };
  const body = { orderType: "collection", paymentMethod: "cash", bills: BILL_105 };
  const first = await runAddOrder({ body, headers });
  assert.equal(first.status, 201);
  assert.equal(first.saved[0].idempotencyKey, "offline:local-abc", "the key the offline sync looks for");

  const already = { _id: "order-1", idempotencyKey: "offline:local-abc" };
  const second = await runAddOrder({ body, headers, existing: already });
  assert.equal(second.status, 200);
  assert.equal(second.body.data._id, "order-1");
  assert.equal(second.saved.length, 0, "no second order");
});
