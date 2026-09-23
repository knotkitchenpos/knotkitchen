import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "src");

/**
 * Every screen that SHOWS dishes to a cashier reads the System (published)
 * menu. Only the editors (Manage Menu, the add-product picker, recipes)
 * may read the draft. A new dish must never appear on the till before
 * Settings > Manage Cache > Publish System.
 */
const DRAFT_READERS_ALLOWED = new Set([
  "components/dashboard/ManageMenu.jsx",
  "pages/Menu.jsx", // only feeds the Add Product category picker
  "components/settings/InventoryView.jsx",
  "pages/WebsiteSettings.jsx",
]);

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(full);
  }
  return out;
};

test("the till shows only the published menu", () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    const src = fs.readFileSync(file, "utf8");
    // A bare getMenus() / queryFn: getMenus is a draft read.
    if (/queryFn:\s*getMenus\b(?!\()|getMenus\(\)/.test(src) && !DRAFT_READERS_ALLOWED.has(rel)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `draft menu read outside an editor: ${offenders.join(", ")}`);
  // The till's read lives in utils/systemMenu.js (the copy kept on the device).
  const pp = fs.readFileSync(path.join(SRC, "components/pos/ProductPanel.jsx"), "utf8");
  assert.match(pp, /queryFn: loadSystemMenu,/);
  const store = fs.readFileSync(path.join(SRC, "utils/systemMenu.js"), "utf8");
  assert.match(store, /getMenus\(\{ source: "system" \}\)/);
  assert.match(store, /getMenus\(\{ source: "system", versionOnly: 1 \}\)/);
});
