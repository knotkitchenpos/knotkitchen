const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const STORE_ID = "123456";
const TABLE_1_ID = "507f1f77bcf86cd799439099";

test("Website Module 7: Specific table booking succeeds within capacity and fails when guest count > capacity", async () => {
  const mockSettings = {
    _id: "ws-1",
    storeId: STORE_ID,
    restaurantId: RESTAURANT_ID,
    slug: "royal-palace",
    enabled: true,
    ordering: { tableBookingEnabled: true },
  };

  const mockTable4Seater = {
    _id: TABLE_1_ID,
    displayId: "GF-T1",
    tableNumber: 1,
    capacity: 4, // 4-seater table
    isEnabled: true,
    restaurantId: RESTAURANT_ID,
  };

  const storefrontResolverMock = {
    resolveStorefront: async () => ({
      ok: true,
      settings: mockSettings,
      store: { storeId: STORE_ID, status: "active" },
      restaurantId: RESTAURANT_ID,
      storeId: STORE_ID,
    }),
  };

  const TableMock = {
    findOne: async () => mockTable4Seater,
  };

  const TableSessionMock = { findOne: async () => null };

  let createdBooking = null;
  const TableBookingMock = {
    findOne: async () => null,
    create: async (doc) => {
      createdBooking = { _id: "tb-1", ...doc };
      return createdBooking;
    },
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../services/storefrontResolver") return storefrontResolverMock;
    if (r === "../models/tableModel") return TableMock;
    if (r === "../models/tableSessionModel") return TableSessionMock;
    if (r === "../models/tableBookingModel") return TableBookingMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/tableBookingController")];
  const { createPublicTableBooking } = require("../controllers/tableBookingController");

  // 1. Booking for 5 guests on 4-seater table -> Must be rejected with 400
  let errorCaught = null;
  const reqOverCapacity = {
    params: { slug: "royal-palace" },
    headers: { host: "123456.knotkitchen.in" },
    body: {
      name: "Alice",
      phone: "9876543210",
      guestCount: 5, // 5 guests on 4-seater
      bookingDate: "2026-08-22",
      bookingTime: "19:30",
      tableDisplayId: "GF-T1",
    },
  };

  try {
    await createPublicTableBooking(reqOverCapacity, {}, (err) => {
      errorCaught = err;
    });
  } finally {
    Module._load = orig;
  }

  assert.ok(errorCaught);
  assert.equal(errorCaught.status || errorCaught.statusCode, 400);
  assert.ok(errorCaught.message.includes("capacity of 4 guests"));

  // 2. Booking for 4 guests -> Must succeed
  let resData = null;
  const res = {
    status: (code) => {
      assert.equal(code, 201);
      return res;
    },
    json: (payload) => {
      resData = payload;
    },
  };

  const reqValid = {
    params: { slug: "royal-palace" },
    headers: { host: "123456.knotkitchen.in" },
    body: {
      name: "Alice",
      phone: "9876543210",
      guestCount: 4,
      bookingDate: "2026-08-22",
      bookingTime: "19:30",
      tableDisplayId: "GF-T1",
    },
  };

  Module._load = function (r, p, m) {
    if (r === "../services/storefrontResolver") return storefrontResolverMock;
    if (r === "../models/tableModel") return TableMock;
    if (r === "../models/tableSessionModel") return TableSessionMock;
    if (r === "../models/tableBookingModel") return TableBookingMock;
    return orig.apply(this, arguments);
  };

  try {
    await createPublicTableBooking(reqValid, res, () => {});
  } finally {
    Module._load = orig;
  }

  assert.ok(resData);
  assert.equal(resData.data.status, "PENDING");
  assert.equal(resData.data.tableDisplayId, "GF-T1");
});

test("Website Module 7: Double booking prevention rejects booking if table is already booked or occupied", async () => {
  const mockSettings = {
    _id: "ws-1",
    storeId: STORE_ID,
    restaurantId: RESTAURANT_ID,
    slug: "royal-palace",
    enabled: true,
    ordering: { tableBookingEnabled: true },
  };

  const mockTable = { _id: TABLE_1_ID, displayId: "GF-T1", capacity: 4, isEnabled: true, restaurantId: RESTAURANT_ID };

  const storefrontResolverMock = {
    resolveStorefront: async () => ({
      ok: true,
      settings: mockSettings,
      store: { storeId: STORE_ID, status: "active" },
      restaurantId: RESTAURANT_ID,
      storeId: STORE_ID,
    }),
  };

  const TableMock = { findOne: async () => mockTable };
  const TableSessionMock = { findOne: async () => null };

  // Table is already booked for 19:30
  const TableBookingMock = {
    findOne: async () => ({ _id: "tb-existing", status: "CONFIRMED" }),
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../services/storefrontResolver") return storefrontResolverMock;
    if (r === "../models/tableModel") return TableMock;
    if (r === "../models/tableSessionModel") return TableSessionMock;
    if (r === "../models/tableBookingModel") return TableBookingMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/tableBookingController")];
  const { createPublicTableBooking } = require("../controllers/tableBookingController");

  let errorCaught = null;
  const reqConflicting = {
    params: { slug: "royal-palace" },
    headers: { host: "123456.knotkitchen.in" },
    body: {
      name: "Bob",
      phone: "9876543210",
      guestCount: 2,
      bookingDate: "2026-08-22",
      bookingTime: "19:30",
      tableDisplayId: "GF-T1",
    },
  };

  try {
    await createPublicTableBooking(reqConflicting, {}, (err) => {
      errorCaught = err;
    });
  } finally {
    Module._load = orig;
  }

  assert.ok(errorCaught);
  assert.equal(errorCaught.status || errorCaught.statusCode, 409);
  assert.ok(errorCaught.message.includes("already booked"));
});
