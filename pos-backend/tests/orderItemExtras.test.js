const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { orderItemExtras, itemDisplayName } = require("../services/orderItemExtras");

/**
 * Extras are sub-products, not a tail on the product name.
 *
 * They used to be flattened into the name at the till -- "Tandoori Chicken
 * Sandwich (+ Jeera Rice, Coke)" -- and because that string is what gets
 * stored on the order, every surface downstream inherited it: the order
 * detail, the printed receipt and the e-bill all showed a name that truncated
 * before the extras, and no price for any of them.
 *
 * The hard part is not the markup. The same extras arrive under three field
 * names, and on a POS line TWO of them hold the same entries, so the obvious
 * "concatenate all three" prints every extra twice on a bill. That is what
 * these tests pin.
 */

const SRC = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const FE = (...p) => fs.readFileSync(path.join(__dirname, "..", "..", "pos-frontend", ...p), "utf8");

test("a till line lists each extra once, not twice", () => {
  // ProductPanel writes the SAME array to both fields.
  const chosen = [{ optionName: "Jeera Rice", price: 40, quantity: 1 }];
  const extras = orderItemExtras({
    name: "Tandoori Chicken Sandwich",
    modifiers: chosen,
    modifierSelections: chosen,
    addons: [],
  });

  assert.deepEqual(extras, [{ name: "Jeera Rice", price: 40, quantity: 1 }]);
});

test("a website line lists each extra once, across all three fields", () => {
  // orderPricingService writes `modifiers` as the union of add-ons, chosen
  // options and the variant, AND keeps the structured originals.
  const extras = orderItemExtras({
    name: "Make Your Own Sandwich",
    modifiers: [
      { name: "Thums Up 250 ml", price: 20 },
      { name: "Fanta Orange 250 ml", price: 20 },
      { name: "Large", price: 0 },
    ],
    addons: [
      { name: "Thums Up 250 ml", price: 20 },
      { name: "Fanta Orange 250 ml", price: 20 },
    ],
    modifierSelections: [],
    variant: { name: "Large", price: 0 },
  });

  assert.deepEqual(extras, [
    { name: "Thums Up 250 ml", price: 20, quantity: 1 },
    { name: "Fanta Orange 250 ml", price: 20, quantity: 1 },
  ]);
});

test("the variant is not an extra", () => {
  // It is part of what the dish IS, it is priced into the base, and it is
  // already printed beside the name -- so listing it again reads as a second
  // charge that does not exist.
  const extras = orderItemExtras({
    modifiers: [{ name: "Large", price: 0 }],
    variant: { name: "large" },
  });
  assert.deepEqual(extras, [], "matched case-insensitively");
});

test("a line with only the structured fields still yields its extras", () => {
  const extras = orderItemExtras({
    addons: [{ name: "Fanta Orange 250 ml", price: 20 }],
    modifierSelections: [{ optionName: "Extra cheese", price: 15 }],
  });
  assert.deepEqual(extras, [
    { name: "Fanta Orange 250 ml", price: 20, quantity: 1 },
    { name: "Extra cheese", price: 15, quantity: 1 },
  ]);
});

test("a nameless or absent extra is dropped rather than printed blank", () => {
  assert.deepEqual(orderItemExtras({ modifiers: [{ price: 20 }, { name: "   " }] }), []);
  assert.deepEqual(orderItemExtras({}), []);
  assert.deepEqual(orderItemExtras(), []);
});

test("quantity and price are normalised, so a row can always be priced", () => {
  const [extra] = orderItemExtras({ modifiers: [{ name: "Coke", price: "19.999", quantity: "2" }] });
  assert.equal(extra.price, 20);
  assert.equal(extra.quantity, 2);

  const [free] = orderItemExtras({ modifiers: [{ name: "No onions" }] });
  assert.equal(free.price, 0, "a free choice is still a row");
  assert.equal(free.quantity, 1);
});

// ---------------------------------------------------------------------------
// The surfaces
// ---------------------------------------------------------------------------

test("REGRESSION: the till no longer bakes the extras into the product name", () => {
  // This is where it started. The composed name is what reaches the database,
  // so fixing only the screens would have left every stored order carrying
  // "(+ Jeera Rice, Coke)" for good.
  const panel = FE("src", "components", "pos", "ProductPanel.jsx");
  const assignment = panel.slice(panel.indexOf("const displayName ="));
  assert.ok(
    !/\(\+ \$\{optionNamesStr\}/.test(assignment.slice(0, 400)),
    "the name must carry the product and its variant, and nothing else",
  );
});

test("every bill surface renders extras as rows, not as a joined tail", () => {
  const surfaces = [
    ["e-bill", SRC("controllers", "publicReceiptController.js"), /orderItemExtras\(/],
    ["printed receipt", FE("src", "utils", "receiptLayout.js"), /itemExtras\(/],
    ["invoice", FE("src", "components", "invoice", "Invoice.jsx"), /itemExtras\(/],
    ["order detail", FE("src", "pages", "Orders.jsx"), /itemExtras\(/],
  ];

  for (const [label, source, uses] of surfaces) {
    assert.match(source, uses, `${label} must read the extras through the shared helper`);
    assert.ok(
      !/\+ \$\{(mods|modifierLine)\}/.test(source),
      `${label} still prints a comma-joined tail`,
    );
  }
});

test("the two copies of the rule stay in step", () => {
  // One runs on the server for the e-bill, the other in the browser for the
  // cart, the receipt and the invoice. They cannot share a module across the
  // two builds, so the precedence they encode is asserted instead: if one
  // starts concatenating the fields, the bills disagree about what was
  // ordered.
  const be = SRC("services", "orderItemExtras.js");
  const fe = FE("src", "utils", "orderItems.js");
  const rule = /Array\.isArray\(item\.modifiers\) && item\.modifiers\.length/;

  assert.match(be, rule);
  assert.match(fe, rule);
  for (const source of [be, fe]) {
    assert.match(source, /item\.variant\?\.name/, "both must drop the variant");
    assert.match(source, /entry\?\.name \|\| entry\?\.optionName/, "both must read either field");
  }
});

// ---------------------------------------------------------------------------
// Orders taken before the names were stored
// ---------------------------------------------------------------------------

test("an older order's extras are recovered from the name they were baked into", () => {
  // The till sent `optionName`; the order controller read `name`. So every
  // POS order ever taken stored a price for each extra and an EMPTY name, and
  // the names survived only inside the composed product title. Those bills are
  // reachable by link for good.
  const item = {
    name: "Chicken Sandwich (+ Thums Up 250 ml, Sprite 250 ml)",
    modifiers: [{ name: "", price: 20 }, { name: "", price: 20 }],
  };

  assert.deepEqual(orderItemExtras(item), [
    { name: "Thums Up 250 ml", price: 20, quantity: 1 },
    { name: "Sprite 250 ml", price: 20, quantity: 1 },
  ]);
});

test("REGRESSION: a recovered extra keeps its price", () => {
  // An order read without .lean() hands over Mongoose subdocuments, whose
  // fields live behind getters rather than as own properties. Building the
  // fallback by spreading one copied its internals and not its price, so every
  // recovered extra printed as free on a bill whose total said otherwise.
  const subdoc = (o) =>
    Object.create({
      get name() { return o.name; },
      get price() { return o.price; },
    });

  const extras = orderItemExtras({
    name: "Sandwich (+ Coke, Fries)",
    modifiers: [subdoc({ name: "", price: 20 }), subdoc({ name: "", price: 30 })],
  });

  assert.deepEqual(extras, [
    { name: "Coke", price: 20, quantity: 1 },
    { name: "Fries", price: 30, quantity: 1 },
  ]);
});

test("the recovered tail comes off the name, so nothing is listed twice", () => {
  assert.equal(
    itemDisplayName({ name: "Chicken Sandwich (+ Thums Up 250 ml, Sprite 250 ml)" }),
    "Chicken Sandwich",
  );
  // A bracket that is not an extras tail is part of the dish's name.
  assert.equal(itemDisplayName({ name: "Sandwich (Large)" }), "Sandwich (Large)");
  assert.equal(itemDisplayName({ name: "  Plain  " }), "Plain");
  assert.equal(itemDisplayName({}), "");
});

test("REGRESSION: the order controller keeps the name the till actually sends", () => {
  // Reading only `name` is what emptied them. It also dropped the structured
  // detail wholesale, so a POS order could never say which group a choice came
  // from and a chosen variant left no trace at all.
  const ctrl = SRC("controllers", "orderController.js");
  const block = ctrl.slice(ctrl.indexOf("const sanitizeItem"), ctrl.indexOf("// Validate table capacity"));

  assert.match(block, /m\?\.name \|\| m\?\.optionName/, "the till sends optionName");
  assert.match(block, /modifierSelections:/, "the structured selections must survive");
  assert.match(block, /addons:/);
  assert.match(block, /variant:/);
});
