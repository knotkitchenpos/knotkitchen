import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// The till keeps the menu (and photos) on the device, opens from it at once,
// and downloads again only when the server's menu version changed.
test("the POS opens from the saved menu and checks the version in the background", () => {
  const panel = SRC("src/components/pos/ProductPanel.jsx");
  assert.match(panel, /queryFn: loadSystemMenu,/);
  assert.match(panel, /initialData: \(\) => \{\s*const saved = readSavedMenu\(\);/);
  assert.match(panel, /initialDataUpdatedAt: 0,/, "the saved copy is shown but still checked on open");
  assert.match(panel, /refetchInterval: 5 \* 60 \* 1000,/);
});

test("only a changed version downloads the menu; offline keeps the saved copy", () => {
  const src = SRC("src/utils/systemMenu.js");
  const load = src.slice(src.indexOf("export const loadSystemMenu"), src.indexOf("export const photoUrls"));
  assert.ok(load.indexOf("versionOnly: 1") < load.indexOf('getMenus({ source: "system" })'), "version first");
  assert.match(load, /check\?\.data\?\.version === saved\.version/);
  assert.match(load, /if \(saved\?\.body && !err\?\.response\) return \{ data: saved\.body, changed: false, offline: true \};/);
  assert.match(load, /savePhotos\(next\.body\?\.data\);/, "a new menu saves its photos");
  assert.match(src, /thumbUrl\(img, 320\)/);
  assert.match(src, /thumbUrl\(img, 160\)/);
});

test("Manage Cache has the Check for updates button", () => {
  const view = SRC("src/components/settings/ManageCacheView.jsx");
  assert.match(view, /await checkMenuNow\(queryClient\)/);
  assert.match(view, /"Check for updates"/);
  assert.match(view, /<DeviceMenuCard \/>/);
});

test("View All is a full-size button with a gap above the products", () => {
  const panel = SRC("src/components/pos/ProductPanel.jsx");
  const heading = panel.slice(panel.indexOf("Section heading"), panel.indexOf("Scrollable content"));
  assert.match(heading, /pb-4 shrink-0 flex items-center justify-between/);
  assert.match(heading, /onClick=\{\(\) => setViewAll\(true\)\}\s*className="h-9 px-3\.5 rounded-lg/);
});

test("review fixes: per-store key, old copy freed first, no stale write-back", () => {
  const src = SRC("src/utils/systemMenu.js");
  assert.match(src, /export const systemMenuKey = \(\) => \["menus", "system", getActiveStoreId\(\)\];/);
  assert.match(SRC("src/components/pos/ProductPanel.jsx"), /queryKey: systemMenuKey\(\),/);
  const save = src.slice(src.indexOf("const save ="), src.indexOf("export const systemMenuKey"));
  assert.ok(save.indexOf("OLD_KEY, null") < save.indexOf("writeStoreScoped(KEY, next)"), "free the old copy before writing");
  assert.match(src, /const current = readSavedMenu\(\);\s*if \(current\?\.version === saved\.version\) save\(\{ \.\.\.current, checkedAt/);
});
