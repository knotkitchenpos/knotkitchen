/**
 * A CSV import must land in the DRAFT, not go live.
 *
 * importCsv called publishAllMenusForUser the instant the upload finished, so
 * a CSV appeared on the tills with no chance to review it. Worse, that helper
 * publishes EVERY menu the user owns -- so an import also pushed out unrelated
 * edits that were still being worked on elsewhere in Manage Menu.
 *
 * Publishing is the operator's decision, taken in Manage Cache. One button
 * there publishes the tills and the customer website together.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "controllers", "csvMenuController.js"),
  "utf8",
);

// Strip comments so the assertions below cannot be satisfied (or defeated) by
// prose that merely mentions publishing.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("REGRESSION: the CSV importer never publishes", () => {
  assert.ok(
    !/publishAllMenusForUser\s*\(/.test(CODE),
    "importing must not publish -- that is what made CSV changes go live immediately",
  );
});

test("REGRESSION: the importer does not write a snapshot by hand either", () => {
  // Reaching around the helper would reintroduce the same behaviour.
  assert.ok(!/systemSnapshot\s*=/.test(CODE), "must not assign systemSnapshot");
  assert.ok(!/hasPublishedToSystem\s*=/.test(CODE), "must not flip hasPublishedToSystem");
});

test("the response tells the operator the import is still a draft", () => {
  assert.match(SOURCE, /Manage Cache/, "the message should point at where to publish");
  assert.match(SOURCE, /published: false/, "and say plainly that it is not live");
});

test("publishing to the tills is still reachable, just not automatic", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "menuRoute.js"), "utf8");
  assert.match(routes, /publish\/system/);
  assert.ok(
    !/publish\/website/.test(routes),
    "there is no separate website publish -- Publish System covers both",
  );
});

test("REGRESSION: the POS view has no fallback to the draft", () => {
  // Even with the importer fixed, a fallback here would leak unpublished
  // changes to the tills anyway.
  const cache = fs.readFileSync(path.join(__dirname, "..", "services", "menuCache.js"), "utf8");
  const systemBlock = cache.slice(
    cache.indexOf("AUDIENCES.SYSTEM"),
    cache.indexOf("AUDIENCES.WEBSITE"),
  );
  assert.match(systemBlock, /items:\s*published\s*\?/, "items must be gated on published");
  assert.ok(
    !/items:\s*published\s*\?\s*[^:]+:\s*menu\.items/.test(systemBlock),
    "an unpublished menu must yield NO items, never the draft",
  );
});
