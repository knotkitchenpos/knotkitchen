// N122: CSD counts a store's orders by restaurantId; storeId is blank on orders from before batch 6.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Order = require("../models/orderModel");
const Restaurant = require("../models/restaurantModel");
const Store = require("../models/storeModel");
const WebsiteSettings = require("../models/websiteSettingsModel");
const { getOrderSummary, getCustomers } = require("../controllers/csdRestaurantController");
const { searchOrders } = require("../controllers/csdSearchController");

const R1 = new mongoose.Types.ObjectId();
const R2 = new mongoose.Types.ObjectId();
// Demo Store 1: most history predates the storeId stamp (blank), one website order has it.
const ORDERS = [
  { restaurantId: R1, storeId: "", total: 1000, phone: "9876543210" },
  { restaurantId: R1, storeId: "", total: 1000, phone: "9876543211" },
  { restaurantId: R1, storeId: "123456", total: 131, phone: "9876543212" },
  { restaurantId: R2, storeId: "", total: 999, phone: "9876543213" }, // another store
];
const hit = (cond, v) => (cond && cond.$in ? cond.$in.map(String).includes(String(v)) : String(cond) === String(v));
const fakeAggregate = (pipeline) => {
  const m = pipeline[0].$match;
  const rows = ORDERS.filter((o) => ["restaurantId", "storeId"].every((k) => !(k in m) || hit(m[k], o[k])));
  if (pipeline.some((s) => s.$count)) return Promise.resolve([{ n: new Set(rows.map((r) => r.phone)).size }]);
  if (pipeline.some((s) => s.$skip !== undefined)) return Promise.resolve(rows.map((r) => ({ _id: r.phone, totalOrders: 1, totalSpent: r.total })));
  return Promise.resolve([{ _id: "pos", orders: rows.length, revenue: rows.reduce((s, r) => s + r.total, 0) }]);
};

const call = (fn, req) =>
  new Promise((resolve, reject) => fn(req, { status: () => ({ json: resolve }) }, reject));

test("CSD store page counts every order of the restaurant, stamped storeId or not (N122)", async () => {
  const real = [Store.findOne, Restaurant.findOne, WebsiteSettings.findOne, Order.aggregate];
  Store.findOne = () => ({ lean: async () => ({ storeId: "123456", status: "active" }) });
  Restaurant.findOne = () => ({ lean: async () => ({ _id: R1, storeId: "123456" }) });
  WebsiteSettings.findOne = () => ({ lean: async () => null });
  Order.aggregate = fakeAggregate;
  try {
    const summary = await call(getOrderSummary, { params: { storeId: "123456" }, query: { period: "month" } });
    assert.equal(summary.data.totalOrders, 3);
    assert.equal(summary.data.revenue, 2131);
    const customers = await call(getCustomers, { params: { storeId: "123456" }, query: {} });
    assert.equal(customers.data.total, 3);
  } finally {
    [Store.findOne, Restaurant.findOne, WebsiteSettings.findOne, Order.aggregate] = real;
  }
});

test("CSD order search by Store ID matches the store's restaurantId, not the copied storeId (N122)", async () => {
  const real = [Restaurant.find, Store.find, Order.countDocuments, Order.find];
  let counted = null;
  Restaurant.find = () => ({ lean: async () => [{ _id: R1 }] });
  Store.find = () => ({ lean: async () => [] });
  Order.countDocuments = async (filter) => { counted = filter; return 0; };
  Order.find = () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) });
  try {
    const res = await call(searchOrders, { query: { storeId: "123456" } });
    assert.equal(res.success, true);
    assert.deepEqual(counted.restaurantId.$in.map(String), [String(R1)]);
    assert.equal("storeId" in counted, false);
  } finally {
    [Restaurant.find, Store.find, Order.countDocuments, Order.find] = real;
  }
});
