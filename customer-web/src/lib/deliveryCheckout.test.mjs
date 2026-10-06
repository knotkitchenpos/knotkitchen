import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("checkout speaks Indian: Pincode and ₹, never Postcode or £", () => {
  for (const f of ["components/CartDrawer.jsx", "components/StoreShell.jsx"]) {
    assert.doesNotMatch(read(f), /Postcode|"£"/, f);
  }
});

test("the delivery pincode takes 6 digits only and blocks a bad one before the server does", () => {
  const drawer = read("components/CartDrawer.jsx");
  const input = drawer.slice(drawer.indexOf('placeholder="Pincode"') - 200, drawer.indexOf('placeholder="Pincode"') + 300);
  assert.match(input, /inputMode="numeric"/);
  assert.match(input, /maxLength=\{6\}/);
  assert.match(input, /postalCode: e\.target\.value\.replace\(\/\\D\/g, ""\)\.slice\(0, 6\)/);
  // Same rule as storefrontController: optional, but a typed PIN is 6 digits not starting 0.
  assert.match(drawer, /\/\^\[1-9\]\\d\{5\}\$\//);
  assert.match(drawer, /!pinBad &&/);
});

test("Knot Eats tracking shows the 'On the way' step the server sends for Out for delivery", () => {
  const server = fs.readFileSync(new URL("../../../pos-backend/controllers/knotEatsController.js", import.meta.url), "utf8");
  assert.match(server, /return "on_the_way"/);
  const page = read("eats/pages/OrderStatusPage.jsx");
  assert.match(page, /DELIVERY_STEPS = \["placed", "accepted", "ready", "on_the_way", "completed"\]/);
  assert.match(page, /step === "on_the_way"\) return "On the way"/);
  assert.match(page, /stage === "on_the_way"\)/);
  assert.match(page, /grid-cols-5/);
});
