const test = require("node:test");
const assert = require("node:assert/strict");

const { formatPaymentMethod, buildReceipt } = require("../services/receiptService");
const { sendEBillMessage } = require("../services/messagingService");

test("formatPaymentMethod correctly maps payment methods", () => {
  assert.equal(formatPaymentMethod("CASH"), "Paid by Cash");
  assert.equal(formatPaymentMethod("cash"), "Paid by Cash");
  assert.equal(formatPaymentMethod("QR"), "Paid by QR Code");
  assert.equal(formatPaymentMethod("qr_code"), "Paid by QR Code");
  assert.equal(formatPaymentMethod("ONLINE"), "Paid Online");
  assert.equal(formatPaymentMethod("UPI"), "Paid Online");
  assert.equal(formatPaymentMethod("CARD"), "Paid Online");
  assert.equal(formatPaymentMethod("PAYMENT_LINK"), "Paid by Payment Link");
});

test("buildReceipt formats completed collection order with cash payment", () => {
  const restaurant = {
    _id: "rest-01",
    storeName: "Demo Takeaway 01",
    address: "123 High Street",
    ownerPhone: "9876543210",
  };

  const order = {
    _id: "ord-101",
    marketplaceOrderId: "ORD-101",
    orderDate: new Date("2026-08-13T10:00:00Z"),
    outletId: "out-01",
    customerDetails: { name: "Alice", phone: "9876543210" },
    items: [
      { name: "Burger", price: 150, quantity: 2, total: 300, modifiers: [] },
      { name: "Fries", price: 80, quantity: 1, total: 80, modifiers: [] },
    ],
    bills: {
      subtotal: 380,
      tax: 19,
      packagingFee: 10,
      deliveryFee: 0,
      totalWithTax: 409,
    },
    orderStatus: "completed",
    paymentMethod: "CASH",
  };

  const receipt = buildReceipt({ order, restaurant });

  assert.equal(receipt.restaurant.name, "Demo Takeaway 01");
  assert.equal(receipt.orderNumber, "ORD-101");
  assert.equal(receipt.customerInformation.name, "Alice");
  assert.equal(receipt.customerInformation.phone, "9876543210");
  assert.equal(receipt.quantities, 3);
  assert.equal(receipt.subtotal, 380);
  assert.equal(receipt.taxes, 19);
  assert.equal(receipt.charges, 10);
  assert.equal(receipt.total, 409);
  assert.equal(receipt.paymentStatus, "PAID");
  assert.equal(receipt.paymentMethod, "Paid by Cash");
});

test("buildReceipt formats collection order with payment link", () => {
  const restaurant = { storeName: "Demo Takeaway 02" };
  const order = {
    _id: "ord-102",
    items: [{ name: "Pizza", price: 500, quantity: 1, total: 500 }],
    bills: { subtotal: 500, tax: 25, totalWithTax: 525 },
    orderStatus: "paid",
    paymentMethod: "PAYMENT_LINK",
  };

  const receipt = buildReceipt({ order, restaurant });
  assert.equal(receipt.paymentMethod, "Paid by Payment Link");
  assert.equal(receipt.paymentStatus, "PAID");
  assert.equal(receipt.total, 525);
});

test("buildReceipt formats table order with accumulated items and QR payment", () => {
  const restaurant = { storeName: "Fine Dining Restaurant" };

  // Table order with initial order + additional items added during session
  const tableSession = {
    _id: "sess-01",
    sessionCode: "TBL4-9988",
    status: "CLOSED",
    customerName: "Bob",
    customerPhone: "9123456789",
    tableId: { tableNumber: 4 },
    tableNumber: 4,
    items: [
      { name: "Starter Soup", price: 120, quantity: 2, total: 240 },
      { name: "Main Course Pasta", price: 350, quantity: 2, total: 700 }, // Additional items added
      { name: "Dessert Cake", price: 150, quantity: 1, total: 150 }, // Additional items added
    ],
    bills: {
      subtotal: 1090,
      tax: 54.5,
      charges: 20,
      totalWithTax: 1164.5,
    },
    payment: {
      method: "QR",
      status: "PAID",
    },
  };

  const receipt = buildReceipt({ tableSession, restaurant });

  assert.equal(receipt.orderNumber, "TBL4-9988");
  assert.equal(receipt.paymentMethod, "Paid by QR Code");
  assert.equal(receipt.paymentStatus, "PAID");
  assert.equal(receipt.quantities, 5); // 2 + 2 + 1
  assert.equal(receipt.subtotal, 1090);
  assert.equal(receipt.total, 1164.5);

  assert.ok(receipt.tableOrder, "tableOrder section present");
  assert.equal(receipt.tableOrder.tableNumber, 4);
  assert.equal(receipt.tableOrder.tableSessionCode, "TBL4-9988");
  assert.equal(receipt.tableOrder.accumulatedBill, 1164.5);
});

test("sendEBillMessage accurately reports delivery status when provider is unconfigured", async () => {
  const res = await sendEBillMessage({
    phone: "9876543210",
    orderNumber: "ORD-999",
    restaurantName: "Demo Store",
    total: 300,
    itemsCount: 2,
    receiptUrl: "http://localhost:5173/receipt/ORD-999",
  });

  assert.equal(res.success, false, "success is false when unconfigured");
  assert.equal(res.sent, false, "sent is false when unconfigured");
  assert.equal(res.deliveryStatus, "FAILED", "deliveryStatus is FAILED");
  assert.ok(res.error, "error description provided");
});

test("sendEBillMessage fails gracefully for invalid phone numbers", async () => {
  const res = await sendEBillMessage({
    phone: "123", // invalid
    orderNumber: "ORD-999",
    total: 300,
  });

  assert.equal(res.success, false);
  assert.equal(res.sent, false);
  assert.equal(res.deliveryStatus, "FAILED");
});
