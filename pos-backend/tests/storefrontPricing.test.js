const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateOrderTotals,
  PricingError,
} = require("../services/orderPricingService");

/**
 * Authoritative pricing tests (§38).
 *
 * These are the most security-critical tests in the feature: they prove the
 * server computes prices itself and rejects tampered / cross-store payloads.
 */

// ---- Fixtures: two stores, each with its own menu ----
const storeAMenu = {
  _id: "menuA",
  restaurantId: "restA",
  items: [
    {
      _id: "burger",
      name: "Chicken Burger",
      price: 199,
      isAvailable: true,
      variants: [
        { _id: "vReg", name: "Regular", price: 199, isAvailable: true },
        { _id: "vLarge", name: "Large", price: 249, isAvailable: true },
        { _id: "vGone", name: "Sold Out", price: 300, isAvailable: false },
      ],
      addons: [
        { _id: "aCheese", name: "Extra Cheese", price: 40, isAvailable: true },
        { _id: "aPatty", name: "Extra Patty", price: 80, isAvailable: true },
        { _id: "aOut", name: "Jalapeno", price: 20, isAvailable: false },
      ],
      modifierGroups: [
        {
          _id: "gMeal",
          name: "Meal Option",
          required: true,
          minSelections: 1,
          maxSelections: 1,
          options: [
            { _id: "oOnly", name: "Burger Only", price: 0, isAvailable: true },
            { _id: "oMeal", name: "Burger + Fries + Coke", price: 80, isAvailable: true },
          ],
        },
      ],
    },
    {
      _id: "fries",
      name: "Fries",
      price: 99,
      isAvailable: true,
      variants: [],
      addons: [],
      modifierGroups: [],
    },
    {
      _id: "soup",
      name: "Soup of the Day",
      price: 120,
      isAvailable: false, // explicitly unavailable
      variants: [],
      addons: [],
      modifierGroups: [],
    },
  ],
};

const storeBMenu = {
  _id: "menuB",
  restaurantId: "restB",
  items: [
    {
      _id: "biryani",
      name: "Chicken Biryani",
      price: 320,
      isAvailable: true,
      variants: [],
      addons: [],
      modifierGroups: [],
    },
  ],
};

const settings = {
  ordering: {
    pickupEnabled: true,
    deliveryEnabled: true,
    deliveryFee: 40,
    freeDeliveryAbove: 500,
    packagingFee: 10,
    taxPercent: 5,
    taxInclusive: false,
    minOrderValue: 0,
    currencySymbol: "₹",
  },
};

const priceIt = (items, orderType = "pickup", customSettings = settings) =>
  calculateOrderTotals({
    items,
    menus: [storeAMenu],
    settings: customSettings,
    orderType,
    timezone: "Asia/Kolkata",
  });

// ---------------------------------------------------------------------------

test("prices a simple item from the store's own menu", () => {
  const result = priceIt([{ menuId: "menuA", itemId: "fries", quantity: 2 }]);

  assert.equal(result.items[0].unitPrice, 99);
  assert.equal(result.items[0].total, 198);
  assert.equal(result.bills.subtotal, 198);
});

test("variant replaces the base price instead of adding to it", () => {
  const result = priceIt([
    {
      menuId: "menuA",
      itemId: "burger",
      quantity: 1,
      variantId: "vLarge",
      modifierSelections: [{ groupId: "gMeal", optionId: "oOnly" }],
    },
  ]);

  // Large (249) + Burger Only (0) — NOT 199 + 249
  assert.equal(result.items[0].unitPrice, 249);
});

test("add-ons and meal options are summed correctly", () => {
  const result = priceIt([
    {
      menuId: "menuA",
      itemId: "burger",
      quantity: 2,
      variantId: "vReg",
      addonIds: ["aCheese", "aPatty"],
      modifierSelections: [{ groupId: "gMeal", optionId: "oMeal" }],
    },
  ]);

  // 199 + 40 + 80 + 80 = 399 per unit, ×2 = 798
  assert.equal(result.items[0].unitPrice, 399);
  assert.equal(result.items[0].total, 798);
});

test("computes packaging, delivery and tax authoritatively", () => {
  const result = priceIt([{ menuId: "menuA", itemId: "fries", quantity: 1 }], "delivery");

  // subtotal 99 + packaging 10 = 109 taxable; tax 5% = 5.45; + delivery 40
  assert.equal(result.bills.subtotal, 99);
  assert.equal(result.bills.packagingFee, 10);
  assert.equal(result.bills.deliveryFee, 40);
  assert.equal(result.bills.tax, 5.45);
  assert.equal(result.bills.totalWithTax, 154.45);
});

test("waives the delivery fee above the free-delivery threshold", () => {
  const result = priceIt(
    [{ menuId: "menuA", itemId: "fries", quantity: 6 }], // 594 >= 500
    "delivery"
  );
  assert.equal(result.bills.deliveryFee, 0);
});

// ---------------------- SECURITY / TAMPERING ------------------------------

test("SECURITY: a client-supplied price is completely ignored", () => {
  const result = priceIt([
    { menuId: "menuA", itemId: "fries", quantity: 1, price: 1, total: 1, unitPrice: 1 },
  ]);

  // The server used its own price (99), not the injected 1.
  assert.equal(result.items[0].unitPrice, 99);
  assert.equal(result.bills.subtotal, 99);
});

test("SECURITY: an item from ANOTHER store cannot be ordered", () => {
  assert.throws(
    () =>
      calculateOrderTotals({
        // Store B's product, but only Store A's menus are in scope.
        items: [{ menuId: "menuB", itemId: "biryani", quantity: 1 }],
        menus: [storeAMenu],
        settings,
        orderType: "pickup",
      }),
    (err) => err instanceof PricingError && /no longer available/i.test(err.message)
  );
});

test("SECURITY: a variant id from another product is rejected", () => {
  assert.throws(
    () =>
      priceIt([
        { menuId: "menuA", itemId: "fries", quantity: 1, variantId: "vLarge" },
      ]),
    (err) => err instanceof PricingError && /Invalid option/i.test(err.message)
  );
});

test("SECURITY: an unknown add-on id is rejected", () => {
  assert.throws(
    () =>
      priceIt([
        {
          menuId: "menuA",
          itemId: "burger",
          quantity: 1,
          variantId: "vReg",
          addonIds: ["free-food"],
          modifierSelections: [{ groupId: "gMeal", optionId: "oOnly" }],
        },
      ]),
    (err) => err instanceof PricingError && /Invalid add-on/i.test(err.message)
  );
});

test("unavailable products, variants and add-ons are rejected", () => {
  assert.throws(
    () => priceIt([{ menuId: "menuA", itemId: "soup", quantity: 1 }]),
    (err) => err instanceof PricingError && /currently unavailable/i.test(err.message)
  );

  assert.throws(
    () =>
      priceIt([
        {
          menuId: "menuA",
          itemId: "burger",
          quantity: 1,
          variantId: "vGone",
          modifierSelections: [{ groupId: "gMeal", optionId: "oOnly" }],
        },
      ]),
    (err) => err instanceof PricingError && /unavailable/i.test(err.message)
  );
});

test("a required modifier group must be satisfied", () => {
  assert.throws(
    () => priceIt([{ menuId: "menuA", itemId: "burger", quantity: 1, variantId: "vReg" }]),
    (err) => err instanceof PricingError && /Meal Option/.test(err.message)
  );
});

test("a variant must be chosen when the product has variants", () => {
  assert.throws(
    () =>
      priceIt([
        {
          menuId: "menuA",
          itemId: "burger",
          quantity: 1,
          modifierSelections: [{ groupId: "gMeal", optionId: "oOnly" }],
        },
      ]),
    (err) => err instanceof PricingError && /select an option/i.test(err.message)
  );
});

test("invalid quantities are rejected", () => {
  for (const quantity of [0, -5, "abc", 1000]) {
    assert.throws(
      () => priceIt([{ menuId: "menuA", itemId: "fries", quantity }]),
      PricingError,
      `quantity ${quantity} should be rejected`
    );
  }
});

test("an empty cart is rejected", () => {
  assert.throws(() => priceIt([]), PricingError);
});

test("delivery is refused when the store has it disabled", () => {
  const pickupOnly = { ordering: { ...settings.ordering, deliveryEnabled: false } };
  assert.throws(
    () => priceIt([{ menuId: "menuA", itemId: "fries", quantity: 1 }], "delivery", pickupOnly),
    (err) => err instanceof PricingError && /does not offer delivery/i.test(err.message)
  );
});

test("the minimum order value is enforced server-side", () => {
  const withMinimum = { ordering: { ...settings.ordering, minOrderValue: 500 } };
  assert.throws(
    () => priceIt([{ menuId: "menuA", itemId: "fries", quantity: 1 }], "pickup", withMinimum),
    (err) => err instanceof PricingError && /Minimum order value/i.test(err.message)
  );
});

test("tax-inclusive pricing extracts rather than adds tax", () => {
  const inclusive = {
    ordering: { ...settings.ordering, taxInclusive: true, packagingFee: 0, taxPercent: 5 },
  };
  const result = priceIt([{ menuId: "menuA", itemId: "fries", quantity: 1 }], "pickup", inclusive);

  // 99 already includes 5% tax → total stays 99.
  assert.equal(result.bills.totalWithTax, 99);
  assert.ok(result.bills.tax > 0 && result.bills.tax < 99);
});
