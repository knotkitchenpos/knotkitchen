const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { formatAddress } = require("../services/address");
const { buildReceipt } = require("../services/receiptService");
const Restaurant = require("../models/restaurantModel");

/**
 * The address on a bill.
 *
 * `Restaurant.address` is a Mongoose SUBDOCUMENT. Interpolating one into a
 * template does not produce "[object Object]" -- Mongoose documents carry
 * their own toString(), so the customer's bill read:
 *
 *     { line1: 'Demo Address', line2: '', city: 'Kolkata', state: 'West
 *       Bengal', postalCode: '700094', country: 'India' }
 *
 * Which is worse than [object Object], because it looks like a bug the
 * customer is meant to read rather than an obviously blank field.
 */

const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const FE = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", rel), "utf8");

/**
 * Source guards read the CODE, not the prose around it. The comment recording
 * why the "Main Street" default was removed names it, and a naive scan matched
 * its own documentation.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const withAddress = (address) => new Restaurant({ name: "Demo", storeName: "Demo", address });

const FULL = {
  line1: "Demo Address",
  line2: "",
  city: "Kolkata",
  state: "West Bengal",
  postalCode: "700094",
  country: "India",
};

test("REGRESSION: a Mongoose address subdocument renders as a line, not as an object", () => {
  const restaurant = withAddress(FULL);

  // Prove the hazard is real rather than assuming it.
  assert.match(
    String(restaurant.address),
    /line1:/,
    "if this stops holding, Mongoose changed and the comment above needs revisiting",
  );

  assert.equal(formatAddress(restaurant.address), "Demo Address, Kolkata, West Bengal, 700094");
});

test("the receipt carries a flat string, with no object syntax anywhere in it", () => {
  const receipt = buildReceipt({
    restaurant: withAddress(FULL),
    order: {
      orderStatus: "Completed",
      bills: { subtotal: 100, tax: 5, totalWithTax: 105 },
      items: [],
    },
  });

  assert.equal(typeof receipt.restaurant.address, "string");
  for (const leak of ["line1", "postalCode", "{", "}", "'"]) {
    assert.ok(
      !receipt.restaurant.address.includes(leak),
      `the address still leaks object syntax: ${leak}`,
    );
  }
});

test("an empty or missing address yields nothing to print, not a placeholder", () => {
  // It used to default to "Main Street" -- a fictional address, printed on
  // real customers' bills for any restaurant that had not filled the field in.
  assert.equal(formatAddress(withAddress({}).address), "");
  assert.equal(formatAddress(null), "");
  assert.equal(formatAddress(undefined), "");

  const receipt = buildReceipt({
    restaurant: withAddress({}),
    order: { orderStatus: "Completed", bills: {}, items: [] },
  });
  assert.equal(receipt.restaurant.address, "");
  assert.ok(
    !/Main Street/.test(stripComments(SRC("services/receiptService.js"))),
    "the placeholder is gone",
  );
});

test("blank fields are dropped rather than leaving double commas", () => {
  assert.equal(formatAddress({ line1: "A", line2: "", city: "B" }), "A, B");
  assert.equal(formatAddress({ line1: "  A  ", city: " B " }), "A, B", "values are trimmed");
  assert.equal(formatAddress({ line2: "only this" }), "only this");
});

test("country is left off by default and available on request", () => {
  // Every line of a domestic bill saying "India" is noise.
  assert.ok(!formatAddress(FULL).includes("India"));
  assert.match(formatAddress(FULL, { includeCountry: true }), /, India$/);
});

test("a string that has already been formatted passes through untouched", () => {
  // Callers reach this from three directions: a subdocument, a plain object,
  // and an address someone already flattened.
  assert.equal(formatAddress("12 High Street, Kolkata"), "12 High Street, Kolkata");
  assert.equal(formatAddress("  padded  "), "padded");
});

test("the public receipt page never interpolates a raw address object", () => {
  const { render } = require("../controllers/publicReceiptController");
  const receipt = buildReceipt({
    restaurant: withAddress(FULL),
    order: { orderStatus: "Completed", bills: { totalWithTax: 105 }, items: [] },
  });
  const html = render(receipt);

  assert.match(html, /Demo Address, Kolkata, West Bengal, 700094/);
  assert.ok(!html.includes("line1:"), "the bill must not show the stored object");
  assert.ok(!html.includes("[object Object]"));
});

test("SOURCE: nobody hand-rolls the address join any more", () => {
  // There were five copies -- two in CSD, three in the front end -- each
  // picking a different subset of the fields, so one restaurant's address
  // appeared three different ways depending on which screen printed it.
  const files = [
    "controllers/csdRestaurantController.js",
    "controllers/csdStoreController.js",
    "services/receiptService.js",
  ];
  for (const file of files) {
    assert.match(SRC(file), /formatAddress/, `${file} should use the shared formatter`);
  }

  for (const file of [
    "src/pages/Reports.jsx",
    "src/pages/Orders.jsx",
    "src/components/pos/OrderPanel.jsx",
  ]) {
    const src = FE(file);
    assert.match(src, /receiptAddress/, `${file} should use the shared formatter`);
    assert.ok(
      !/address\?\.postalCode,?\s*\n?\s*\]/.test(src),
      `${file} still builds its own address array`,
    );
  }
});

// ---------------------------------------------------------------------------
// The order number
// ---------------------------------------------------------------------------

test("REGRESSION: the e-bill quotes the number the POS shows", () => {
  // Every POS screen shows `order.orderNumber` -- a 6-digit id like #834180 --
  // but this chain never read it, so the bill quoted six hex characters of the
  // Mongo ObjectId instead. Two different identifiers for one order: nobody
  // could match a customer's bill back to anything on the Orders screen.
  const mongoose = require("mongoose");
  const _id = new mongoose.Types.ObjectId();

  const receipt = buildReceipt({
    order: { _id, orderNumber: "834180", orderStatus: "Completed", bills: {}, items: [] },
  });
  assert.equal(receipt.orderNumber, "834180");
});

test("with no order number, the fallback matches the POS fallback exactly", () => {
  // The screens render `o.orderNumber || o._id.slice(-6).toUpperCase()`.
  const mongoose = require("mongoose");
  const _id = new mongoose.Types.ObjectId();

  const receipt = buildReceipt({
    order: { _id, orderStatus: "Completed", bills: {}, items: [] },
  });
  assert.equal(receipt.orderNumber, _id.toString().slice(-6).toUpperCase());
});

test("a marketplace order is still quoted by OUR number, as the POS shows it", () => {
  const mongoose = require("mongoose");
  const receipt = buildReceipt({
    order: {
      _id: new mongoose.Types.ObjectId(),
      orderNumber: "834180",
      marketplaceOrderId: "SWIGGY-99",
      orderStatus: "Completed",
      bills: {},
      items: [],
    },
  });
  assert.equal(receipt.orderNumber, "834180", "the operator cannot look up a Swiggy id");
});

test("a table session is still quoted by its session code", () => {
  const receipt = buildReceipt({
    tableSession: { sessionCode: "GF1-0007", items: [], bills: {} },
  });
  assert.equal(receipt.orderNumber, "GF1-0007");
});

test("SOURCE: the receipt reads orderNumber before anything else on an order", () => {
  const chain = stripComments(SRC("services/receiptService.js"));
  const orderNum = chain.indexOf("order?.orderNumber");
  const marketplace = chain.indexOf("order?.marketplaceOrderId");
  assert.ok(orderNum !== -1, "the receipt must read the number the POS shows");
  assert.ok(orderNum < marketplace, "our own number comes first, as on the POS screens");
});
