import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("a KOT and its receipt share one Store Properties fetch; the logo is downloaded once", () => {
  // Every print fetched Store Properties and downloaded the logo again before
  // anything went to the printer (owner, 2026-10-31).
  const src = SRC("src/utils/printReceipt.js");
  assert.match(src, /const CONTEXT_REUSE_MS = 10000;/);
  assert.match(src, /recentContext\.store === store && Date\.now\(\) - recentContext\.at < CONTEXT_REUSE_MS/, "same store, a few seconds");
  assert.match(src, /if \(recentContext\?\.promise === promise\) recentContext = null;/, "a failed fetch is not reused");
  assert.match(src, /const bitmaps = new Map\(\);/);
  assert.match(src, /if \(!bitmap\) bitmaps\.delete\(url\);/, "a failed download is tried again");
  // A new logo is a new address (uploads get a random key), so it is never served stale.
  assert.match(fs.readFileSync(new URL("../../pos-backend/services/storage/localProvider.js", import.meta.url), "utf8"), /crypto\.randomUUID\(\)/);
});
