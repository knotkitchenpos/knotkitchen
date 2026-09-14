const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { resolveItemAmounts } = require("../services/orderItemAmounts");
const { buildReceipt } = require("../services/receiptService");

/**
 * What a line costs, and the two different things `price` has meant.
 *
 *   cart     price = the LINE total (cartSlice: pricePerQuantity x quantity)
 *   database price = the UNIT price, `total` holds the line
 *                    (stated on tableSessionItemSchema)
 *
 * The POS posted its cart straight through, so every POS order stored the line
 * total in `price` and, having no `total` to send, left `total` at 0. Nothing
 * errored. It showed up as arithmetic that did not add up:
 *
 *   - the cart line displayed quantity x line total (100 taken 2x read 400
 *     against a subtotal of 200)
 *   - the receipt rebuilt the line as `total || price * quantity`, which with
 *     total at 0 multiplied the quantity in a second time
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const FE = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", rel), "utf8");

// 100 each, taken twice, in each of the three shapes that exist in the data.
const SHAPES = {
  "legacy POS line (price = line total, total = 0)": { price: 200, total: 0, quantity: 2 },
  "current POS line (price = unit, total = line)": { price: 100, total: 200, quantity: 2 },
  "table session line (always correct)": { price: 100, total: 200, quantity: 2 },
};

test("every stored shape resolves to the same, correct amounts", () => {
  for (const [label, item] of Object.entries(SHAPES)) {
    const { quantity, unitPrice, lineTotal } = resolveItemAmounts(item);
    assert.equal(quantity, 2, label);
    assert.equal(unitPrice, 100, `${label}: unit price`);
    assert.equal(lineTotal, 200, `${label}: line total`);
  }
});

test("REGRESSION: the receipt lines add up to the bill's own subtotal", () => {
  // The failure was silent and self-contradictory: an e-bill whose items did
  // not sum to the total printed on the same bill.
  for (const [label, item] of Object.entries(SHAPES)) {
    const receipt = buildReceipt({
      order: {
        orderStatus: "Completed",
        bills: { subtotal: 200, totalWithTax: 200 },
        items: [{ name: "Tea", ...item }],
      },
    });

    const summed = receipt.items.reduce((n, i) => n + i.total, 0);
    assert.equal(summed, receipt.subtotal, `${label}: items must sum to the subtotal`);
    assert.equal(receipt.items[0].price, 100, `${label}: unit price on the line`);
    assert.equal(receipt.items[0].quantity, 2, label);
  }
});

test("quantity one is unambiguous in every shape", () => {
  assert.deepEqual(resolveItemAmounts({ price: 100, total: 0, quantity: 1 }), {
    quantity: 1,
    unitPrice: 100,
    lineTotal: 100,
  });
  assert.deepEqual(resolveItemAmounts({ price: 100, total: 100, quantity: 1 }), {
    quantity: 1,
    unitPrice: 100,
    lineTotal: 100,
  });
});

test("a missing or nonsense quantity never divides by zero", () => {
  for (const quantity of [0, -3, null, undefined, "abc", NaN]) {
    const r = resolveItemAmounts({ price: 150, total: 0, quantity });
    assert.equal(r.quantity, 1, `quantity ${String(quantity)}`);
    assert.ok(Number.isFinite(r.unitPrice), `quantity ${String(quantity)} gave ${r.unitPrice}`);
    assert.equal(r.unitPrice, 150);
  }
});

test("amounts that do not divide evenly stay to two decimals", () => {
  const r = resolveItemAmounts({ price: 0, total: 100, quantity: 3 });
  assert.equal(r.unitPrice, 33.33);
  assert.equal(r.lineTotal, 100, "the line total is never re-derived from a rounded unit");
});

test("SOURCE: a line total is never stored as zero again", () => {
  // sanitizeItem used to write `total: safeNumber(raw.total, 0)`, so a client
  // sending only `price` stored a zero that nothing downstream could read.
  const src = SRC("controllers/orderController.js");
  assert.match(src, /safeNumber\(price \* quantity/, "sanitizeItem must derive the line total");
});

test("SOURCE: the POS maps its cart instead of posting it raw", () => {
  const panel = FE("src/components/pos/OrderPanel.jsx");
  assert.match(panel, /items: toOrderItems\(cart\)/, "the cart's `price` is not the API's `price`");

  // Exactly one raw `items: cart` may remain: holding an order stashes the
  // cart locally and restores it into the cart again, so it must keep the
  // cart's own shape. Anything crossing the API boundary has to be mapped.
  const raw = panel.match(/items: cart,/g) || [];
  assert.equal(raw.length, 1, "only the held-order stash may keep the raw cart shape");
});

test("SOURCE: the cart line is priced from the unit, not the line total", () => {
  const panel = FE("src/components/pos/OrderPanel.jsx");
  // The display bug: item.price is already qty x unit, and it was multiplied
  // by the quantity a second time.
  assert.ok(
    !/Number\(item\.price \|\| 0\) - modifiersUnitPrice/.test(panel),
    "baseUnitPrice must come from the unit price",
  );
  assert.match(panel, /const unitPrice =\s*\n?\s*Number\(item\.pricePerQuantity\)/);
});

test("SOURCE: both frontend receipts show the line amount", () => {
  for (const file of ["src/utils/receiptLayout.js", "src/components/invoice/Invoice.jsx"]) {
    assert.match(FE(file), /resolveItemAmounts/, `${file} must resolve the amount it prints`);
  }
});

test("SOURCE: the two resolvers agree", () => {
  // One lives in each half of the codebase; they must behave identically.
  const be = SRC("services/orderItemAmounts.js");
  const fe = FE("src/utils/orderItems.js");
  for (const src of [be, fe]) {
    assert.match(src, /storedTotal > 0 \? storedTotal : Number\(item\.price \|\| 0\)/);
    assert.match(src, /Math\.max\(1, Math\.floor\(Number\(item\.quantity\) \|\| 1\)\)/);
  }
});
