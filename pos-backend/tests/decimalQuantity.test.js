const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * A weighed dish: 1.80 kg must stay 1.80 (owner, 2026-10-16).
 *
 * The till posted 1.8 and the server floored it to 1 (sanitizeItem), so the
 * bill printed "1 x 360.00" for 1.8 kg at 200. The resolvers behind every
 * receipt floored it the same way. Modifier and website quantities stay whole.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const { resolveItemAmounts, formatQty, toQuantity } = require("../services/orderItemAmounts");

test("a fractional quantity resolves as sold, not floored", () => {
  assert.deepEqual(resolveItemAmounts({ quantity: 1.8, price: 200, total: 360 }), {
    quantity: 1.8,
    unitPrice: 200,
    lineTotal: 360,
  });
  assert.equal(toQuantity(1.23456), 1.235, "kept to the gram");
  for (const q of [0, -3, null, undefined, "abc", NaN, 0.0004]) assert.equal(toQuantity(q), 1, String(q));
});

test("a quantity prints as typed: 1.80, not 1.8 or 2", () => {
  assert.equal(formatQty(2), "2");
  assert.equal(formatQty(1.8), "1.80");
  assert.equal(formatQty(0.5), "0.50");
  assert.equal(formatQty(0.375), "0.375");
  assert.equal(formatQty(1.8 + 1.1), "2.90");
  assert.equal(formatQty(0), "0");
});

test("REGRESSION: addOrder keeps 1.8 instead of flooring it to 1", () => {
  const ctrl = SRC("controllers/orderController.js");
  const block = ctrl.slice(ctrl.indexOf("const safeNumber"), ctrl.indexOf("/**\n * The first till line"));
  const sanitizeItem = new Function("toQuantity", `${block}; return sanitizeItem;`)(toQuantity);

  const line = sanitizeItem({ name: "Mutton", quantity: 1.8, price: 200, total: 360 });
  assert.equal(line.quantity, 1.8);
  assert.equal(line.total, 360);
  assert.equal(sanitizeItem({ quantity: 1.23456, price: 1 }).quantity, 1.235);
  assert.equal(sanitizeItem({ quantity: "abc", price: 1 }).quantity, 1);
  assert.equal(sanitizeItem({ quantity: 5000, price: 1 }).quantity, 1000, "still capped");
  // Extras stay whole.
  assert.equal(sanitizeItem({ quantity: 1, modifiers: [{ name: "Cheese", quantity: 1.5 }] }).modifiers[0].quantity, 1);
});

test("a table round from the till keeps 1.8; a diner's QR order stays whole", async () => {
  const price = require("../services/price");
  price.resolveMenuItem = async () => ({ item: { _id: "m1", name: "Mutton" }, timezone: "Asia/Kolkata" });
  price.calculateUnitPrice = () => ({ unitPrice: 333.33, variant: null, addons: [], modifiers: [] });
  const { enrichItems } = require("../controllers/tableSessionController");

  const [line] = await enrichItems({ items: [{ menuItemId: "m1", quantity: 1.8 }], restaurantId: "r", addedBy: "POS" });
  assert.equal(line.quantity, 1.8);
  assert.equal(line.total, 599.99);
  const [half] = await enrichItems({ items: [{ menuItemId: "m1", quantity: 0.5 }], restaurantId: "r", addedBy: "POS" });
  assert.equal(half.quantity, 0.5);

  await assert.rejects(enrichItems({ items: [{ menuItemId: "m1", quantity: 1.5 }], restaurantId: "r", addedBy: "QR" }), { status: 400 });
  await assert.rejects(enrichItems({ items: [{ menuItemId: "m1", quantity: 0 }], restaurantId: "r", addedBy: "POS" }), { status: 400 });
  await assert.rejects(enrichItems({ items: [{ menuItemId: "m1", quantity: "abc" }], restaurantId: "r", addedBy: "POS" }), { status: 400 });
  const [whole] = await enrichItems({ items: [{ menuItemId: "m1", quantity: 2 }], restaurantId: "r", addedBy: "QR" });
  assert.equal(whole.quantity, 2);
});

test("the bill's subtotal is the sum of the lines it prints", () => {
  const { calculateBill } = require("../services/price");
  const bill = calculateBill({ items: [{ price: 333.33, quantity: 1.8 }, { price: 333.33, quantity: 1.8 }], taxRate: 0 });
  assert.equal(bill.subtotal, 1199.98, "two lines of 599.99");
});

test("receipts, the e-bill and Top dishes carry the fraction", () => {
  const { buildReceipt } = require("../services/receiptService");
  const r = buildReceipt({
    order: {
      orderStatus: "Completed",
      bills: { subtotal: 470, totalWithTax: 470 },
      items: [{ name: "Mutton", quantity: 1.8, price: 200, total: 360 }, { name: "Rice", quantity: 1.1, price: 100, total: 110 }],
    },
  });
  assert.equal(r.items[0].quantity, 1.8);
  assert.equal(r.items[0].price, 200);
  assert.equal(r.quantities, 2.9);
  assert.match(SRC("controllers/publicReceiptController.js"), /\$\{formatQty\(i\.quantity\)\} × /);

  const { buildReportBreakdown } = require("../services/reportBreakdown");
  const b = buildReportBreakdown([
    {
      orderStatus: "Completed",
      createdAt: "2026-10-16T13:15:00+05:30",
      bills: { totalWithTax: 470 },
      items: [{ name: "Mutton", quantity: 1.8, total: 360 }, { name: "Mutton", quantity: 1.1, total: 110 }],
    },
  ]);
  assert.equal(b.byItem[0].quantity, 2.9);
});
