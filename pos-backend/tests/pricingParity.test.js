// The production container runs on UTC; a store-clock regression must not
// hide behind an IST dev machine. Set before anything reads the clock.
process.env.TZ = "UTC";

/**
 * Price parity: the till, the table QR, the website and Knot Eats charge one
 * price per channel, and price rules run on the STORE clock exactly as the
 * till's activePrice evaluates them.
 *
 * The owner's report: "Table QR shows ₹4 but the bill charges ₹6 (the Table
 * channel price)". The display side is pinned in tableQROrdering.test.js.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { unitPriceNow, menuPriceNow, getChannelPrice } = require("../services/businessHours");
const { calculateUnitPrice } = require("../services/price");
const { calculateOrderTotals } = require("../services/orderPricingService");
const { toPublicProduct } = require("../controllers/storefrontController");

const TZ = "Asia/Kolkata";
const MON_1730_IST = new Date("2026-10-05T12:00:00Z"); // 12:00 UTC
const MON_2300_IST = new Date("2026-10-05T17:30:00Z"); // 17:30 UTC

const owner = () => ({
  _id: "i1",
  name: "Chai",
  price: 4,
  samePrice: false,
  channelPrices: { posCollection: 5, posDelivery: 7, posTable: 6, websiteCollection: 9, websiteDelivery: 11, websiteTable: 13 },
});
const menuOf = (item) => ({ _id: "m1", name: "Drinks", items: [item] });

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
const restaurant = { taxId: "19AAACH7409R1ZZ" };

const checkoutUnitPrice = (item, orderType) =>
  calculateOrderTotals({
    items: [{ menuId: "m1", itemId: item._id, quantity: 1 }],
    menus: [menuOf(item)],
    settings,
    restaurant,
    orderType,
    timezone: TZ,
  }).items[0].unitPrice;

const HH = { name: "HH", isActive: true, price: 3, daysOfWeek: [1], startTime: "17:00", endTime: "19:00" };

test("₹4 vs ₹6, bill side: a table line bills the Table channel price", () => {
  assert.equal(calculateUnitPrice({ item: owner() }).unitPrice, 6);
  assert.equal(unitPriceNow(owner(), "table"), 6);
});

test("price rules run on the store clock, not the server's UTC clock", (t) => {
  const item = { ...owner(), priceRules: [HH] };
  const menu = menuOf(item);

  t.mock.timers.enable({ apis: ["Date"], now: MON_1730_IST });
  assert.equal(calculateUnitPrice({ item }).unitPrice, 3, "Mon 17:30 IST is inside 17:00-19:00");
  assert.equal(unitPriceNow(item, "table", TZ), 3);
  assert.deepEqual(toPublicProduct(item, menu, TZ).prices, { collection: 3, delivery: 3 });

  // 17:30 UTC is inside the window only on the server's clock.
  t.mock.timers.setTime(MON_2300_IST.getTime());
  assert.equal(calculateUnitPrice({ item }).unitPrice, 6);
  assert.equal(unitPriceNow(item, "table", TZ), 6);
  assert.deepEqual(toPublicProduct(item, menu, TZ).prices, { collection: 5, delivery: 7 });
});

test("website and Knot Eats checkout bill what the payload shows and the till charges", () => {
  const item = owner();
  const shown = toPublicProduct(item, menuOf(item), TZ).prices;

  assert.equal(checkoutUnitPrice(item, "pickup"), 5);
  assert.equal(shown.collection, 5);
  assert.equal(getChannelPrice(item, "collection"), 5);

  assert.equal(checkoutUnitPrice(item, "delivery"), 7);
  assert.equal(shown.delivery, 7);
  assert.equal(getChannelPrice(item, "delivery"), 7);

  assert.equal(toPublicProduct(item, menuOf(item), TZ).price, 5);
  assert.equal(checkoutUnitPrice({ ...item, discountPrice: 1 }, "pickup"), 5, "discountPrice is no longer read");
  assert.equal(toPublicProduct({ ...item, discountPrice: 1 }, menuOf(item), TZ).price, 5);
});

test("REGRESSION: a sized dish's card shows its cheapest variant on sale, a price the bill charges", () => {
  // Chai 4 / Table 6 / Collection 5 with sizes: every order picks a size and is
  // billed that size's price, so ₹5 or ₹6 on the card could never be charged.
  const small = { _id: "v1", name: "Small", price: 10 };
  const large = { _id: "v2", name: "Large", price: 15 };
  const gone = { _id: "v0", name: "Tiny", price: 8, isAvailable: false };
  const item = { ...owner(), variants: [large, gone, small] };

  assert.deepEqual(toPublicProduct(item, menuOf(item), TZ).prices, { collection: 10, delivery: 10 });
  assert.equal(toPublicProduct(item, menuOf(item), TZ).price, 10);
  assert.equal(menuPriceNow(item, "table", TZ), 10, "the QR card (getTableByToken)");
  assert.equal(calculateUnitPrice({ item, variantId: "v1" }).unitPrice, 10, "the table bill for Small");
  assert.equal(
    calculateOrderTotals({
      items: [{ menuId: "m1", itemId: item._id, variantId: "v1", quantity: 1 }],
      menus: [menuOf(item)],
      settings,
      restaurant,
      orderType: "delivery",
      timezone: TZ,
    }).items[0].unitPrice,
    10,
    "the website/Knot Eats bill for Small",
  );
  assert.equal(menuPriceNow(owner(), "table", TZ), 6, "no variants: the channel price");
});

// The till's own activePrice, lifted out of ProductPanel.jsx so the two
// copies cannot drift apart.
const tillActivePrice = () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "pos-frontend", "src", "components", "pos", "ProductPanel.jsx"),
    "utf8",
  );
  const start = src.indexOf("const parseT");
  const end = src.indexOf("// Every order type's price for a line");
  assert.ok(start > 0 && end > start, "ProductPanel.jsx activePrice block not found");
  const storeClock = () => ({ day: 1, minutes: 17 * 60 + 30 }); // Mon 17:30, the store clock below
  return new Function("storeClock", `${src.slice(start, end)}\nreturn { activePrice };`)(storeClock).activePrice;
};

test("D3: the server prices every rule edge case exactly as the till", (t) => {
  const activePrice = tillActivePrice();
  t.mock.timers.enable({ apis: ["Date"], now: MON_1730_IST });

  const { isActive, ...noActive } = HH;
  const { daysOfWeek, ...noDays } = HH;
  const { startTime, ...noStart } = HH;
  const cases = [
    ["isActive missing", [noActive], 6],
    ["daysOfWeek missing", [noDays], 6],
    ["daysOfWeek []", [{ ...HH, daysOfWeek: [] }], 6],
    ["start === end at now", [{ ...HH, startTime: "17:30", endTime: "17:30" }], 3],
    ["start === end elsewhere", [{ ...HH, startTime: "10:00", endTime: "10:00" }], 6],
    ["start missing", [{ ...noStart, endTime: "10:00" }], 3],
    ["start unparsable", [{ ...HH, startTime: "abc" }], 3],
    ["start without minutes", [{ ...HH, startTime: "17", endTime: "10:00" }], 6],
    ["overnight, inside", [{ ...HH, startTime: "22:00", endTime: "18:00" }], 3],
    ["overnight, outside", [{ ...HH, startTime: "18:00", endTime: "02:00" }], 6],
    ["end is inclusive", [{ ...HH, startTime: "17:00", endTime: "17:30" }], 3],
    ["rule price 0", [{ ...HH, price: 0 }], 0],
    ["isActive false", [{ ...HH, isActive: false }], 6],
    ["first match wins", [HH, { ...HH, price: 2 }], 3],
  ];
  const items = cases.map(([name, priceRules, table]) => [name, { ...owner(), priceRules }, table]);
  items.push(["posTable 0 falls back to item.price", { ...owner(), channelPrices: { ...owner().channelPrices, posTable: 0 }, priceRules: [{ ...HH, isActive: false }] }, 4]);

  for (const [name, item, table] of items) {
    for (const [ch, type] of [["collection", "Collection"], ["delivery", "Delivery"], ["table", "Table Service"]]) {
      assert.equal(unitPriceNow(item, ch, TZ), activePrice(item, type), `${name}: ${ch}`);
    }
    assert.equal(unitPriceNow(item, "table", TZ), table, name);
  }
});

test("D1: no server pricing path reads the website* prices, getEffectivePrice or discountPrice", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  for (const file of [
    "controllers/storefrontController.js",
    "services/orderPricingService.js",
    "services/businessHours.js",
    "services/price.js",
    "controllers/menuController.js",
  ]) {
    const src = read(file);
    assert.doesNotMatch(src, /website(Collection|Delivery|Table)/, file);
    assert.doesNotMatch(src, /getEffectivePrice/, file);
  }
  for (const file of ["services/orderPricingService.js", "controllers/storefrontController.js"]) {
    assert.doesNotMatch(read(file), /discountPrice/, file);
  }
});
