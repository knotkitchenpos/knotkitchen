import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { QueryClient, MutationObserver, onlineManager } from "@tanstack/query-core";

const SRC = (rel) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");
const panel = SRC("components/pos/OrderPanel.jsx");

test("REGRESSION N005: an offline sale runs (and queues) instead of pausing on Processing", async () => {
  assert.match(SRC("main.jsx"), /mutations: \{ networkMode: "always" \}/);
  onlineManager.setOnline(false);
  try {
    const client = new QueryClient();
    // The old default: paused while offline, so Finish showed "Processing..." for ever.
    const paused = new MutationObserver(client, { mutationFn: async () => "sent" });
    paused.mutate().catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(paused.getCurrentResult().isPaused, true);
    // What main.jsx now sets: the mutationFn runs and the offline queue answers.
    const always = new MutationObserver(client, { mutationFn: async () => "queued", networkMode: "always" });
    assert.equal(await always.mutate(), "queued");
  } finally {
    onlineManager.setOnline(true);
  }
});

test("REGRESSION N005: the till's settings load from the saved copy while offline", () => {
  for (const key of ["kk\\.pos\\.websiteSettings", "kk\\.pos\\.storeProps"]) {
    assert.match(panel, new RegExp(`withSavedCopy\\("${key}", \\w+\\),\\s*staleTime: 5 \\* 60_000,\\s*retry: false,\\s*networkMode: "always",`));
  }
});

test("REGRESSION N006: a reload without internet keeps the tab signed in", () => {
  assert.match(
    SRC("hooks/useLoadData.js"),
    /if \(!\[401, 403\]\.includes\(error\?\.response\?\.status\)\) return;\s*dispatch\(removeUser\(\)\)/,
  );
});

test("REGRESSION N013: a double tap of one sale or table round sends one key", () => {
  const decl = panel.indexOf("const roundKey = useMemo(() => newLocalId(), [cart]);");
  assert.ok(decl > -1, "roundKey is one key per cart");
  assert.ok(decl < panel.indexOf("const orderMutation"), "declared before orderMutation uses it");
  assert.match(panel, /const localId = roundKey;/);
  assert.equal(panel.match(/idempotencyKey: roundKey/g)?.length, 2, "table append and new table session");
  assert.match(panel, /addItemsToTableSession\(\{ sessionId, items, customerCount, idempotencyKey \}\)/);
});
