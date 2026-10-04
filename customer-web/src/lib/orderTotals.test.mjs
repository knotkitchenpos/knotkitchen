import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cartEstimate, cartOrderType, totalPaid } from "./orderTotals.js";

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

test("a coupon comes off before tax; free delivery is still judged on the subtotal", () => {
  const delivery = { taxPercent: 5, deliveryFee: 40, freeDeliveryAbove: 300 };
  // 400 - 100 off: the subtotal (400) clears ₹300, so delivery is free even
  // though the discounted figure (300) would only just.
  const e = cartEstimate({ subtotal: 400, ordering: delivery, orderType: "delivery", discount: 100 });
  assert.equal(e.discount, 100);
  assert.equal(e.deliveryFee, 0);
  assert.equal(e.taxAmount, 15); // 5% of 300
  assert.equal(e.total, 315);
  // Below the threshold the fee applies, after tax as on the server's bill.
  const low = cartEstimate({ subtotal: 200, ordering: delivery, orderType: "delivery", discount: 50 });
  assert.equal(low.deliveryFee, 40);
  assert.equal(low.total.toFixed(2), "197.50"); // 150 * 1.05 + 40
  // No threshold set: delivery is charged, not silently free.
  assert.equal(cartEstimate({ subtotal: 999, ordering: { deliveryFee: 30 }, orderType: "delivery" }).deliveryFee, 30);
  // A discount never takes the bill below zero.
  assert.equal(cartEstimate({ subtotal: 50, ordering: {}, orderType: "pickup", discount: 80 }).total, 0);
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

test("REGRESSION (C13): a delivery-only store's cart is delivery, never a pickup it can't take", () => {
  const deliveryOnly = { pickupEnabled: false, deliveryEnabled: true };
  // Knot Eats in Pickup mode (or its store fetch failed) defaults to pickup.
  assert.equal(cartOrderType("pickup", deliveryOnly, ""), "delivery");
  // A blocked delivery stays delivery there: explained, and not placeable.
  assert.equal(cartOrderType("pickup", deliveryOnly, "Set your exact location to get delivery"), "delivery");
  const both = { pickupEnabled: true, deliveryEnabled: true };
  assert.equal(cartOrderType("delivery", both, "Out of range"), "pickup");
  assert.equal(cartOrderType("delivery", both, ""), "delivery");

  const drawer = read("components/CartDrawer.jsx");
  assert.match(drawer, /!\(orderType === "delivery" && deliveryBlockedReason\)/);
  assert.match(drawer, /deliveryBlockedReason \|\| "This restaurant only delivers\."/);
});
