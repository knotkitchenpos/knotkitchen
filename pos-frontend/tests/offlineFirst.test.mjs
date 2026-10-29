import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// "The app's offline mode is not working properly: if the device is offline
// the app doesn't open, sometimes the menu and order page is not showing"
// (owner, 2026-10-29).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("the build writes every file and a build id into the service worker", async () => {
  const { default: config } = await import("../vite.config.js");
  const plugin = config.plugins.flat().find((p) => p?.name === "kk-precache-sw");
  assert.ok(plugin, "the precache plugin is in the build");
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "kk-sw-"));
  fs.writeFileSync(path.join(outDir, "sw.js"), SRC("public/sw.js"));
  plugin.configResolved({ root: outDir, build: { outDir } });
  plugin.generateBundle({}, { "assets/Orders-abc.js": {}, "assets/index-def.js": {}, "assets/index-def.js.map": {}, "index.html": {} });
  plugin.closeBundle();
  const sw = fs.readFileSync(path.join(outDir, "sw.js"), "utf8");
  assert.match(sw, /const PRECACHE = \["\/assets\/Orders-abc\.js","\/assets\/index-def\.js","\/index\.html"\];/);
  assert.doesNotMatch(sw, /__KK_BUILD_ID__|__KK_PRECACHE__/);
  assert.doesNotMatch(sw, /\.map"/, "no source maps on the till");
});

test("the service worker stores every page at install and opens from it after 4 s without network", () => {
  const sw = SRC("public/sw.js");
  // Every file of the build, one by one so one missing file cannot stop the rest.
  assert.match(sw, /const PRECACHE = \["__KK_PRECACHE__"\];/);
  assert.match(sw, /Promise\.allSettled\(/);
  assert.doesNotMatch(sw, /cache\.addAll\(/);
  // The shell is asked for as a page, so the Android app's bridge comes with it.
  assert.match(sw, /new Request\(new URL\(SHELL, self\.location\.origin\)\.href, \{ headers: \{ Accept: "text\/html" \}/);
  // A navigation waits at most 4 s for the network, then the stored shell.
  assert.match(sw, /const NAV_TIMEOUT_MS = 4000;/);
  assert.match(sw, /await Promise\.race\(\[network, timeout\]\)/);
  // Old builds are dropped once the new one takes over.
  assert.match(sw, /k\.startsWith\("knotkitchen-shell-"\) && k !== CACHE_NAME/);
});

test("a till already signed in opens at once; the session check runs behind it with a time limit", () => {
  const load = SRC("src/hooks/useLoadData.js");
  assert.match(load, /const \[isLoading, setIsLoading\] = useState\(!signedIn\);/);
  // Only the server refusing the session signs the till out, never a lost or slow connection.
  assert.match(load, /if \(!\[401, 403\]\.includes\(error\?\.response\?\.status\)\) return;/);
  const api = SRC("src/https/index.js");
  assert.match(api, /export const getUserData = \(\) => axiosWrapper\.get\("\/api\/user", \{ timeout: OFFLINE_TIMEOUT \}\);/);
  for (const call of ["getStoreProperties", "getMyRestaurant"]) {
    assert.match(api, new RegExp(`export const ${call} = \\(\\) => axiosWrapper\\.get\\([^)]*\\{ timeout: OFFLINE_TIMEOUT \\}\\)`), call);
  }
  assert.match(api, /timeout: params\?\.versionOnly \? OFFLINE_TIMEOUT : 30000/, "the menu check");
  assert.match(SRC("src/https/storefrontApi.js"), /axiosWrapper\.get\("\/api\/website\/settings", \{ timeout: 10000 \}\)/);
});

test("Orders offline: today's orders from the device, and the sales waiting to sync listed first", () => {
  const orders = SRC("src/pages/Orders.jsx");
  assert.match(orders, /writeStoreScoped\(TODAY_KEY, \{ day: localDay\(\), data: res\.data \}\);/);
  assert.match(orders, /if \(!err\?\.response && saved\?\.day === localDay\(\)\) return \{ data: saved\.data, offline: true \};/, "never yesterday's list as today's");
  assert.match(orders, /queryFn: \(\) => loadOrders\(orderParams\),\s*\/\/[^\n]*\n\s*networkMode: "always",/);
  assert.match(orders, /\[\.\.\.\(orderParams \? \[\] : queued\.map\(localOrderView\)\), \.\.\.\(data\?\.data\?\.data \|\| \[\]\)\]/);
  assert.match(orders, /window\.addEventListener\("kk:offline-queue", changed\);/);
  assert.match(orders, /\{o\.syncError \? "Not synced" : "Waiting to sync"\}/);
  assert.match(SRC("src/utils/offlineQueue.js"), /syncError: entry\.error \|\| "",/);
});
