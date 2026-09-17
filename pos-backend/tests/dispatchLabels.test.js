/**
 * Telling the customer WHICH order types a category is sold through.
 *
 * The dispatch restriction itself worked, but it was invisible while browsing.
 * The first a customer heard of it was at the payment step:
 *
 *     "One or more items are no longer available."
 *
 * — which named neither the item nor the reason, and reads like the dish had
 * sold out rather than "this one is collection only". The category was simply
 * dropped from the priced menu, so its items were missing from the index and
 * fell through to the generic not-found message.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { dispatchLabel, allowsOrderType, ORDER_TYPES } = require("../services/menuCache");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const STOREFRONT_CTRL = read("controllers", "storefrontController.js");

// ---------------------------------------------------------------------------
// The wording
// ---------------------------------------------------------------------------

test("a single allowed order type reads as '<X> Only'", () => {
  assert.equal(dispatchLabel({ collection: true, delivery: false, table: false }), "Collection Only");
  assert.equal(dispatchLabel({ collection: false, delivery: true, table: false }), "Delivery Only");
  assert.equal(dispatchLabel({ collection: false, delivery: false, table: true }), "Table Orders Only");
});

test("two allowed order types are listed", () => {
  assert.equal(
    dispatchLabel({ collection: true, delivery: true, table: false }),
    "Collection & Delivery Only",
  );
  assert.equal(
    dispatchLabel({ collection: true, delivery: false, table: true }),
    "Collection & Table Orders Only",
  );
});

test("an unrestricted category has nothing to say", () => {
  // No label at all, rather than a noisy "Collection, Delivery & Table Orders
  // Only" on every category in the shop.
  assert.equal(dispatchLabel({ collection: true, delivery: true, table: true }), null);
  assert.equal(dispatchLabel(null), null);
  assert.equal(dispatchLabel(undefined), null);
});

test("all three off is not a restriction — it agrees with allowsOrderType", () => {
  // allowsOrderType deliberately treats "nothing enabled" as unrestricted
  // rather than silently hiding the category everywhere. The label must not
  // claim a restriction the enforcement does not apply.
  const dt = { collection: false, delivery: false, table: false };
  assert.equal(dispatchLabel(dt), null);
  for (const t of Object.values(ORDER_TYPES)) {
    assert.equal(allowsOrderType({ dispatchType: dt }, t), true);
  }
});

test("the label never contradicts the enforcement", () => {
  // For every combination, a type named in the label must be allowed and a
  // type left out must be refused. A label that disagrees with the check is
  // worse than no label.
  const KEYS = ["collection", "delivery", "table"];
  const NAMES = { collection: "Collection", delivery: "Delivery", table: "Table Orders" };

  for (let mask = 0; mask < 8; mask += 1) {
    const dt = {
      collection: Boolean(mask & 1),
      delivery: Boolean(mask & 2),
      table: Boolean(mask & 4),
    };
    const label = dispatchLabel(dt);
    if (!label) continue; // unrestricted, nothing to check
    for (const k of KEYS) {
      const named = label.includes(NAMES[k]);
      assert.equal(
        allowsOrderType({ dispatchType: dt }, ORDER_TYPES[k.toUpperCase()]),
        named,
        `${JSON.stringify(dt)} -> "${label}": ${k} named=${named}`,
      );
    }
  }
});

test("Mongoose subdocuments are handled, like allowsOrderType does", () => {
  const dt = {
    collection: true,
    delivery: false,
    table: false,
    toObject: () => ({ collection: true, delivery: false, table: false }),
  };
  assert.equal(dispatchLabel(dt), "Collection Only");
});

// ---------------------------------------------------------------------------
// The customer can see it before they get to the till
// ---------------------------------------------------------------------------

test("REGRESSION: every product carries the restriction that applies to it", () => {
  // The category's dispatch type is what the order-time check enforces, so
  // that is what travels with the product -- the card, the product sheet and
  // the basket all need it, and only the category has it.
  const block = STOREFRONT_CTRL.slice(
    STOREFRONT_CTRL.indexOf("const toPublicProduct"),
    STOREFRONT_CTRL.indexOf("const toPublicCategoryless") > -1
      ? STOREFRONT_CTRL.indexOf("const toPublicCategoryless")
      : STOREFRONT_CTRL.indexOf("modifierGroups:"),
  );
  assert.match(block, /dispatchType: menu\.dispatchType/);
});

test("the category still carries it too, for the heading label", () => {
  assert.match(STOREFRONT_CTRL, /dispatchType: menu\.dispatchType/);
  const uses = STOREFRONT_CTRL.match(/dispatchType: menu\.dispatchType/g) || [];
  assert.equal(uses.length, 2, "once on the product, once on the category");
});

// ---------------------------------------------------------------------------
// ...and if they still reach checkout, it says which item and why
// ---------------------------------------------------------------------------

test("REGRESSION: checkout names the item and the restriction", () => {
  const block = STOREFRONT_CTRL.slice(
    STOREFRONT_CTRL.indexOf("Dispatch Type is authoritative here"),
    STOREFRONT_CTRL.indexOf("let priced;"),
  );
  assert.ok(block.length > 0, "the dispatch block must still be findable");
  assert.match(block, /dispatchLabel\(menu\.dispatchType\)/, "the reason must be named");
  assert.match(block, /item\?\.name \|\| menu\.name/, "and the item, not a generic plural");
  assert.match(block, /change your order type/i, "and say what to do about it");
});

test("a restricted category is still excluded from pricing", () => {
  // The friendlier message must not weaken the rule: a line from a category
  // that does not allow the chosen order type can never be billed.
  const block = STOREFRONT_CTRL.slice(
    STOREFRONT_CTRL.indexOf("Dispatch Type is authoritative here"),
    STOREFRONT_CTRL.indexOf("let priced;"),
  );
  assert.match(
    block,
    /const menus = projectedMenus\.filter\(\(m\) => allowsOrderType\(m, dispatchKey\)\)/,
    "the filter that keeps blocked categories out of pricing must remain",
  );
});

test("the storefront payload carries the label, and the site has no copy of the rule", () => {
  // customer-web used to re-implement dispatchLabel because the apps cannot
  // import from each other. The label now travels in the payload, on every
  // category and product, so the words the customer reads while browsing
  // and the refusal at checkout come from one function.
  assert.equal((STOREFRONT_CTRL.match(/dispatchLabel: dispatchLabel\(menu\.dispatchType\)/g) || []).length, 2, "category and product");
  const siteDir = path.join(__dirname, "..", "..", "customer-web", "src");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const file of walk(siteDir)) {
    if (!/\.(jsx?|mjs)$/.test(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    assert.ok(!/"Table Orders"|Only`/.test(src), `${path.relative(siteDir, file)} re-implements the label`);
  }
});
