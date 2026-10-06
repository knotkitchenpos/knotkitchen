const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildReportBreakdown, categoryLookup } = require("../services/reportBreakdown");
const { buildReportBuckets } = require("../controllers/orderController");

// Store-local (IST) times: the report files orders by the store's hour.
const at = (h) => new Date(`2026-09-17T${String(h).padStart(2, "0")}:15:00+05:30`).toISOString();
const orders = [
  {
    orderStatus: "Completed",
    createdAt: at(13),
    createdBy: { name: "Asha" },
    bills: { totalWithTax: 700 },
    items: [
      { itemId: "i1", name: "Paneer Tikka", quantity: 2, total: 560 },
      { itemId: "i2", name: "Cola", quantity: 1, total: 140 },
    ],
  },
  {
    orderStatus: "Completed",
    createdAt: at(13),
    createdBy: null,
    source: "QR",
    bills: { totalWithTax: 280 },
    items: [{ itemId: "i1", name: "Paneer Tikka", quantity: 1, total: 280 }],
  },
  { orderStatus: "Cancelled", createdAt: at(20), bills: { totalWithTax: 999 }, items: [{ name: "Ghost", quantity: 9, total: 999 }] },
];
const menus = [
  { name: "Starters", items: [{ _id: "i1", name: "Paneer Tikka" }] },
  { name: "Drinks", items: [{ _id: "i2", name: "Cola" }] },
];

test("dishes are summed across orders, cancelled orders are skipped", () => {
  const b = buildReportBreakdown(orders, { categoryOf: categoryLookup(menus) });
  assert.deepEqual(b.byItem[0], { name: "Paneer Tikka", quantity: 3, amount: 840 });
  assert.deepEqual(b.byItem[1], { name: "Cola", quantity: 1, amount: 140 });
  assert.ok(!b.byItem.some((r) => r.name === "Ghost"));
});

test("categories come from the tenant's menus", () => {
  const b = buildReportBreakdown(orders, { categoryOf: categoryLookup(menus) });
  assert.deepEqual(b.byCategory.map((r) => r.name), ["Starters", "Drinks"]);
  assert.equal(b.byCategory[0].amount, 840);
  // No menu match: named, not dropped.
  const c = buildReportBreakdown([{ ...orders[0], items: [{ name: "Mystery", quantity: 1, total: 10 }] }]);
  assert.equal(c.byCategory[0].name, "Uncategorised");
});

test("hours hold whole orders; staff is the till user or the customer channel", () => {
  const b = buildReportBreakdown(orders);
  assert.deepEqual(b.byHour, [{ hour: 13, count: 2, amount: 980 }]);
  assert.deepEqual(
    b.byStaff.map((r) => [r.name, r.count, r.amount]),
    [["Asha", 1, 700], ["Customer · table QR", 1, 280]],
  );
});

test("a variant suffix still finds its category by base name", () => {
  const lookup = categoryLookup(menus);
  assert.equal(lookup({ name: "Cola (Large)" }), "Drinks");
  assert.equal(lookup({ itemId: "i1", name: "renamed" }), "Starters");
});

test("REGRESSION: by-hour uses the store clock, not the server's", () => {
  const was = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    const b = buildReportBreakdown([{ orderStatus: "Completed", createdAt: "2026-10-06T13:15:00+05:30", bills: { totalWithTax: 100 }, items: [] }]);
    assert.deepEqual(b.byHour.map((r) => r.hour), [13]);
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
});

test("REGRESSION: dishes plus adjustments add up to the Total Orders amount", () => {
  const sample = [
    {
      orderStatus: "Completed",
      createdAt: at(13),
      bills: { subtotal: 200, discount: 20, tax: 9, totalWithTax: 189 },
      items: [{ name: "Thali", quantity: 1, total: 200 }],
    },
    {
      // Part refunded, GST included in the price, with a service charge.
      orderStatus: "Completed",
      createdAt: at(14),
      bills: { subtotal: 100, tax: 4.76, taxInclusive: true, serviceCharge: 10, totalWithTax: 110 },
      items: [{ name: "Lassi", quantity: 2, total: 100 }],
      refunds: [{ amount: 30, status: "SUCCESS" }],
    },
    {
      orderStatus: "Completed",
      createdAt: at(15),
      bills: { subtotal: 300, tax: 15, deliveryFee: 40, packagingFee: 10, totalWithTax: 365 },
      items: [{ name: "Biryani", quantity: 1, total: 300 }, { name: "Raita", quantity: 1, total: 50, status: "cancelled" }],
    },
    { orderStatus: "Cancelled", createdAt: at(16), bills: { totalWithTax: 500 }, items: [{ name: "Ghost", quantity: 1, total: 500 }] },
  ];
  const b = buildReportBreakdown(sample);
  const total = buildReportBuckets(sample).total.amount;
  const sum = (rows) => Math.round(rows.reduce((t, r) => t + r.amount, 0) * 100) / 100;
  assert.equal(sum(b.byCategory) + sum(b.adjustments), total);
  assert.equal(sum(b.byItem) + sum(b.adjustments), total);
  assert.deepEqual(
    b.adjustments.map((a) => a.name),
    ["Discounts", "Tax & charges", "Refunds"],
    "nothing unexplained is left over",
  );
  // Hours are net of refunds, like the total.
  assert.equal(b.byHour.find((r) => r.hour === 14).amount, 80);
});

test("dish and category tables are not cut to 50 rows", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ name: `Dish ${i}`, quantity: 1, total: 1 }));
  const b = buildReportBreakdown([{ orderStatus: "Completed", createdAt: at(13), bills: { totalWithTax: 60 }, items: many }]);
  assert.equal(b.byItem.length, 60);
});
