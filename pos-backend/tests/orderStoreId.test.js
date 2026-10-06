/**
 * Every order carries its store's storeId, and the CSD reports group by
 * restaurant and staff _id (csd-billing/B1, X-2).
 *
 * Only website orders used to set storeId, so CSD's "Top restaurants" lumped
 * every POS order into one nameless row; staff activity grouped by a phone
 * CSD staff no longer have, so everyone showed as "Unknown".
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

const Order = require("../models/orderModel");
const Restaurant = require("../models/restaurantModel");
const Store = require("../models/storeModel");
const CsdStaff = require("../models/csdStaffModel");
const CsdJob = require("../models/csdJobModel");
const AuditLog = require("../models/auditLogModel");
const { getReports } = require("../controllers/csdReportsController");

const R1 = new mongoose.Types.ObjectId();
const R2 = new mongoose.Types.ObjectId();

/** Pretend the connection is up (the hook skips the read without one). */
const connected = async (fn) => {
  Object.defineProperty(mongoose.connection, "readyState", { get: () => 1, configurable: true });
  try {
    return await fn();
  } finally {
    delete mongoose.connection.readyState;
  }
};

test("a new order is stamped with its restaurant's storeId, whatever the channel", async () => {
  const realFindById = Restaurant.findById;
  const asked = [];
  Restaurant.findById = (id) => {
    asked.push(String(id));
    return { select: () => ({ lean: async () => ({ storeId: "123456" }) }) };
  };
  try {
    await connected(async () => {
      for (const source of ["POS", "QR", "MARKETPLACE"]) {
        const order = new Order({ restaurantId: R1, source, orderStatus: "Pending" });
        await order.validate();
        assert.equal(order.storeId, "123456", source);
      }
      // A website order already has it: no read, nothing changed.
      const site = new Order({ restaurantId: R1, source: "WEBSITE", storeId: "654321", orderStatus: "Pending" });
      await site.validate();
      assert.equal(site.storeId, "654321");
      assert.equal(asked.length, 3);
    });
    // No live connection (unit tests): the hook never waits on a read.
    const offline = new Order({ restaurantId: R1, orderStatus: "Pending" });
    await offline.validate();
    assert.equal(offline.storeId, "");
    assert.equal(asked.length, 3);
  } finally {
    Restaurant.findById = realFindById;
  }
});

/** A tiny $group over rows, enough for the reports' pipelines. */
const group = (rows) => (pipeline) => {
  const g = pipeline.find((s) => s.$group)?.$group;
  const key = (r) => (typeof g._id === "string" ? r[g._id.slice(1)] : null);
  const out = new Map();
  for (const r of rows) {
    const k = key(r);
    const row = out.get(String(k)) || { _id: k, orders: 0, revenue: 0, actions: 0 };
    row.orders += 1;
    row.actions += 1;
    row.revenue += r.total || 0;
    out.set(String(k), row);
  }
  return Promise.resolve([...out.values()]);
};
const lean = (rows) => (filter) => ({
  lean: async () => {
    const [field, cond] = Object.entries(filter || {})[0] || [];
    return cond?.$in ? rows.filter((r) => cond.$in.map(String).includes(String(r[field]))) : rows;
  },
});

test("CSD Top restaurants groups by restaurant and staff activity by staff _id", async () => {
  const S1 = new mongoose.Types.ObjectId();
  const S2 = new mongoose.Types.ObjectId();
  // Old orders with no storeId, and one stamped: R1's must land in one row.
  const orders = [
    { restaurantId: R1, storeId: "", total: 100 },
    { restaurantId: R1, storeId: "111111", total: 50 },
    { restaurantId: R2, storeId: "", total: 70 },
  ];
  const real = [Order.aggregate, AuditLog.aggregate, CsdJob.aggregate, Restaurant.find, Store.find, CsdStaff.find];
  Order.aggregate = (p) => (p[0].$match?.orderStatus instanceof RegExp ? Promise.resolve([]) : group(orders)(p));
  AuditLog.aggregate = group([{ userId: S1, phone: "" }, { userId: S1, phone: "" }, { userId: S2, phone: "" }]);
  CsdJob.aggregate = async () => [];
  Restaurant.find = lean([{ _id: R1, name: "Spice Garden", storeId: "111111" }, { _id: R2, name: "Tea House", storeId: "222222" }]);
  Store.find = lean([{ storeId: "111111", storeName: "Spice Garden", status: "active" }]);
  CsdStaff.find = lean([{ _id: S1, fullName: "Asha Rao", staffId: "KK001" }, { _id: S2, fullName: "Ravi Sen", staffId: "KK002" }]);
  try {
    const body = await new Promise((resolve, reject) => {
      getReports({ query: {} }, { status: () => ({ json: resolve }) }, reject);
    });
    const top = body.data.topStores.map((s) => [s.storeId, s.storeName, s.orders, s.revenue]).sort();
    assert.deepEqual(top, [["111111", "Spice Garden", 2, 150], ["222222", "Tea House", 1, 70]]);
    const staff = body.data.staffActivity.map((a) => [a.staffId, a.name, a.actions]).sort();
    assert.deepEqual(staff, [["KK001", "Asha Rao", 2], ["KK002", "Ravi Sen", 1]]);
  } finally {
    [Order.aggregate, AuditLog.aggregate, CsdJob.aggregate, Restaurant.find, Store.find, CsdStaff.find] = real;
  }
});

test("migration 012 backfills only blank storeIds, per restaurant", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "migrations", "012-backfill-order-store-id.js"), "utf8");
  assert.match(src, /\{ storeId: "" \}, \{ storeId: null \}, \{ storeId: \{ \$exists: false \} \}/);
  assert.match(src, /orders\.updateMany\(\{ restaurantId: r\._id, \.\.\.blank \}, \{ \$set: \{ storeId: r\.storeId \} \}\)/);
});
