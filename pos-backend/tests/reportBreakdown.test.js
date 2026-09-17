const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildReportBreakdown, categoryLookup } = require("../services/reportBreakdown");

const at = (h) => new Date(2026, 8, 17, h, 15).toISOString();
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
