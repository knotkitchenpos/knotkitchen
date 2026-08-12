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
      bills: { total: 100, tax: 5, totalWithTax: 105 },
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
      bills: { total: 200, tax: 10, totalWithTax: 210 },
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
  assert.equal(savedCustomer.totalSpent, 310);
  assert.equal(createdOrder.customerId, "cust-100");
});
