import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/** Owner, 2026-11-03: "Failed to fetch dynamically imported module …/Menu-DCfFS6r2.js" after a deploy. */

test("the 'file from an older build is gone' failures are recognised, other errors are not", async () => {
  const { isStaleBuildError } = await import("../src/utils/staleBuild.js");
  for (const m of [
    "TypeError: Failed to fetch dynamically imported module: https://business.knotkitchen.com/assets/Menu-DCfFS6r2.js",
    "TypeError: Importing a module script failed.",
    "TypeError: error loading dynamically imported module",
    "Unable to preload CSS for /assets/Menu-abc.css",
  ]) assert.equal(isStaleBuildError(new Error(m)), true, m);
  assert.equal(isStaleBuildError(new Error("Cannot read properties of null (reading 'map')")), false);
});

test("it reloads once for the new version, never in a loop", async () => {
  const store = new Map();
  let reloads = 0;
  globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  globalThis.window = { location: { reload: () => { reloads += 1; } } };
  const { reloadForNewBuild } = await import("../src/utils/staleBuild.js");
  assert.equal(reloadForNewBuild(), true);
  assert.equal(reloadForNewBuild(), false, "a second failure right after shows the error instead");
  assert.equal(reloads, 1);
  const main = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  assert.match(main, /window\.addEventListener\("vite:preloadError"/);
  assert.match(main, /if \(isStaleBuildError\(error\) && reloadForNewBuild\(\)\) return \{ hasError: false, error: null, updating: true \};/);
});
