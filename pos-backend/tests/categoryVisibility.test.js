/**
 * Category visibility: Display Status + POS Visibility + Website Visibility.
 *
 * The matrix the operator was promised:
 *
 *   Display  POS  Website  |  POS       Website
 *   -------------------------------------------
 *   ON       -    -        |  visible   visible
 *   OFF      OFF  OFF      |  hidden    hidden
 *   OFF      ON   OFF      |  visible   hidden
 *   OFF      OFF  ON       |  hidden    visible
 *
 * None of it worked, for three separate reasons, and the three failure modes
 * combined into one confusing symptom -- "the category is there but it is
 * empty, and on the website everything says Sold Out":
 *
 *   1. isVisibleOnPos existed but NOTHING called it. The tills showed every
 *      category regardless of any of these settings.
 *   2. Hiding a category was implemented by setting `isAvailable = false` on
 *      every product inside it. That is a different field with a different
 *      meaning (in stock / out of stock), it cannot express a per-surface
 *      rule, and it destroyed the operator's real stock state.
 *   3. Publishing to the website forced `published` back to true, so every
 *      attempt to hide a category was undone by the next Publish Web -- while
 *      the products it had switched off stayed off.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  isVisibleOnPos,
  isVisibleOnWebsite,
  POS_VISIBLE_QUERY,
  WEBSITE_VISIBLE_QUERY,
} = require("../services/menuCache");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const MENU_CTRL = read("controllers", "menuController.js");
const STOREFRONT_CTRL = read("controllers", "storefrontController.js");
const QR_ROUTE = read("routes", "qrRoute.js");

// ---------------------------------------------------------------------------
// The matrix itself
// ---------------------------------------------------------------------------

const CASES = [
  { name: "Display ON", menu: { published: true }, pos: true, web: true },
  {
    name: "Category 1 — everything off",
    menu: { published: false, showOnPos: false, showOnWebsite: false },
    pos: false,
    web: false,
  },
  {
    name: "Category 2 — POS only",
    menu: { published: false, showOnPos: true, showOnWebsite: false },
    pos: true,
    web: false,
  },
  {
    name: "Category 3 — website only",
    menu: { published: false, showOnPos: false, showOnWebsite: true },
    pos: false,
    web: true,
  },
];

for (const c of CASES) {
  test(`${c.name}: POS ${c.pos ? "visible" : "hidden"}, website ${c.web ? "visible" : "hidden"}`, () => {
    assert.equal(isVisibleOnPos(c.menu), c.pos);
    assert.equal(isVisibleOnWebsite(c.menu), c.web);
  });
}

test("Display ON overrides both per-surface flags being off", () => {
  // The UI only offers the two overrides while Display Status is OFF, and
  // zeroes them when it is ON. The rule must agree, or a category the
  // operator can see as "Display ON" would vanish.
  const menu = { published: true, showOnPos: false, showOnWebsite: false };
  assert.equal(isVisibleOnPos(menu), true);
  assert.equal(isVisibleOnWebsite(menu), true);
});

test("a category that predates the per-surface flags behaves as it always did", () => {
  assert.equal(isVisibleOnPos({ published: false }), false);
  assert.equal(isVisibleOnWebsite({ published: false }), false);
  assert.equal(isVisibleOnPos({}), true, "no Display Status at all means visible");
});

// ---------------------------------------------------------------------------
// 1. The rule is actually applied
// ---------------------------------------------------------------------------

test("REGRESSION: the POS menu endpoint filters categories by POS visibility", () => {
  // isVisibleOnPos was exported and never imported by anything. Hiding a
  // category from the tills did nothing at all.
  assert.match(MENU_CTRL, /isVisibleOnPos/, "menuController must import the rule");
  assert.match(
    MENU_CTRL,
    /projected\.filter\(\(m\) => isVisibleOnPos\(m\)\)/,
    "and apply it to the PUBLISHED copy, on the system audience",
  );
});

test("Manage Menu (draft) still shows every category", () => {
  // You cannot edit a category you cannot see. The filter must be conditional
  // on the system source, never unconditional.
  const block = MENU_CTRL.slice(
    MENU_CTRL.indexOf("const getMenus"),
    MENU_CTRL.indexOf("PUT /api/menu/reorder-categories"),
  );
  assert.match(block, /isSystemSource\s*\n?\s*\?\s*projected\.filter/, "draft must bypass the filter");
});

test("the table QR reads the same POS rule, not its own copy", () => {
  assert.match(QR_ROUTE, /projectMenus\(docs, AUDIENCES\.SYSTEM\)/, "visibility comes from the published copy");
  assert.ok(!/POS_VISIBLE_QUERY/.test(QR_ROUTE), "no live-flag filtering in the query");
  assert.ok(
    !/\$or: \[\{ published: true \}, \{ isPublished: true \}, \{ showOnPos: true \}\]/.test(QR_ROUTE),
    "the hand-written clause that disagreed with the shared rule is gone",
  );
});

// ---------------------------------------------------------------------------
// 2. Display Status must not rewrite the products
// ---------------------------------------------------------------------------

test("REGRESSION: hiding a category does not switch off every product in it", () => {
  // `item.isAvailable` means "this dish is in stock". Writing the category's
  // Display Status into it destroyed that state -- hide a category and show it
  // again, and everything deliberately marked out of stock came back on -- and
  // it could not express "POS only" at all, because a product switched off is
  // off on both surfaces.
  const block = MENU_CTRL.slice(
    MENU_CTRL.indexOf("const updateCategory"),
    MENU_CTRL.indexOf("const addSubcategory"),
  );
  assert.ok(block.length > 0);
  assert.ok(
    !/item\.isAvailable = Boolean\(published\)/.test(block),
    "the cascade onto item.isAvailable must not come back",
  );
  assert.ok(
    !/item\.isAvailable\s*=/.test(block),
    "updateCategory must not write item availability at all",
  );
});

test("the Dispatch Type cascade is deliberately kept", () => {
  // Unlike Display Status, dispatch type has no per-product per-surface
  // meaning to destroy, and the cascade is what makes "this category is
  // delivery-only" mean anything.
  const block = MENU_CTRL.slice(
    MENU_CTRL.indexOf("const updateCategory"),
    MENU_CTRL.indexOf("const addSubcategory"),
  );
  assert.match(block, /item\.dispatchType = \{/);
});

// ---------------------------------------------------------------------------
// 3. Publishing is not an opinion about visibility
// ---------------------------------------------------------------------------

test("REGRESSION: publishing does not switch Display Status back on", () => {
  const block = MENU_CTRL.slice(
    MENU_CTRL.indexOf("const publishAllMenusForUser"),
    MENU_CTRL.indexOf("const publishToTarget"),
  );
  assert.ok(block.length > 0);
  assert.ok(
    !/menu\.published = true/.test(block),
    "publish must not re-enable a category the operator switched off",
  );
  // It must still do the thing it is for: one button, both snapshots.
  assert.match(block, /menu\.systemSnapshot = snapshot/);
  assert.match(block, /menu\.websiteSnapshot = JSON\.parse\(JSON\.stringify\(snapshot\)\)/);
});

test("publishing copies the draft verbatim — it does not filter products", () => {
  const block = MENU_CTRL.slice(
    MENU_CTRL.indexOf("const publishAllMenusForUser"),
    MENU_CTRL.indexOf("const publishToTarget"),
  );
  // snapshotOf copies the draft (dishes and category settings) detached, unfiltered.
  assert.match(block, /const snapshot = snapshotOf\(menu\)/);
  const cache = fs.readFileSync(path.join(__dirname, "..", "services", "menuCache.js"), "utf8");
  assert.match(cache, /snap\[key\] = JSON\.parse\(JSON\.stringify\(plain\[key\]\)\)/);
});

// ---------------------------------------------------------------------------
// 4. Browse and checkout must agree
// ---------------------------------------------------------------------------

test("REGRESSION: the storefront prices from the same categories it displays", () => {
  // The checkout query was missing `showOnWebsite`, so a website-only category
  // was shown to the customer and then refused when they tried to order from
  // it: visible, addable, unpriceable.
  // Both go through projectMenus(…, AUDIENCES.WEBSITE), whose visibility is
  // the PUBLISHED flags; neither filters the live doc in the query.
  const uses = STOREFRONT_CTRL.match(/AUDIENCES\.WEBSITE/g) || [];
  assert.ok(uses.length >= 2, "both the browse and the checkout path project for the website");
  assert.ok(!/WEBSITE_VISIBLE_QUERY/.test(STOREFRONT_CTRL), "no live-flag filtering in the storefront queries");
  assert.ok(
    !/\$or: \[\{ published: true \}, \{ published: \{ \$exists: false \}, isPublished: true \}\]/.test(
      STOREFRONT_CTRL,
    ),
    "the checkout clause that omitted showOnWebsite is gone",
  );
});

test("the shared Mongo clauses match the in-memory rules", () => {
  // A find() and a filter() that disagree is how a category ends up visible on
  // one screen and missing on the next.
  const matches = (clause, menu) =>
    clause.$or.some((c) => {
      if (c.published && typeof c.published === "object" && "$ne" in c.published) {
        return menu.published !== c.published.$ne;
      }
      if ("showOnPos" in c) return menu.showOnPos === c.showOnPos;
      if ("showOnWebsite" in c) return menu.showOnWebsite === c.showOnWebsite;
      return false;
    });

  for (const c of CASES) {
    assert.equal(matches(POS_VISIBLE_QUERY, c.menu), c.pos, `${c.name}: POS query`);
    assert.equal(matches(WEBSITE_VISIBLE_QUERY, c.menu), c.web, `${c.name}: website query`);
  }
});

// ---------------------------------------------------------------------------
// 5. An empty category is not shown to the till
// ---------------------------------------------------------------------------

test("a category with nothing published to the tills is not listed on the POS", () => {
  // "The category is visible, all products are hidden" is never a useful
  // screen. With the snapshot as the only source, an unpublished category has
  // no items -- so it should not appear at all.
  const block = MENU_CTRL.slice(
    MENU_CTRL.indexOf("const getMenus"),
    MENU_CTRL.indexOf("PUT /api/menu/reorder-categories"),
  );
  assert.match(block, /isSystemSource\s*\n?\s*\? projected\.filter\(\(m\) => isVisibleOnPos\(m\)\)\.filter\(\(m\) => Array\.isArray\(m\.items\) && m\.items\.length > 0\)/);
});
