import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cartEstimate, totalPaid } from "./orderTotals.js";

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// 5% GST store, KnotKitchen's Rs 3 + 18% GST fee = Rs 3.54.
const ordering = { taxPercent: 5, packagingFee: 10, platformFee: 3.54 };

test("the cart adds the platform fee to the total, outside the restaurant's tax", () => {
  const e = cartEstimate({ subtotal: 190, ordering, orderType: "pickup" });
  assert.equal(e.platformFee, 3.54);
  assert.equal(e.taxAmount, 10); // 5% of 200, the fee not taxed again
  assert.equal(e.total.toFixed(2), "213.54");
  // A store with no fee: nothing added, and no row to show.
  const none = cartEstimate({ subtotal: 190, ordering: { ...ordering, platformFee: 0 }, orderType: "pickup" });
  assert.equal(none.platformFee, 0);
  assert.equal(none.total.toFixed(2), "210.00");

  const drawer = read("components/CartDrawer.jsx");
  assert.match(drawer, /platformFee \? <Row label="Platform fee"/, "a Platform fee row, only when there is one");
  assert.match(drawer, /Place order & pay · \$\{symbol\}\$\{total\.toFixed\(2\)\}/, "the pay button shows the fee-inclusive total");
});

test("the confirmation's Total paid is what the customer was charged", () => {
  const bills = { subtotal: 200, tax: 10, totalWithTax: 210, platformFee: 3.54 };
  // The server's figure wins.
  assert.equal(totalPaid({ bills, totalPaid: 213.54 }), 213.54);
  // An older server: bill plus the fee, rounded to paise.
  assert.equal(totalPaid({ bills }), 213.54);
  assert.equal(totalPaid({ bills: { totalWithTax: 210 } }), 210);

  const page = read("components/OrderConfirmation.jsx");
  assert.match(page, /<span>Platform fee<\/span>/);
  assert.match(page, /totalPaid\(order\)\.toFixed\(2\)/);
});
