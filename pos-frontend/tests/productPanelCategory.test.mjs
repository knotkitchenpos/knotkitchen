import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(
  path.join(__dirname, "..", "src", "components", "pos", "ProductPanel.jsx"),
  "utf8",
);

/**
 * Guards the crash that took the whole POS down with
 *
 *   TypeError: Cannot read properties of null (reading 'name')
 *
 * `catId` and `subcat` were both useState. `category` was derived from `catId`,
 * but `subcat` was reset by an effect keyed on `catId` -- and effects run AFTER
 * the render that changed it. So for exactly one render the two disagreed:
 * no category, but still a subcategory. The heading then did
 *
 *   subcat ? `${category.name} - ${subcat}` : ...
 *
 * and read `.name` off null. Because it happened during render, React unmounted
 * the tree and the error screen replaced the POS -- not a broken heading, a
 * dead till.
 *
 * Two ways in, both one click:
 *   - clicking the already-active category chip (it toggles the category off)
 *   - the "All Categories" breadcrumb
 * either one, while a subcategory was open.
 */

/** The component's own derivation, kept in step with the source by the guards below. */
const render = ({ catId, selectedSubcat, menus }) => {
  const category = (catId ? menus.find((m) => m._id === catId) : null) || null;
  const items = category?.items || [];
  const subcats = [...new Set(items.map((i) => (i.subcategory || "").trim()).filter(Boolean))];
  const hasSubcats = subcats.length > 0;
  const subcat = subcats.includes(selectedSubcat) ? selectedSubcat : null;

  // The exact expression that used to throw.
  const heading = hasSubcats && !subcat
    ? `${category?.name} - Subcategories`
    : subcat
    ? `${category?.name} - ${subcat}`
    : category?.name || "";

  return { category, subcat, heading };
};

const MENUS = [
  { _id: "c1", name: "Drinks", items: [{ name: "Latte", subcategory: "Hot" }] },
  { _id: "c2", name: "Food", items: [{ name: "Fries" }] },
];

test("REGRESSION: clearing the category while a subcategory is open does not read .name off null", () => {
  // The render immediately after setCatId(null) -- `selectedSubcat` is still set
  // because nothing has reset it yet. This threw.
  const r = render({ catId: null, selectedSubcat: "Hot", menus: MENUS });

  assert.equal(r.category, null);
  assert.equal(r.subcat, null, "a subcategory must not outlive its category");
  assert.equal(r.heading, "", "no category means no heading, not a crash");
});

test("a category deleted elsewhere resolves to null, not undefined", () => {
  // The CSD tab deletes a category; this tab refetches on window focus and the
  // id it is holding no longer matches. `find` returns undefined, which used to
  // read as a second, separate 'nothing' and crash identically.
  const r = render({ catId: "gone", selectedSubcat: "Hot", menus: MENUS });
  assert.strictEqual(r.category, null);
  assert.equal(r.heading, "");
});

test("switching categories drops a subcategory the new category does not have", () => {
  const r = render({ catId: "c2", selectedSubcat: "Hot", menus: MENUS });
  assert.equal(r.subcat, null, "'Hot' belongs to Drinks, not Food");
  assert.equal(r.heading, "Food");
});

test("a valid category + subcategory pair still renders normally", () => {
  const r = render({ catId: "c1", selectedSubcat: "Hot", menus: MENUS });
  assert.equal(r.subcat, "Hot");
  assert.equal(r.heading, "Drinks - Hot");
});

test("a category with subcategories, none chosen, offers the subcategory picker", () => {
  const r = render({ catId: "c1", selectedSubcat: null, menus: MENUS });
  assert.equal(r.heading, "Drinks - Subcategories");
});

test("SOURCE: ProductPanel never reads category.name in JSX without optional chaining", () => {
  const hits = SRC.match(/\$?\{category\.name\}/g) || [];
  assert.deepEqual(hits, [], `use category?.name -- found ${hits.join(", ")}`);
});

test("SOURCE: subcat is derived from subcats, not reset by an effect", () => {
  assert.match(
    SRC,
    /const subcat = subcats\.includes\(selectedSubcat\) \? selectedSubcat : null;/,
    "the derivation is what makes the bad state unrepresentable",
  );
  assert.doesNotMatch(
    SRC,
    /useEffect\(\(\) => \{\s*setSubcat\(null\);\s*\}, \[catId\]\)/,
    "resetting subcat from an effect runs one render too late -- that was the bug",
  );
});

test("SOURCE: nothing renders the raw subcat state directly", () => {
  // Reading `selectedSubcat` in JSX would reintroduce the disagreement the
  // derived `subcat` exists to prevent.
  const body = SRC.slice(SRC.indexOf("return ("));
  assert.ok(!body.includes("selectedSubcat"), "render from `subcat`, not `selectedSubcat`");
});

test("REGRESSION: no blur on product cards, it blanked the grid while scrolling on the tablet", () => {
  assert.ok(!/blur-|FitImage/.test(SRC), "a blurred backdrop per card is too heavy for the tablet's WebView");
  assert.match(SRC, /className="w-full h-full object-contain"/, "whole photo, never cropped");
});
