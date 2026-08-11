const { test } = require("node:test");
const assert = require("node:assert/strict");

const { validateCapacity } = require("../controllers/tableSessionController");

test("capacity 4 with 4 customers succeeds", () => {
  const table = { tableNumber: 4, capacity: 4 };
  assert.equal(validateCapacity(table, 4), 4);
});

test("capacity 4 with 5 customers fails", () => {
  const table = { tableNumber: 4, capacity: 4 };
  assert.throws(
    () => validateCapacity(table, 5),
    (e) => e.status === 400 && /maximum capacity of 4 customers/.test(e.message)
  );
});

test("capacity 4 rejects 6 and 10 customers", () => {
  const table = { tableNumber: 4, capacity: 4 };
  assert.throws(() => validateCapacity(table, 6), /maximum capacity of 4 customers/);
  assert.throws(() => validateCapacity(table, 10), /maximum capacity of 4 customers/);
});

// ============================================================
// Tenant-scoped capacity validation (IDOR protection)
// ============================================================
// Valid 24-char hex ObjectIds so mongoose.ObjectId.isValid() passes
const TABLE_A_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TABLE_B_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";

const tableA = {
  _id: TABLE_A_ID,
  tableNumber: 4,
  capacity: 4,
  restaurantId: "rest-A",
  outletId: "outlet-A",
};
const tableB = {
  _id: TABLE_B_ID,
  tableNumber: 2,
  capacity: 2,
  restaurantId: "rest-B",
  outletId: "outlet-B",
};

const TableMock = {
  findOne: async (q) => {
    if (q._id === TABLE_A_ID) return q.restaurantId === "rest-A" ? tableA : null;
    if (q._id === TABLE_B_ID) return q.restaurantId === "rest-B" ? tableB : null;
    return null;
  },
};

const userRestA = { _id: "user-A", restaurantId: "rest-A", outletId: "outlet-A" };
const userRestB = { _id: "user-B", restaurantId: "rest-B", outletId: "outlet-B" };

function loadOrderController() {
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableModel") return TableMock;
    if (r === "../models/orderModel") return { create: async () => ({ _id: "o1" }) };
    return orig.apply(this, arguments);
  };
  const oc = require("../controllers/orderController");
  Module._load = orig;
  return oc;
}

test("own-tenant table capacity 4 with 4 guests succeeds", async () => {
  const oc = loadOrderController();
  const count = await oc.validateTableCapacityForOrder({ tableId: TABLE_A_ID, guests: 4, user: userRestA });
  assert.equal(count, 4);
});

test("own-tenant table capacity 4 with 5 guests fails", async () => {
  const oc = loadOrderController();
  await assert.rejects(
    oc.validateTableCapacityForOrder({ tableId: TABLE_A_ID, guests: 5, user: userRestA }),
    (e) => e.status === 400 && /maximum capacity of 4 customers/.test(e.message)
  );
});

test("wrong-tenant table ID fails (user B cannot use table A)", async () => {
  const oc = loadOrderController();
  await assert.rejects(
    oc.validateTableCapacityForOrder({ tableId: TABLE_A_ID, guests: 2, user: userRestB }),
    (e) => e.status === 404 && /Table not found/i.test(e.message)
  );
});

test("wrong-tenant table ID fails (user A cannot use table B)", async () => {
  const oc = loadOrderController();
  await assert.rejects(
    oc.validateTableCapacityForOrder({ tableId: TABLE_B_ID, guests: 2, user: userRestA }),
    (e) => e.status === 404 && /Table not found/i.test(e.message)
  );
});

test("invalid table id fails", async () => {
  const oc = loadOrderController();
  await assert.rejects(
    oc.validateTableCapacityForOrder({ tableId: "not-an-id", guests: 1, user: userRestA }),
    (e) => e.status === 400
  );
});

// ============================================================
// Capacity reduction protection (currentOccupancy constraint)
// ============================================================
test("reducing capacity below occupancy is rejected", async () => {
  const tableWithOccupancy = { ...tableA, capacity: 4, currentOccupancy: 4, status: "occupied" };
  const T = { findOne: async () => tableWithOccupancy, findOneAndUpdate: async () => tableWithOccupancy };
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableModel") return T;
    if (r === "../models/tableSessionModel") return { findOne: async () => null };
    return orig.apply(this, arguments);
  };
  const tc = require("../controllers/tableController");
  Module._load = orig;

  const req = { params: { id: TABLE_A_ID }, body: { capacity: 3 }, user: userRestA };
  let err = null;
  await tc.updateTable(req, { status() { return this; }, json() {} }, (e) => { err = e; });
  assert.ok(err, "expected updateTable to throw");
  assert.equal(err.status, 400);
  assert.match(err.message, /Cannot reduce capacity below current occupancy/);
});

test("reducing capacity to or above occupancy succeeds", async () => {
  const tableWithOccupancy = { ...tableA, capacity: 4, currentOccupancy: 4, status: "occupied" };
  const T = {
    findOne: async () => tableWithOccupancy,
    findOneAndUpdate: async () => ({ ...tableWithOccupancy, capacity: 4 }),
  };
  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/tableModel") return T;
    if (r === "../models/tableSessionModel") return { findOne: async () => null };
    return orig.apply(this, arguments);
  };
  const tc = require("../controllers/tableController");
  Module._load = orig;

  const req = { params: { id: TABLE_A_ID }, body: { capacity: 4 }, user: userRestA };
  let responded = null;
  let err = null;
  await tc.updateTable(req, { status() { return this; }, json(o) { responded = o; } }, (e) => { err = e; });
  assert.ifError(err);
  assert.ok(responded, "expected success response");
});