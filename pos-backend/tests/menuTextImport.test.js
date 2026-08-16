/**
 * menuTextImport.test.js
 *
 * Covers the Structured Notepad Menu Import end to end:
 *   .txt -> parser -> validation -> structured object -> preview -> DB payload
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { parseMenuText, parsePrice } = require("../services/menuTextParser");
const { buildMenuPayload, buildPreviewTree } = require("../services/menuImportMapper");
const { MENU_TEMPLATE } = require("../services/menuTemplate");

/** Helper: assert the file parsed cleanly, surfacing errors if not. */
const expectValid = (result) => {
  assert.equal(
    result.success,
    true,
    `Expected valid menu but got errors: ${JSON.stringify(result.errors, null, 2)}`
  );
};

/** Helper: find an error mentioning a phrase. */
const errorMatching = (result, phrase) =>
  result.errors.find((e) => e.message.toLowerCase().includes(phrase.toLowerCase()));

// ============================================================
// CATEGORIES
// ============================================================

test("parses a single category with two items", () => {
  const result = parseMenuText(`
CATEGORY: Burgers

ITEM: Chicken Burger
PRICE: 249
END ITEM

ITEM: Beef Burger
PRICE: 299
END ITEM
`);

  expectValid(result);
  assert.equal(result.categories.length, 1);
  assert.equal(result.categories[0].name, "Burgers");
  assert.equal(result.categories[0].items.length, 2);
  assert.equal(result.categories[0].items[0].name, "Chicken Burger");
  assert.equal(result.categories[0].items[1].price, 299);
});

test("supports multiple categories and assigns items to the correct one", () => {
  const result = parseMenuText(`
CATEGORY: Burgers
ITEM: Chicken Burger
PRICE: 249
END ITEM

CATEGORY: Pizza
ITEM: Margherita
PRICE: 199
END ITEM
`);

  expectValid(result);
  assert.equal(result.categories.length, 2);
  assert.equal(result.categories[0].items[0].name, "Chicken Burger");
  assert.equal(result.categories[1].items[0].name, "Margherita");
  assert.equal(result.stats.categories, 2);
  assert.equal(result.stats.items, 2);
});

test("rejects a duplicate CATEGORY declaration", () => {
  const result = parseMenuText(`
CATEGORY: Burgers
ITEM: A
PRICE: 10
END ITEM

CATEGORY: Burgers
ITEM: B
PRICE: 20
END ITEM
`);

  assert.equal(result.success, false);
  const err = errorMatching(result, "Duplicate CATEGORY");
  assert.ok(err, "expected a duplicate category error");
  assert.equal(err.line, 7);
});

test("rejects a category with no items", () => {
  const result = parseMenuText(`CATEGORY: Empty`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "has no items"));
});

test("END CATEGORY closes the category", () => {
  const result = parseMenuText(`
CATEGORY: Burgers
ITEM: A
PRICE: 10
END ITEM
END CATEGORY
`);
  expectValid(result);
});

test("rejects END CATEGORY without a category", () => {
  const result = parseMenuText(`END CATEGORY`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "without a matching CATEGORY"));
});

// ============================================================
// ITEMS, DESCRIPTIONS, PRICES
// ============================================================

test("parses description and price", () => {
  const result = parseMenuText(`
CATEGORY: Burgers
ITEM: Chicken Burger
DESCRIPTION: Grilled chicken burger with lettuce and cheese
PRICE: 249
END ITEM
`);

  expectValid(result);
  const item = result.categories[0].items[0];
  assert.equal(item.description, "Grilled chicken burger with lettuce and cheese");
  assert.equal(item.price, 249);
});

test("a simple item needs only a name and price", () => {
  const result = parseMenuText(`
CATEGORY: Sides
ITEM: French Fries
PRICE: 149
END ITEM
`);
  expectValid(result);
  assert.equal(result.categories[0].items[0].description, "");
});

test("accepts decimal prices", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
PRICE: 249.50
END ITEM
`);
  expectValid(result);
  assert.equal(result.categories[0].items[0].price, 249.5);
});

test("rejects ITEM declared outside a CATEGORY", () => {
  const result = parseMenuText(`
ITEM: Orphan
PRICE: 100
END ITEM
`);

  assert.equal(result.success, false);
  const err = errorMatching(result, "not inside a CATEGORY");
  assert.ok(err);
  assert.equal(err.line, 2);
});

test("rejects an item with neither PRICE nor VARIANT", () => {
  const result = parseMenuText(`
CATEGORY: Burgers
ITEM: Chicken Burger
DESCRIPTION: Chicken burger
END ITEM
`);

  assert.equal(result.success, false);
  const err = errorMatching(result, "requires either a PRICE");
  assert.ok(err);
  assert.ok(err.message.includes("Chicken Burger"));
});

test("rejects a non-numeric price and reports the line", () => {
  const result = parseMenuText(`
CATEGORY: Burgers
ITEM: Chicken Burger
PRICE: abc
END ITEM
`);

  assert.equal(result.success, false);
  const err = errorMatching(result, "Invalid price");
  assert.ok(err);
  assert.equal(err.line, 4);
  assert.ok(err.message.includes("Expected a numeric value"));
});

test("rejects prices with currency symbols or commas", () => {
  for (const bad of ["Rs.249", "1,299", "$10", "249/-", "-50"]) {
    const result = parseMenuText(`CATEGORY: X\nITEM: Y\nPRICE: ${bad}\nEND ITEM`);
    assert.equal(result.success, false, `"${bad}" should be rejected`);
  }
});

test("rejects a duplicate PRICE on one item", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
PRICE: 100
PRICE: 200
END ITEM
`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "already has a PRICE"));
});

test("rejects PRICE outside an ITEM", () => {
  const result = parseMenuText(`CATEGORY: X\nPRICE: 100`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "PRICE must be inside an ITEM"));
});

test("rejects a duplicate item within a category", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Burger
PRICE: 100
END ITEM
ITEM: Burger
PRICE: 200
END ITEM
`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "Duplicate item"));
});

test("rejects END ITEM without an ITEM", () => {
  const result = parseMenuText(`CATEGORY: X\nEND ITEM`);
  assert.equal(result.success, false);
  const err = errorMatching(result, "without a matching ITEM");
  assert.ok(err);
  assert.equal(err.line, 2);
});

test("rejects an item that is never closed", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Unclosed
PRICE: 100
`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, 'missing "END ITEM"'));
});

// ============================================================
// VARIANTS
// ============================================================

test("creates ONE product with three variants, not three products", () => {
  const result = parseMenuText(`
CATEGORY: Pizza
ITEM: Margherita
VARIANT: Small | 199
VARIANT: Medium | 299
VARIANT: Large | 399
END ITEM
`);

  expectValid(result);
  assert.equal(result.categories[0].items.length, 1, "must remain a single product");
  const item = result.categories[0].items[0];
  assert.equal(item.variants.length, 3);
  assert.deepEqual(
    item.variants.map((v) => [v.name, v.price]),
    [["Small", 199], ["Medium", 299], ["Large", 399]]
  );
});

test("an item may have variants and no base price", () => {
  const result = parseMenuText(`
CATEGORY: Drinks
ITEM: Coke
VARIANT: 250ml | 40
VARIANT: 500ml | 70
VARIANT: 1L | 120
END ITEM
`);

  expectValid(result);
  assert.equal(result.categories[0].items[0].price, null);

  // The mapper uses the cheapest variant as the required base price.
  const payload = buildMenuPayload(result.categories);
  assert.equal(payload[0].items[0].price, 40);
  assert.equal(payload[0].items[0].variants.length, 3);
});

test("rejects VARIANT outside an ITEM", () => {
  const result = parseMenuText(`CATEGORY: X\nVARIANT: Small | 199`);
  assert.equal(result.success, false);
  const err = errorMatching(result, "VARIANT must be inside an ITEM");
  assert.ok(err);
  assert.equal(err.line, 2);
});

test("rejects a malformed VARIANT line", () => {
  const result = parseMenuText(`CATEGORY: X\nITEM: Y\nVARIANT: Small\nEND ITEM`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, 'VARIANT must be written as'));
});

test("rejects a non-numeric variant price", () => {
  const result = parseMenuText(`CATEGORY: X\nITEM: Y\nVARIANT: Small | free\nEND ITEM`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "Invalid variant price"));
});

test("rejects duplicate variants", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
VARIANT: Small | 100
VARIANT: Small | 150
END ITEM
`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "Duplicate variant"));
});

// ============================================================
// ADD-ON GROUPS
// ============================================================

test("parses an add-on group with priced add-ons", () => {
  const result = parseMenuText(`
CATEGORY: Burgers
ITEM: Chicken Burger
PRICE: 249
ADDON_GROUP: Extras
ADDON: Extra Cheese | 40
ADDON: Extra Patty | 100
ADDON: Jalapeno | 30
END ITEM
`);

  expectValid(result);
  const groups = result.categories[0].items[0].modifierGroups;
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Extras");
  assert.equal(groups[0].type, "addon");
  assert.equal(groups[0].options.length, 3);
  assert.equal(groups[0].options[0].price, 40);
});

test("keeps multiple add-on groups separate", () => {
  const result = parseMenuText(`
CATEGORY: Pizza
ITEM: Pizza
PRICE: 299
ADDON_GROUP: Extra Toppings
ADDON: Extra Cheese | 40
ADDON: Olives | 30
ADDON: Jalapeno | 20
ADDON_GROUP: Extra Meat
ADDON: Chicken | 70
ADDON: Pepperoni | 90
END ITEM
`);

  expectValid(result);
  const groups = result.categories[0].items[0].modifierGroups;
  assert.equal(groups.length, 2, "groups must not be merged");
  assert.equal(groups[0].name, "Extra Toppings");
  assert.equal(groups[0].options.length, 3);
  assert.equal(groups[1].name, "Extra Meat");
  assert.equal(groups[1].options.length, 2);
});

test("supports free add-ons priced at 0", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
PRICE: 100
ADDON_GROUP: Sauces
ADDON: Ketchup | 0
END ITEM
`);

  expectValid(result);
  assert.equal(result.categories[0].items[0].modifierGroups[0].options[0].price, 0);
});

test("an add-on with no price is free", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
PRICE: 100
ADDON_GROUP: Sauces
ADDON: Mustard
END ITEM
`);
  expectValid(result);
  assert.equal(result.categories[0].items[0].modifierGroups[0].options[0].price, 0);
});

test("rejects ADDON outside an ADDON_GROUP with the exact line", () => {
  const result = parseMenuText(`
CATEGORY: Burgers
ITEM: Chicken Burger
PRICE: 249
ADDON: Extra Cheese | 40
END ITEM
`);

  assert.equal(result.success, false);
  const err = errorMatching(result, "ADDON must be inside an ADDON_GROUP");
  assert.ok(err);
  assert.equal(err.line, 5);
  assert.equal(err.content, "ADDON: Extra Cheese | 40");
});

test("rejects an empty add-on group", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
PRICE: 100
ADDON_GROUP: Empty
END ITEM
`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "has no options"));
});

test("rejects an invalid add-on price", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
PRICE: 100
ADDON_GROUP: Extras
ADDON: Cheese | lots
END ITEM
`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "Invalid add-on price"));
});

// ============================================================
// CHOICE GROUPS
// ============================================================

test("parses a plain choice group", () => {
  const result = parseMenuText(`
CATEGORY: Meals
ITEM: Burger Meal
PRICE: 349
CHOICE_GROUP: Choose Drink
CHOICE: Coke
CHOICE: Pepsi
CHOICE: Sprite
END ITEM
`);

  expectValid(result);
  const group = result.categories[0].items[0].modifierGroups[0];
  assert.equal(group.name, "Choose Drink");
  assert.equal(group.type, "choice");
  assert.deepEqual(group.options.map((o) => o.name), ["Coke", "Pepsi", "Sprite"]);
});

test("parses REQUIRED choice group with min and max", () => {
  const result = parseMenuText(`
CATEGORY: Meals
ITEM: Burger Meal
PRICE: 349
CHOICE_GROUP: Choose Drink | REQUIRED | 1 | 1
CHOICE: Coke
CHOICE: Pepsi
END ITEM
`);

  expectValid(result);
  const group = result.categories[0].items[0].modifierGroups[0];
  assert.equal(group.required, true);
  assert.equal(group.minSelections, 1);
  assert.equal(group.maxSelections, 1);
});

test("parses OPTIONAL choice group with priced choices", () => {
  const result = parseMenuText(`
CATEGORY: Meals
ITEM: Burger Meal
PRICE: 349
CHOICE_GROUP: Extras | OPTIONAL | 0 | 3
CHOICE: Cheese | 40
CHOICE: Jalapeno | 20
CHOICE: Olives | 30
END ITEM
`);

  expectValid(result);
  const group = result.categories[0].items[0].modifierGroups[0];
  assert.equal(group.required, false);
  assert.equal(group.minSelections, 0);
  assert.equal(group.maxSelections, 3);
  assert.equal(group.options[0].price, 40);
});

test("rejects CHOICE outside a CHOICE_GROUP", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
PRICE: 100
CHOICE: Coke
END ITEM
`);
  assert.equal(result.success, false);
  const err = errorMatching(result, "CHOICE must be inside a CHOICE_GROUP");
  assert.ok(err);
  assert.equal(err.line, 5);
});

test("rejects an invalid REQUIRED/OPTIONAL flag", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
PRICE: 100
CHOICE_GROUP: Drink | MAYBE | 1 | 1
CHOICE: Coke
END ITEM
`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "must be REQUIRED or OPTIONAL"));
});

test("rejects a maximum smaller than the minimum", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
PRICE: 100
CHOICE_GROUP: Drink | OPTIONAL | 3 | 1
CHOICE: Coke
END ITEM
`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "cannot be smaller than the minimum"));
});

test("rejects a group demanding more selections than it offers", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
PRICE: 100
CHOICE_GROUP: Drink | REQUIRED | 3 | 5
CHOICE: Coke
CHOICE: Pepsi
END ITEM
`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "only has 2 choices"));
});

test("rejects a non-numeric min/max", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
PRICE: 100
CHOICE_GROUP: Drink | REQUIRED | one | 1
CHOICE: Coke
END ITEM
`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "minimum must be a whole number"));
});

// ============================================================
// COMBOS
// ============================================================

test("parses a combo with two required choice groups", () => {
  const result = parseMenuText(`
CATEGORY: Combos

COMBO: Chicken Burger Meal
PRICE: 349

CHOICE_GROUP: Choose Drink | REQUIRED | 1 | 1
CHOICE: Coke
CHOICE: Pepsi
CHOICE: Sprite

CHOICE_GROUP: Choose Side | REQUIRED | 1 | 1
CHOICE: Fries
CHOICE: Salad

END ITEM
`);

  expectValid(result);
  const item = result.categories[0].items[0];
  assert.equal(item.isCombo, true);
  assert.equal(item.modifierGroups.length, 2);

  // A combo must be structured, never one big description blob.
  const payload = buildMenuPayload(result.categories);
  const mapped = payload[0].items[0];
  assert.equal(mapped.isCombo, true);
  assert.deepEqual(mapped.comboItems, ["Coke", "Pepsi", "Sprite", "Fries", "Salad"]);
  assert.equal(mapped.modifierGroups.length, 2);
  assert.equal(mapped.modifierGroups[0].required, true);
});

test("a plain ITEM is not marked as a combo", () => {
  const result = parseMenuText(`CATEGORY: X\nITEM: Y\nPRICE: 10\nEND ITEM`);
  expectValid(result);
  assert.equal(result.categories[0].items[0].isCombo, false);
});

// ============================================================
// COMMENTS & BLANK LINES
// ============================================================

test("ignores comments and blank lines entirely", () => {
  const result = parseMenuText(`
# KNOT KITCHEN MENU
# Popular burgers

CATEGORY: Burgers


# This comment must not appear on the menu
ITEM: Chicken Burger
PRICE: 249

END ITEM
`);

  expectValid(result);
  assert.equal(result.categories.length, 1);
  assert.equal(result.categories[0].items.length, 1);

  const serialised = JSON.stringify(result.categories);
  assert.ok(!serialised.includes("must not appear"), "comments leaked into the menu");
  assert.ok(!serialised.includes("KNOT KITCHEN MENU"));
});

test("comment lines do not shift reported line numbers", () => {
  const result = parseMenuText(`# comment
# comment
CATEGORY: X
ITEM: Y
PRICE: oops
END ITEM`);

  assert.equal(result.success, false);
  const priceError = errorMatching(result, "Invalid price");
  assert.ok(priceError);
  assert.equal(priceError.line, 5, "line number must match the real file line");
  assert.equal(priceError.content, "PRICE: oops");
});


// ============================================================
// INVALID SYNTAX
// ============================================================

test("rejects an unknown command", () => {
  const result = parseMenuText(`CATEGORY: X\nITEM: Y\nPRICE: 10\nCOLOUR: red\nEND ITEM`);
  assert.equal(result.success, false);
  const err = errorMatching(result, "Unknown command");
  assert.ok(err);
  assert.equal(err.line, 4);
});

test("rejects a line with no colon", () => {
  const result = parseMenuText(`CATEGORY: X\nITEM: Y\nPRICE: 10\njust some text\nEND ITEM`);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "Unrecognised line"));
});

test("rejects a command with an empty value", () => {
  const result = parseMenuText(`CATEGORY: `);
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "requires a value"));
});

test("rejects an empty file", () => {
  const result = parseMenuText("");
  assert.equal(result.success, false);
  assert.ok(errorMatching(result, "empty"));
});

test("every error carries a line number and the offending text", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
PRICE: abc
ADDON: Cheese | 40
END ITEM
`);

  assert.equal(result.success, false);
  result.errors.forEach((e) => {
    assert.ok(typeof e.line === "number" && e.line > 0, "missing line number");
    assert.ok(typeof e.message === "string" && e.message.length > 0);
  });
});

test("errors are sorted by line number", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
PRICE: bad
VARIANT: oops
CHOICE: stray
END ITEM
`);

  assert.equal(result.success, false);
  const lines = result.errors.map((e) => e.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
});

// ============================================================
// FORMATTING TOLERANCE
// ============================================================

test("tolerates Windows line endings, BOM and stray whitespace", () => {
  const result = parseMenuText("\uFEFFCATEGORY:   Burgers  \r\n\r\n   ITEM:  Chicken Burger \r\nPRICE:  249 \r\nEND ITEM\r\n");
  expectValid(result);
  assert.equal(result.categories[0].name, "Burgers");
  assert.equal(result.categories[0].items[0].name, "Chicken Burger");
  assert.equal(result.categories[0].items[0].price, 249);
});

test("commands are case insensitive", () => {
  const result = parseMenuText(`category: Burgers\nitem: Fries\nprice: 99\nend item`);
  expectValid(result);
  assert.equal(result.categories[0].items[0].name, "Fries");
});

test("descriptions may contain colons", () => {
  const result = parseMenuText(`
CATEGORY: X
ITEM: Y
DESCRIPTION: Served with: fries, dip and salad
PRICE: 100
END ITEM
`);
  expectValid(result);
  assert.equal(result.categories[0].items[0].description, "Served with: fries, dip and salad");
});

// ============================================================
// PRICE PARSER UNIT TESTS
// ============================================================

test("parsePrice accepts valid numbers and rejects the rest", () => {
  assert.equal(parsePrice("249").value, 249);
  assert.equal(parsePrice("0").value, 0);
  assert.equal(parsePrice("249.50").value, 249.5);
  assert.equal(parsePrice(" 99 ").value, 99);

  for (const bad of ["abc", "", "-5", "1,299", "12.3.4", "Rs.5", "1e5"]) {
    assert.equal(parsePrice(bad).ok, false, `"${bad}" should be invalid`);
  }
});

// ============================================================
// MAPPING TO EXISTING MODELS
// ============================================================

test("maps the parsed tree onto the existing menu schema shape", () => {
  const result = parseMenuText(`
CATEGORY: Burgers
ITEM: Chicken Burger
DESCRIPTION: Tasty
PRICE: 249
ADDON_GROUP: Extras
ADDON: Extra Cheese | 40
END ITEM
`);

  expectValid(result);
  const payload = buildMenuPayload(result.categories);

  assert.equal(payload.length, 1);
  assert.equal(payload[0].name, "Burgers");

  const item = payload[0].items[0];
  assert.equal(item.name, "Chicken Burger");
  assert.equal(item.price, 249);
  assert.equal(item.category, "Burgers", "menuItemSchema requires the category string");
  assert.equal(item.description, "Tasty");
  assert.equal(item.isAvailable, true);

  const group = item.modifierGroups[0];
  assert.equal(group.name, "Extras");
  assert.equal(group.groupType, "addon");
  assert.equal(group.required, false);
  assert.equal(group.options[0].name, "Extra Cheese");
  assert.equal(group.options[0].price, 40);
  assert.equal(group.options[0].isAvailable, true);
});

test("the payload never contains employee-supplied database ids", () => {
  const result = parseMenuText(`CATEGORY: X\nITEM: Y\nPRICE: 10\nEND ITEM`);
  const payload = buildMenuPayload(result.categories);
  assert.equal(payload[0].items[0]._id, undefined);
  assert.equal(payload[0].items[0].line, undefined, "internal line numbers must not leak into the DB");
});

// ============================================================
// PREVIEW
// ============================================================

test("builds a readable preview tree", () => {
  const result = parseMenuText(`
CATEGORY: Burgers
ITEM: Chicken Burger
PRICE: 249
ADDON_GROUP: Extras
ADDON: Extra Cheese | 40
ADDON: Extra Patty | 100
END ITEM
ITEM: Beef Burger
PRICE: 299
END ITEM
`);

  expectValid(result);
  const tree = buildPreviewTree(result.categories);

  assert.ok(tree.includes("Burgers"));
  assert.ok(tree.includes("Chicken Burger"));
  assert.ok(tree.includes("Extra Cheese"));
  assert.ok(tree.includes("+\u20B940"), "add-on price should be shown");
  assert.ok(tree.includes("\u20B9249"));
  assert.ok(tree.includes("Beef Burger"));
});

test("preview marks combos and choice rules", () => {
  const result = parseMenuText(`
CATEGORY: Combos
COMBO: Meal
PRICE: 349
CHOICE_GROUP: Choose Drink | REQUIRED | 1 | 1
CHOICE: Coke
END ITEM
`);

  expectValid(result);
  const tree = buildPreviewTree(result.categories);
  assert.ok(tree.includes("[COMBO]"));
  assert.ok(tree.includes("Required"));
});

// ============================================================
// THE SHIPPED TEMPLATE
// ============================================================

test("the downloadable template parses without errors", () => {
  const result = parseMenuText(MENU_TEMPLATE);
  expectValid(result);

  assert.equal(result.stats.categories, 5);
  const names = result.categories.map((c) => c.name);
  assert.deepEqual(names, ["Burgers", "Pizza", "Combos", "Sides", "Drinks"]);

  // The template must demonstrate every headline feature.
  const all = result.categories.flatMap((c) => c.items);
  assert.ok(all.some((i) => i.variants.length > 0), "template should show variants");
  assert.ok(all.some((i) => i.isCombo), "template should show a combo");
  assert.ok(
    all.some((i) => i.modifierGroups.some((g) => g.type === "addon")),
    "template should show add-ons"
  );
  assert.ok(
    all.some((i) => i.modifierGroups.some((g) => g.type === "choice")),
    "template should show choices"
  );
  assert.ok(
    all.some((i) => i.modifierGroups.some((g) => g.options.some((o) => o.price === 0))),
    "template should show a free option"
  );
});

test("the template maps cleanly onto the database payload", () => {
  const result = parseMenuText(MENU_TEMPLATE);
  const payload = buildMenuPayload(result.categories);

  payload.forEach((category) => {
    assert.ok(category.name);
    category.items.forEach((item) => {
      assert.ok(item.name, "every item needs a name");
      assert.equal(typeof item.price, "number", "menuItemSchema requires a numeric price");
      assert.ok(Number.isFinite(item.price));
      assert.equal(item.category, category.name);
    });
  });
});

// ============================================================
// LARGE MENUS
// ============================================================

test("handles a large multi-category menu", () => {
  const lines = [];
  for (let c = 1; c <= 20; c++) {
    lines.push(`CATEGORY: Category ${c}`);
    for (let i = 1; i <= 25; i++) {
      lines.push(`ITEM: Item ${c}-${i}`);
      lines.push(`DESCRIPTION: Description for item ${i}`);
      lines.push(`PRICE: ${100 + i}`);
      lines.push("ADDON_GROUP: Extras");
      lines.push("ADDON: Extra Cheese | 40");
      lines.push("END ITEM");
    }
  }

  const result = parseMenuText(lines.join("\n"));
  expectValid(result);
  assert.equal(result.stats.categories, 20);
  assert.equal(result.stats.items, 500);
  assert.equal(result.stats.modifierGroups, 500);

  const payload = buildMenuPayload(result.categories);
  assert.equal(payload.length, 20);
  assert.equal(payload.reduce((n, c) => n + c.items.length, 0), 500);
});

// ============================================================
// FULL FLOW
// ============================================================

test("full flow: text -> parse -> validate -> structure -> preview -> payload", () => {
  const file = `
# Restaurant menu
CATEGORY: Burgers

ITEM: Chicken Burger
DESCRIPTION: Grilled chicken burger
PRICE: 249
ADDON_GROUP: Extras
ADDON: Extra Cheese | 40
ADDON: Ketchup | 0
END ITEM

CATEGORY: Pizza

ITEM: Margherita
VARIANT: Small | 199
VARIANT: Large | 399
END ITEM

CATEGORY: Combos

COMBO: Burger Meal
PRICE: 349
CHOICE_GROUP: Choose Drink | REQUIRED | 1 | 1
CHOICE: Coke
CHOICE: Pepsi
CHOICE_GROUP: Extras | OPTIONAL | 0 | 2
CHOICE: Cheese | 40
END ITEM
`;

  // 1. Parse + validate
  const parsed = parseMenuText(file);
  expectValid(parsed);
  assert.equal(parsed.stats.categories, 3);
  assert.equal(parsed.stats.items, 3);

  // 2. Preview
  const tree = buildPreviewTree(parsed.categories);
  assert.ok(tree.length > 0);

  // 3. Database payload for the existing Menu model
  const payload = buildMenuPayload(parsed.categories);
  assert.equal(payload.length, 3);

  const burger = payload[0].items[0];
  assert.equal(burger.price, 249);
  assert.equal(burger.modifierGroups[0].options.length, 2);

  const pizza = payload[1].items[0];
  assert.equal(pizza.variants.length, 2);
  assert.equal(pizza.price, 199, "base price comes from the cheapest variant");

  const combo = payload[2].items[0];
  assert.equal(combo.isCombo, true);
  assert.equal(combo.modifierGroups.length, 2);
  assert.equal(combo.modifierGroups[0].required, true);
  assert.equal(combo.modifierGroups[1].required, false);
  assert.equal(combo.modifierGroups[1].maxSelections, 2);
});

test("a file with any error yields no importable payload", () => {
  const parsed = parseMenuText(`
CATEGORY: Burgers
ITEM: Good Item
PRICE: 100
END ITEM
ITEM: Bad Item
DESCRIPTION: no price at all
END ITEM
`);

  // Even though one item is fine, the file as a whole is invalid and the
  // controller must refuse to import any of it.
  assert.equal(parsed.success, false);
  assert.ok(errorMatching(parsed, "requires either a PRICE"));
});
