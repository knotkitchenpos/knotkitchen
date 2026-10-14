// Till menu rules (QA roadmap 10). cd pos-frontend && node --test tests/tillMenuRules.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const src = fs.readFileSync(path.join(FE, "components/pos/ProductPanel.jsx"), "utf8");

test("N039: a Display OFF product with POS Visibility is on sale at the till, not greyed out", () => {
  // Every card and the tap handler decide "out of stock" the same way the list filters do.
  assert.ok(!/item\.isAvailable === false/.test(src), "a card or add() still greys out POS Visibility products");
  const start = src.indexOf("const offOnPos");
  assert.ok(start > 0, "offOnPos helper missing");
  const offOnPos = new Function(`${src.slice(start, src.indexOf("\n", start))}\nreturn offOnPos;`)();
  assert.equal(offOnPos({ isAvailable: false, visibleOnPosWhenOff: true }), false);
  assert.equal(offOnPos({ isAvailable: false }), true);
  assert.equal(offOnPos({ isAvailable: true }), false);
});

test("N037: the till lists a product only for order types its own Dispatch Type allows, Popular included", () => {
  const filters = src.match(/\.filter\(\s*\(i\) =>[^]*?\)\s*,?\s*\n/g) || [];
  const itemFilters = filters.filter((f) => /inSchedule\(i\.schedule\)/.test(f));
  assert.equal(itemFilters.length, 3, "category, all/search and Popular lists");
  for (const f of itemFilters) assert.match(f, /allowsOrderType\(i, orderType\)/);
  assert.match(src, /menus\.some\(\(m\) => String\(m\._id\) === String\(i\.categoryId\)\)/, "Popular ignores the category filters");
  // S10: the order panel refuses a line whose dish this order type does not sell.
  assert.equal((src.match(/orderTypes: orderTypesOf\(/g) || []).length, 2, "both add paths stamp the line");
});

test("N036: the till re-checks product schedules as the store clock moves", () => {
  assert.match(src, /setInterval\(\(\) => setClockTick\(\(n\) => n \+ 1\), 60_000\)/);
  assert.match(src, /\[menusRes, orderType, clockTick\]/, "category list");
  assert.match(src, /\[category, orderType, clockTick\]/, "products in the open category");
});

test("N038: a subcategory offers no Display Status the server never stores", () => {
  const drawer = fs.readFileSync(path.join(FE, "components/dashboard/manageMenu/CategoryDrawer.jsx"), "utf8");
  const subcatSave = drawer.slice(drawer.indexOf("updateSubcatMut.mutate({"), drawer.indexOf("addSubcatMut.mutate({"));
  assert.ok(!/published/.test(subcatSave), "the subcategory save sends a Display Status");
  assert.match(drawer, /\{!showCreateSubcategory && \(\s*<div className="flex items-center justify-between pt-2 border-t/);
});
