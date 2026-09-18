const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { customerPrivacy, maskOldCustomerPhones, maskPhone, dayOf } = require("../middlewares/customerPrivacy");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const TODAY = "2026-09-18";
const today = "2026-09-18T09:30:00+05:30";
const yesterday = "2026-09-17T21:10:00+05:30";

test("the middle six digits are masked, the first two and last two kept", () => {
  assert.equal(maskPhone("9876543210"), "98******10");
  assert.equal(maskPhone("+91 98765 43210"), "91******10");
  assert.equal(maskPhone("12345"), "******");
  assert.equal(maskPhone(""), "");
});

test("the day is the store's day, not UTC's", () => {
  // 00:30 IST on the 18th is still the 17th in UTC.
  assert.equal(dayOf("2026-09-17T19:00:00Z"), "2026-09-18");
  assert.equal(dayOf("not a date"), "");
});

test("today's order shows the number; yesterday's is masked; the name stays", () => {
  const body = {
    data: [
      { orderDate: today, customerDetails: { name: "Asha", phone: "9876543210" } },
      { orderDate: yesterday, customerDetails: { name: "Ravi", phone: "9123456780" }, deliveryAddress: { phone: "9123456780", line1: "12 MG Road" } },
    ],
  };
  maskOldCustomerPhones(body, TODAY);
  assert.equal(body.data[0].customerDetails.phone, "9876543210");
  assert.equal(body.data[1].customerDetails.phone, "91******80");
  assert.equal(body.data[1].customerDetails.name, "Ravi");
  assert.equal(body.data[1].deliveryAddress.phone, "91******80");
  assert.equal(body.data[1].deliveryAddress.line1, "12 MG Road");
});

test("table sessions, receipts and nested records follow the same rule", () => {
  const body = {
    session: { openedAt: yesterday, customerPhone: "9000011111", customerName: "Meera" },
    receipt: { dateTime: yesterday, customerInformation: { name: "Meera", phone: "9000011111" }, restaurant: { phone: "03340001234" } },
    nested: { createdAt: yesterday, order: { customerDetails: { phone: "9000022222" } } },
    booking: { bookingDate: "2026-09-20T19:00:00+05:30", customerPhone: "9000033333" },
  };
  maskOldCustomerPhones(body, TODAY);
  assert.equal(body.session.customerPhone, "90******11");
  assert.equal(body.receipt.customerInformation.phone, "90******11");
  assert.equal(body.receipt.restaurant.phone, "03340001234", "the store's own number is not a customer's");
  assert.equal(body.nested.order.customerDetails.phone, "90******22", "a record without a date takes its parent's");
  assert.equal(body.booking.customerPhone, "9000033333", "an upcoming booking is not in the past");
});

test("the middleware masks POS responses and leaves a KnotKitchen support session alone", () => {
  const run = (req) => {
    let sent;
    const res = { json: (b) => { sent = b; } };
    customerPrivacy(req, res, () => {});
    res.json({ data: { orderDate: "2020-01-01T10:00:00Z", customerDetails: { phone: "9876543210" } } });
    return sent.data.customerDetails.phone;
  };
  assert.equal(run({}), "98******10");
  assert.equal(run({ csdStaff: { _id: "s1" } }), "9876543210");
});

test("SOURCE: every POS router that returns customer data is behind it, and CSD is not", () => {
  const app = read("app.js");
  const block = app.slice(app.indexOf('["/api/order", "/api/online-orders"'), app.indexOf('app.use("/api/order", require'));
  for (const p of ["/api/order", "/api/online-orders", "/api/table-session", "/api/table-bookings", "/api/payment-link", "/api/receipts", "/api/kds", "/api/shift"]) {
    assert.ok(block.includes(`"${p}"`), p);
  }
  assert.ok(!block.includes("/api/csd"), "the support console sees full details");
  assert.match(block, /customerPrivacy/);
});

test("SOURCE: the CSD export is admin-only, audit-logged and safe to open in a spreadsheet", () => {
  const routes = read("routes", "csdRoute.js");
  assert.match(routes, /"\/restaurants\/:storeId\/customers\/export", requireCsdAdmin, exportCustomers/);
  const ctrl = read("controllers", "csdRestaurantController.js");
  const fn = ctrl.slice(ctrl.indexOf("const exportCustomers"));
  assert.match(fn, /action: "CSD_CUSTOMERS_EXPORTED"/);
  assert.match(fn, /text\/csv/);
  assert.match(ctrl, /if \(\/\^\[=\+\\-@\\t\\r\]\/\.test\(text\)\) text = `'\$\{text\}`;/, "formula cells are neutralised");
});
