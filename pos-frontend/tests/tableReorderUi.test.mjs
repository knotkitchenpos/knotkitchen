import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { moveId, HOLD_MS } from "../src/hooks/useHoldReorder.js";

const SRC = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("a dragged table takes the place of the one under the finger", () => {
  assert.deepEqual(moveId(["a", "b", "c", "d"], "a", "c"), ["b", "c", "a", "d"]);
  assert.deepEqual(moveId(["a", "b", "c", "d"], "d", "a"), ["d", "a", "b", "c"]);
  const same = ["a", "b"];
  assert.equal(moveId(same, "a", "a"), same, "no move, same list");
  assert.equal(moveId(same, "x", "a"), same);
});

test("hold, not tap: a card lifts after a hold, a moving finger scrolls, buttons stay buttons", () => {
  // Hold a table on the Tables screen, then move it (owner, 2026-10-31).
  assert.ok(HOLD_MS >= 400 && HOLD_MS <= 600);
  const hook = SRC("src/hooks/useHoldReorder.js");
  assert.match(hook, /e\.target\.closest\("button, a, input, select, textarea"\)/);
  assert.match(hook, /> SLOP_PX\) cancelHold\(\)/);
  assert.match(hook, /window\.addEventListener\("touchmove", noScroll, \{ passive: false \}\)/);
  assert.match(hook, /onContextMenu: \(e\) => e\.preventDefault\(\)/);
  assert.match(hook, /if \(d\.order\.join\(\) !== d\.start\.join\(\)\) latest\.current\.onDrop\(d\.order\)/);
});

test("the Tables screen saves the new order and shows it at once", () => {
  const page = SRC("src/pages/Tables.jsx");
  assert.match(page, /\{\.\.\.holdToMove\(table\._id\)\}/);
  assert.match(page, /\{shownTables\.map\(\(table\) => \(/);
  assert.match(page, /queryClient\.setQueryData\(\["tables"\]/);
  assert.match(page, /reorderMutation\.mutate\(ids\)/);
  // With a filter on, only the shown tables' places in the full list change.
  assert.match(page, /tables\.map\(\(t\) => \(slots\.has\(t\._id\) \? queue\.shift\(\) : t\._id\)\)/);
  assert.match(SRC("src/https/index.js"), /export const reorderTables = \(ids\) => axiosWrapper\.put\("\/api\/table\/order", \{ ids \}\);/);
});
