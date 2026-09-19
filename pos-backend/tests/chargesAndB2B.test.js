const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { isValidGstin, buyerFrom, RESTAURANT_SAC } = require("../services/gst");
const { shiftSummary } = require("../services/shifts");

test("GSTIN format: 15 characters, state + PAN + entity + Z + check", () => {
  assert.equal(isValidGstin("19ABCDE1234F1Z5"), true);
  assert.equal(isValidGstin("19abcde1234f1z5"), true, "case is normalised");
  assert.equal(isValidGstin("19ABCDE1234F1Y5"), false);
  assert.equal(isValidGstin("ABCDE1234F"), false, "a bare PAN is not a GSTIN");
  assert.equal(RESTAURANT_SAC, "996331");
});

test("buyerFrom: nothing given is null, a bad GSTIN is refused, a good one is kept upper-case", () => {
  assert.equal(buyerFrom({}), null);
  assert.deepEqual(buyerFrom({ company: "Acme Pvt Ltd", gstin: "19abcde1234f1z5" }), { company: "Acme Pvt Ltd", gstin: "19ABCDE1234F1Z5" });
  assert.throws(() => buyerFrom({ company: "Acme", gstin: "nope" }), /does not look right/);
  assert.deepEqual(buyerFrom({ company: "Cash & Carry" }), { company: "Cash & Carry", gstin: "" });
});

test("tips: counted in the drawer when paid in cash, never as sales", () => {
  const s = shiftSummary(
    [
      { orderStatus: "Completed", bills: { totalWithTax: 1000 }, paymentMethod: "cash", tips: 50 },
      { orderStatus: "Completed", bills: { totalWithTax: 500 }, paymentMethod: "upi", tips: 20 },
    ],
    100,
  );
  assert.equal(s.sales, 1500);
  assert.equal(s.tips, 70);
  assert.equal(s.cashTips, 50);
  assert.equal(s.expectedCash, 1150);
});

test("a table bill carries the service charge, GST rate, tip and buyer onto the settled orders", () => {
  const ctrl = fs.readFileSync(path.join(__dirname, "..", "controllers", "tableSessionController.js"), "utf8");
  assert.match(ctrl, /serviceChargePercent/);
  assert.match(ctrl, /serviceChargePercent: pct/);
  assert.match(ctrl, /serviceChargeWaived/, "a removed charge stays removed when the bill is re-struck");
  assert.match(ctrl, /const payableAmount = Math\.round\(\(billAmount \+ tip\) \* 100\) \/ 100/);
  assert.match(ctrl, /"bills\.totalWithTax": billAmount/, "the tip is not sales");
  assert.match(ctrl, /"customerDetails\.company": buyer\.company/);
  const orders = fs.readFileSync(path.join(__dirname, "..", "controllers", "orderController.js"), "utf8");
  assert.match(orders, /buyerFrom\(customerDetails \|\| \{\}\)/);
});

test("the service charge can be taken off a table bill before it is paid, and packing is a website charge", () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  assert.match(read("routes", "tableSessionRoute.js"), /"\/:id\/service-charge"\)\.post\(isVerifiedUser, setServiceCharge\)/);
  const ctrl = read("controllers", "tableSessionController.js");
  const handler = ctrl.slice(ctrl.indexOf("const setServiceCharge"), ctrl.indexOf("const findActiveSessionByTable"));
  assert.match(handler, /SETTLED_SESSION_STATUSES\.includes\(session\.status\)/, "a paid bill is not re-struck");
  assert.match(handler, /recalculateSessionBill\(session\)/);
  assert.match(read("services", "orderPricingService.js"), /environment === "website" \? Number\(ordering\.packagingFee\)/);
});
