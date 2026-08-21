const { test } = require("node:test");
const assert = require("node:assert/strict");

const RESTAURANT_ID = "507f1f77bcf86cd799439011";
const STORE_ID = "123456";

test("Website Module 4: calculateOrderTotals enforces authoritative pricing and ignores client price tampering", () => {
  const { calculateOrderTotals } = require("../services/orderPricingService");

  const mockMenu = {
    _id: "m-1",
    name: "Main Menu",
    published: true,
    items: [
      {
        _id: "dish-1",
        name: "Veg Biryani",
        price: 250,
        showOnWebsite: true,
        isAvailable: true,
      },
    ],
  };

  const mockSettings = {
    ordering: {
      pickupEnabled: true,
      deliveryEnabled: true,
      minOrderValue: 200,
      taxPercent: 5,
      deliveryFee: 40,
    },
  };

  const clientSubmission = {
    items: [
      { menuId: "m-1", itemId: "dish-1", quantity: 2, price: 1 }, // Hacked client price ₹1
    ],
    menus: [mockMenu],
    settings: mockSettings,
    orderType: "pickup",
  };

  const priced = calculateOrderTotals(clientSubmission);

  assert.ok(priced);
  assert.equal(priced.bills.subtotal, 500); // 250 * 2 = 500 (₹1 ignored)
  assert.equal(priced.bills.tax, 25); // 5% GST = 25
  assert.equal(priced.bills.totalWithTax, 525);
});

test("Website Module 4: Minimum order value requirement is strictly enforced on backend", () => {
  const { calculateOrderTotals, PricingError } = require("../services/orderPricingService");

  const mockMenu = {
    _id: "m-1",
    published: true,
    items: [
      {
        _id: "dish-tea",
        name: "Masala Chai",
        price: 30,
        showOnWebsite: true,
        isAvailable: true,
      },
    ],
  };

  const mockSettings = {
    ordering: {
      pickupEnabled: true,
      minOrderValue: 150, // Minimum order ₹150
    },
  };

  let errorCaught = null;
  try {
    calculateOrderTotals({
      items: [{ menuId: "m-1", itemId: "dish-tea", quantity: 1 }], // Subtotal ₹30 < ₹150
      menus: [mockMenu],
      settings: mockSettings,
      orderType: "pickup",
    });
  } catch (err) {
    errorCaught = err;
  }

  assert.ok(errorCaught);
  assert.equal(errorCaught instanceof PricingError, true);
  assert.ok(errorCaught.message.includes("Minimum order"));
});
