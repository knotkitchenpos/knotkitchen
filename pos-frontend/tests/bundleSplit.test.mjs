// D13: the POS bundle is split into lazy pages, so a diner opening the table QR
// downloads the QR page, not the whole till.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("every page is lazy-loaded from one PAGE_LOADERS map, inside Suspense", () => {
  const app = SRC("src/App.jsx");
  assert.doesNotMatch(app, /from "\.\/pages"/, "the barrel pulled every page into the first download");
  assert.doesNotMatch(app, /^import \w+ from "\.\/pages\//m, "a static page import defeats the split");
  const pages = fs.readdirSync(new URL("../src/pages/", import.meta.url)).filter((f) => f.endsWith(".jsx"));
  assert.ok(pages.length >= 13);
  for (const f of pages) {
    assert.match(app, new RegExp(`${f.replace(".jsx", "")}: \\(\\) => import\\("\\./pages/${f.replace(".", "\\.")}"\\),`), `${f} has no loader`);
  }
  assert.match(app, /Object\.entries\(PAGE_LOADERS\)\.map\(\(\[name, load\]\) => \[name, lazy\(load\)\]\)/);
  assert.match(app, /<Suspense fallback=\{<FullScreenLoader \/>\}>\s*<Routes>/);
});

test("staff devices warm every page once; guest pages never load the POS", () => {
  const app = SRC("src/App.jsx");
  const warm = app.slice(app.indexOf("useEffect(() => {\n    if (!isAuth || bare)"), app.indexOf("}, [isAuth, bare]);"));
  assert.ok(warm.length > 0, "warm-up effect missing");
  assert.match(warm, /if \(!isAuth \|\| bare\) return undefined;/);
  assert.match(warm, /setTimeout\(\(\) => Object\.values\(PAGE_LOADERS\)\.forEach\(\(load\) => load\(\)\.catch\(\(\) => \{\}\)\), 3000\)/);
  assert.match(warm, /clearTimeout\(timer\)/);
  // A hook after the early loader return would break the rules of hooks.
  assert.ok(app.indexOf("}, [isAuth, bare]);") < app.indexOf("if (isLoading) return <FullScreenLoader />;"));
});

test("the shell reads the Settings list from a small module, not the Settings page", () => {
  const sidebar = SRC("src/components/shared/Sidebar.jsx");
  assert.match(sidebar, /import \{ MENU_ITEMS, shortcutPath, shortLabel \} from "\.\.\/\.\.\/constants\/settingsMenu";/);
  assert.doesNotMatch(sidebar, /pages\/Settings/);
  const menu = SRC("src/constants/settingsMenu.js");
  assert.match(menu, /^import \{ I \} from "\.\.\/components\/settings\/icons";$/m);
  assert.doesNotMatch(menu, /from "[^"]*pages\//, "importing a page would pull it back into the shell");
  for (const name of ["MENU_ITEMS", "shortLabel", "shortcutPath"]) assert.match(menu, new RegExp(`export const ${name} =`));
  assert.match(menu, /const SHOW_LATER_FEATURES = false;/);
  const settings = SRC("src/pages/Settings.jsx");
  assert.match(settings, /import \{ MENU_ITEMS, shortLabel \} from "\.\.\/constants\/settingsMenu";/);
  assert.doesNotMatch(settings, /export const (MENU_ITEMS|shortLabel|shortcutPath)\b/, "one copy of the list");
});

test("the loader every lazy page waits on does not pull in framer-motion", () => {
  const loader = SRC("src/components/shared/FullScreenLoader.jsx");
  assert.doesNotMatch(loader, /framer-motion|motion\./);
  assert.match(loader, /animate-pulse/);
});
