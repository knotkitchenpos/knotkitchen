import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { deliveryFeeFor } from "../src/utils/rulesCharges.js";

const SRC = (rel) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");
const body = (src, start) => src.slice(src.indexOf(start), src.indexOf("\n  };", src.indexOf(start)));

test("Delivery asks for the address first, then the payment", () => {
  const panel = SRC("components/pos/OrderPanel.jsx");
  const finish = body(panel, "const finish = () =>");
  assert.ok(finish.indexOf("if (isDelivery) return setShowDelivery(true);") > -1);
  assert.ok(
    finish.indexOf("setShowDelivery(true)") < finish.indexOf("setShowPaymentMethod(true)"),
    "the details come before the method",
  );
  // The method is passed in, never read back from state set earlier.
  assert.match(panel, /doDelivery\(\{ \.\.\.delivery, chosenMethod: method, splits \}\)/);
  assert.doesNotMatch(panel, /pendingMethod/);
  // CollectionModal was dead code that never opened.
  assert.doesNotMatch(panel, /CollectionModal|showCollection/);
  assert.ok(!fs.existsSync(new URL("../src/components/pos/CollectionModal.jsx", import.meta.url)));

  const modal = SRC("components/pos/DeliveryModal.jsx");
  assert.match(modal, /Continue to payment/);
  assert.doesNotMatch(modal, /Order Total/);
});

test("Delivery details are Indian: examples, a 10-digit mobile and a 6-digit pincode", () => {
  const modal = SRC("components/pos/DeliveryModal.jsx");
  assert.doesNotMatch(modal, /Swansea|SA4 8DE|Ffordd|Pontarddulais|Ray Castle/);
  assert.match(modal, /const PHONE = \/\^\[6-9\]\\d\{9\}\$\/;/);
  assert.match(modal, /const PIN = \/\^\[1-9\]\\d\{5\}\$\/;/);
  assert.match(modal, /maxLength=\{6\}/);
});

test("a collection phone, when given, must be a real mobile", () => {
  const panel = SRC("components/pos/OrderPanel.jsx");
  const pick = body(panel, "const onPickPaymentMethod");
  assert.match(pick, /const phone = mobileDigits\(customer\.customerPhone\);/);
  assert.match(pick, /if \(phone && !\/\^\[6-9\]\\d\{9\}\$\/\.test\(phone\)\) \{/);
  assert.ok(pick.indexOf("return;", pick.indexOf("test(phone)")) < pick.indexOf("doCollection("), "refused before the order");
});

test("delivery is priced by distance slabs the way the server prices it", () => {
  const ordering = {
    deliveryFee: 20,
    deliverySlabsConfig: { maxDistanceKm: 7, slabs: [{ minKm: 0, maxKm: 3, fee: 30 }, { minKm: 3, maxKm: 5, fee: 60 }] },
  };
  assert.equal(deliveryFeeFor({ ordering, distanceKm: 5, subtotal: 200 }), 60);
  assert.equal(deliveryFeeFor({ ordering, distanceKm: 6, subtotal: 200 }), 60, "past the last slab: its fee");
  assert.equal(deliveryFeeFor({ ordering, subtotal: 200 }), null, "km not entered yet");
  assert.equal(deliveryFeeFor({ ordering, distanceKm: 8, subtotal: 200 }), null, "past the store's limit");
  assert.equal(deliveryFeeFor({ ordering: { ...ordering, freeDeliveryAbove: 150 }, distanceKm: 2, subtotal: 200 }), 0);
  assert.equal(deliveryFeeFor({ ordering: { deliveryFee: 25 }, subtotal: 100 }), 25, "no slabs: the flat fee");

  const panel = SRC("components/pos/OrderPanel.jsx");
  assert.match(panel, /deliveryFeeFor\(\{ ordering, distanceKm: delivery\?\.deliveryAddress\?\.distanceKm, subtotal \}\)/);
  assert.match(panel, /deliveryQuote === null \? "By distance"/);
  const modal = SRC("components/pos/DeliveryModal.jsx");
  assert.match(modal, /\.\.\.\(maxKm > 0 \? \{ distanceKm: Number\(km\) \} : \{\}\)/);
});
