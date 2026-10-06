/**
 * Every table order carries the customer's phone. The POS must send a valid
 * 10-digit mobile when it OPENS a table (name optional); the QR page already
 * had to send name + phone. Appends to an open table, and sessions opened
 * before the rule, are never blocked.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { indianMobile } = require("../services/otpService");

const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const TABLE_ID = "507f1f77bcf86cd799439099";

test("indianMobile accepts a 10-digit mobile with or without +91 / 0", () => {
  for (const raw of ["9830012345", "+91 98300 12345", "09830012345", "919830012345"]) {
    assert.equal(indianMobile(raw), "9830012345", raw);
  }
});

test("indianMobile rejects anything that is not an Indian mobile", () => {
  for (const raw of ["5830012345", "98300", "", "98300123456789", undefined, null]) {
    assert.equal(indianMobile(raw), "", String(raw));
  }
});

/** POS addItemsToSession with the models mocked (harness from manageTablesModule4/5). */
const runPos = async ({ body, existing = null }) => {
  const created = [];
  const TableSessionMock = {
    findOne: () => ({ session: () => Promise.resolve(existing), then: (res) => res(existing) }),
    create: async (docs) => {
      created.push(...docs);
      return docs.map((d) => ({ ...d, _id: "s-new", timeline: [], save: async () => {} }));
    },
  };
  const table = { _id: TABLE_ID, tableNumber: 3, capacity: 4, save: async () => {} };
  const TableMock = { findOne: () => ({ session: () => Promise.resolve(table), then: (res) => res(table) }) };
  const OrderMock = {
    findOne: async () => null,
    create: async (docs) => docs.map((d) => ({ _id: "ord-1", ...d })),
  };
  const priceServiceMock = {
    resolveMenuItem: async () => ({ item: { _id: "d1", name: "Naan", price: 50 } }),
    calculateUnitPrice: () => ({ unitPrice: 50 }),
    calculateBill: () => ({ subtotal: 50, totalWithTax: 50 }),
  };
  const socketMock = { emitOrderCreated: () => {}, emitOrderStatusChanged: () => {}, emitTableSessionUpdated: () => {} };

  const mongoose = require("mongoose");
  const origStartSession = mongoose.startSession;
  mongoose.startSession = async () => ({
    startTransaction: () => {},
    commitTransaction: async () => {},
    abortTransaction: async () => {},
    endSession: () => {},
  });
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r) {
    if (/tableBookingController$/.test(r)) return { findActiveBlock: async () => null, blockedError: () => new Error("blocked"), formatTimeOf: () => "", upcomingBookingsByTable: async () => ({}) };
    if (r === "../models/tableSessionModel") return TableSessionMock;
    if (r === "../models/tableModel") return TableMock;
    if (r === "../models/orderModel") return OrderMock;
    if (r === "../models/auditLogModel") return { create: async () => {} };
    if (r === "../services/price") return priceServiceMock;
    if (r === "../services/socket") return socketMock;
    if (r === "../services/gst") return { resolveGstForRestaurant: async () => ({ rate: 0, inclusive: false }) };
    if (r === "../services/autoReadyService") return { computeReadyDueAt: async () => null, computeCompleteDueAt: async () => null };
    return orig.apply(this, arguments);
  };
  delete require.cache[require.resolve("../controllers/tableSessionController")];
  delete require.cache[require.resolve("../services/auditService")];

  let status = null;
  let error = null;
  const res = { status: (c) => ((status = c), res), json: () => {} };
  try {
    const { addItemsToSession } = require("../controllers/tableSessionController");
    await addItemsToSession(
      { user: { restaurantId: RESTAURANT_ID, _id: "u1" }, body: { tableId: TABLE_ID, items: [{ menuItemId: "d1", quantity: 1 }], ...body } },
      res,
      (e) => { error = e; },
    );
  } finally {
    Module._load = orig;
    mongoose.startSession = origStartSession;
    delete require.cache[require.resolve("../controllers/tableSessionController")];
  }
  return { status, error, created };
};

test("POS: opening a table without a phone is refused before anything is created", async () => {
  const { error, created } = await runPos({ body: {} });
  assert.equal(error?.status, 400);
  assert.match(error.message, /Customer phone number is required \(10-digit mobile\) to open a table\./);
  assert.equal(created.length, 0, "TableSession.create must not run");
});

test("POS: a valid phone opens the table, normalised; the name is optional", async () => {
  const { error, status, created } = await runPos({ body: { customerPhone: "98300 12345" } });
  assert.equal(error, null);
  assert.equal(status, 200);
  assert.equal(created.length, 1);
  assert.equal(created[0].customerPhone, "9830012345");
  assert.equal(created[0].customerName, "");
});

test("POS: adding to an open table (even one opened before the rule) never asks for a phone", async () => {
  const existing = {
    _id: "s-old", sessionCode: "TS_OLD", restaurantId: RESTAURANT_ID, tableId: TABLE_ID,
    status: "OCCUPIED", customerCount: 2, customerName: "", customerPhone: "",
    items: [], timeline: [], bills: {}, save: async () => {},
  };
  const { error, status, created } = await runPos({ body: {}, existing });
  assert.equal(error, null);
  assert.equal(status, 200);
  assert.equal(created.length, 0);
  assert.equal(existing.items.length, 1);
  assert.equal(existing.customerPhone, "", "an invalid / absent phone never overwrites");
});

test("the public QR API no longer has the legacy order route or exposes the diner's phone", () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  const route = read("routes", "qrRoute.js");
  const qr = read("controllers", "qrController.js");
  assert.doesNotMatch(route, /placeLegacyOrder/);
  assert.doesNotMatch(qr, /placeLegacyOrder/);
  const sanitize = qr.slice(qr.indexOf("const sanitizeSession"), qr.indexOf("items: (plain.items"));
  assert.ok(sanitize.length > 0);
  assert.doesNotMatch(sanitize, /customerPhone/);
});

test("REGRESSION: no public QR reply carries the kitchen order's customer details", () => {
  const qr = fs.readFileSync(path.join(__dirname, "..", "controllers", "qrController.js"), "utf8");
  assert.match(qr, /const publicOrder = /);
  assert.doesNotMatch(qr, /order: result\.kitchenOrder,/);
  assert.doesNotMatch(qr, /order: placed\.doc/);
  const payRequest = qr.slice(qr.indexOf("const payRequest"), qr.indexOf("const dismissWaiterCall"));
  assert.match(payRequest, /order: publicOrder\(order\)/);
});

test("REGRESSION: the pay step saves only a real mobile (not 0000000000) as the diner's phone", () => {
  const qr = fs.readFileSync(path.join(__dirname, "..", "controllers", "qrController.js"), "utf8");
  const intent = qr.slice(qr.indexOf("const paymentIntent"), qr.indexOf("const paymentVerify"));
  assert.match(intent, /indianMobile\(req\.body\?\.phone\)/);
  assert.match(intent, /session\.customerPhone = indianMobile\(req\.body\.phone\)/);
  assert.equal(indianMobile("0000000000"), "");
});

test("minting a table QR needs the QR add-on; the diner routes stay open", () => {
  const route = fs.readFileSync(path.join(__dirname, "..", "routes", "qrRoute.js"), "utf8");
  assert.match(route, /generate"\)\.post\(isVerifiedUser, requireProtectedAction, requirePermission\("TABLE_UPDATE"\), requireTableQrPlan, qr\.generateTableQr\)/);
  assert.equal((route.match(/requireTableQrPlan/g) || []).length, 2, "the import and the generate route only");
});
