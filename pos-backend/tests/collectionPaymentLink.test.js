const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_ID = "111111111111111111111111";
const USER_ID = "222222222222222222222222";
const ORDER_ID = "333333333333333333333333";
const BILL_ID = "444444444444444444444444";

test("validateCollectionPhone helper validates 10-15 digit phones and rejects missing or malformed phones", () => {
  const { validateCollectionPhone } = require("../controllers/paymentLinkController");

  // Valid phones
  assert.equal(validateCollectionPhone("9876543210").valid, true);
  assert.equal(validateCollectionPhone("+91 9876543210").valid, true);
  assert.equal(validateCollectionPhone("12345678901").valid, true);

  // Missing phone
  assert.equal(validateCollectionPhone("").valid, false);
  assert.equal(validateCollectionPhone(null).valid, false);
  assert.equal(validateCollectionPhone(undefined).valid, false);

  // Invalid / malformed phone
  assert.equal(validateCollectionPhone("12345").valid, false);
  assert.equal(validateCollectionPhone("12345678901234567").valid, false);
});

test("createPaymentLink requires valid phone number for collection order", async () => {
  let createdLink = null;
  let sentMessage = null;

  const mockOrder = {
    _id: ORDER_ID,
    restaurantId: RESTAURANT_ID,
    customerDetails: { name: "Jane", phone: "" }, // Missing phone
    bills: { totalWithTax: 250, subtotal: 200, tax: 50 },
    payments: [],
    orderStatus: "pending",
  };

  const OrderMock = {
    findOne: async (q) => (q._id === ORDER_ID ? mockOrder : null),
  };

  const BillMock = {
    findOne: async () => null,
    create: async (data) => ({ _id: BILL_ID, ...data }),
  };

  const PaymentLinkMock = {
    findOne: async () => null,
    create: async (data) => {
      createdLink = data;
      return { _id: "link-1", toObject: () => data, ...data };
    },
  };

  const RestaurantMock = {
    findById: async () => ({ name: "Demo Takeaway" }),
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/orderModel") return OrderMock;
    if (r === "../models/billModel") return BillMock;
    if (r === "../models/paymentLinkModel") return PaymentLinkMock;
    if (r === "../models/restaurantModel") return RestaurantMock;
    if (r === "../models/websiteSettingsModel") return { findOne: async () => null };
    if (r === "../models/paymentTransactionModel") return {};
    // Creating a link now REQUIRES a usable gateway: one nobody can pay is
    // worse than no link, so the controller refuses rather than minting a
    // token against nothing. Give it one, and stub the SDK so the test
    // never reaches the network.
    if (r === "../services/paymentGateway")
      return {
        PROVIDERS: { CASHFREE: "cashfree", PHONEPE: "phonepe" },
        resolveGateway: async () => ({
          enabled: true,
          provider: "cashfree",
          keyId: "rzp_test_mock",
          secret: "mock_secret",
          environment: "TEST",
          source: "platform",
        }),
      };
    if (r === "../services/gateways/cashfree")
      return {
        createOrder: async () => ({
          orderId: "lnk_mock123",
          paymentSessionId: "session_mock123",
        }),
      };
    if (r === "../models/tableSessionModel") return {};
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/paymentLinkController")];
  const { createPaymentLink } = require("../controllers/paymentLinkController");

  try {
  // Test 1: Missing phone -> Expect 400 Bad Request
  let errorCaught = null;
  const reqNoPhone = {
    body: { orderId: ORDER_ID },
    user: { _id: USER_ID, restaurantId: RESTAURANT_ID },
  };
  await createPaymentLink(reqNoPhone, {}, (err) => {
    errorCaught = err;
  });

  assert.ok(errorCaught);
  assert.equal(errorCaught.status, 400);
  assert.ok(errorCaught.message.includes("phone number is required"));

  // Test 2: Invalid/Malformed phone -> Expect 400 Bad Request
  errorCaught = null;
  const reqInvalidPhone = {
    body: { orderId: ORDER_ID, phone: "123" },
    user: { _id: USER_ID, restaurantId: RESTAURANT_ID },
  };
  await createPaymentLink(reqInvalidPhone, {}, (err) => {
    errorCaught = err;
  });

  assert.ok(errorCaught);
  assert.equal(errorCaught.status, 400);
  assert.ok(errorCaught.message.includes("Invalid or malformed phone number"));

  // Test 3: Valid phone -> Expect payment link creation
  let resData = null;
  const resSuccess = {
    status: (code) => {
      assert.equal(code, 201);
      return resSuccess;
    },
    json: (payload) => {
      resData = payload;
    },
  };
  const reqValidPhone = {
    body: { orderId: ORDER_ID, phone: "9876543210" },
    user: { _id: USER_ID, restaurantId: RESTAURANT_ID },
  };
  await createPaymentLink(reqValidPhone, resSuccess, () => {});

  assert.ok(resData);
  assert.equal(resData.success, true);
  assert.equal(createdLink.customerPhone, "9876543210");
  assert.equal(createdLink.amount, 250);
  assert.equal(createdLink.linkToken.length, 64); // Non-guessable 64-char hex token
  } finally {
    Module._load = orig;
  }
});

test("createPaymentLink is idempotent: returns existing active link for same order without duplicating", async () => {
  const existingActiveToken = "a".repeat(64);
  const mockExistingLink = {
    _id: "link-existing",
    linkToken: existingActiveToken,
    amount: 300,
    status: "ACTIVE",
    toObject: function () {
      return { linkToken: existingActiveToken, amount: 300, status: "ACTIVE" };
    },
  };

  const OrderMock = {
    findOne: async () => ({
      _id: ORDER_ID,
      restaurantId: RESTAURANT_ID,
      customerDetails: { phone: "9876543210" },
      bills: { totalWithTax: 300 },
      payments: [],
    }),
  };

  const BillMock = {
    findOne: async () => ({ _id: BILL_ID }),
  };

  const PaymentLinkMock = {
    findOne: async () => mockExistingLink, // Returns active link
    create: async () => {
      assert.fail("Should not create a duplicate payment link!");
    },
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/orderModel") return OrderMock;
    if (r === "../models/billModel") return BillMock;
    if (r === "../models/paymentLinkModel") return PaymentLinkMock;
    if (r === "../models/restaurantModel") return { findById: async () => ({ name: "Test" }) };
    // A store WITH a usable gateway. Creating a link now requires one:
    // a link nobody can pay is worse than no link, so the controller
    // refuses rather than minting a token against nothing.
    if (r === "../models/websiteSettingsModel")
      return {
        findOne: () => ({
          select: () => ({
            lean: async () => ({
              paymentGateways: {
                activeGateway: "cashfree",
                cashfree: {
                  isConfigured: true,
                  keyId: "rzp_test_mock",
                  keySecretEncrypted: Buffer.from("mock_secret").toString("base64"),
                  environment: "TEST",
                },
              },
            }),
          }),
          $or: [],
        }),
      };
    if (r === "../models/paymentTransactionModel") return {};
    if (r === "../models/tableSessionModel") return {};
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/paymentLinkController")];
  const { createPaymentLink } = require("../controllers/paymentLinkController");

  let resData = null;
  const res = {
    status: (code) => {
      assert.equal(code, 200);
      return res;
    },
    json: (payload) => {
      resData = payload;
    },
  };

  const req = {
    body: { orderId: ORDER_ID, phone: "9876543210" },
    user: { _id: USER_ID, restaurantId: RESTAURANT_ID },
  };

  try {
    await createPaymentLink(req, res, () => {});

    assert.ok(resData);
    assert.equal(resData.deduplicated, true);
    assert.equal(resData.data.linkToken, existingActiveToken);
  } finally {
    Module._load = orig;
  }
});

test("getPaymentLink returns all 10 required payment page fields and rejects expired links", async () => {
  const activeToken = "b".repeat(64);
  const mockLink = {
    linkToken: activeToken,
    amount: 500,
    status: "ACTIVE",
    expiresAt: new Date(Date.now() + 3600000), // 1 hour in future
    customerPhone: "9876543210",
    orderId: {
      _id: ORDER_ID,
      marketplaceOrderId: "COLLECTION-101",
      items: [
        { name: "Burger", quantity: 2, price: 200, total: 400, modifiers: [] },
        { name: "Fries", quantity: 1, price: 100, total: 100, modifiers: [] },
      ],
      bills: { subtotal: 500, tax: 25, packagingFee: 10 },
    },
    billId: {
      billNumber: "BILL-101",
      bills: { subtotal: 500, tax: 25, charges: 10 },
    },
    restaurantId: {
      name: "Super Burgers",
    },
  };

  const PaymentLinkMock = {
    findOne: (q) => ({
      populate: () => ({
        populate: () => ({
          populate: async () => mockLink,
        }),
      }),
    }),
  };

  const Module = require("module");
  const orig = Module._load;
  Module._load = function (r, p, m) {
    if (r === "../models/paymentLinkModel") return PaymentLinkMock;
    return orig.apply(this, arguments);
  };

  delete require.cache[require.resolve("../controllers/paymentLinkController")];
  const { getPaymentLink } = require("../controllers/paymentLinkController");
  Module._load = orig;

  let resData = null;
  const res = {
    status: (code) => {
      assert.equal(code, 200);
      return res;
    },
    json: (payload) => {
      resData = payload;
    },
  };

  const req = { params: { token: activeToken } };
  await getPaymentLink(req, res, () => {});

  assert.ok(resData);
  assert.equal(resData.success, true);
  const data = resData.data;

  // Verify link content fields required:
  assert.equal(data.restaurantName, "Super Burgers");
  assert.equal(data.orderNumber, "COLLECTION-101");
  assert.equal(data.orderedItems.length, 2);
  assert.equal(data.quantities, 3);
  assert.equal(data.taxes, 25);
  assert.equal(data.charges, 10);
  assert.equal(data.total, 500);
  assert.equal(data.paymentStatus, "ACTIVE");
  assert.deepEqual(data.availablePaymentMethods, ["CARD", "UPI", "NETBANKING"]);

  // Now test expired link
  mockLink.expiresAt = new Date(Date.now() - 3600000); // 1 hour ago
  let errorCaught = null;
  await getPaymentLink(req, res, (err) => {
    errorCaught = err;
  });

  assert.ok(errorCaught);
  assert.equal(errorCaught.status, 400);
  assert.ok(errorCaught.message.includes("expired"));
});
