import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { clampPos } from "../src/hooks/useHoldDrag.js";

const SRC = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("a dragged box always keeps a corner on screen to grab again", () => {
  assert.deepEqual(clampPos({ x: -900, y: -50 }, 330, 120, 1024, 768), { x: 48 - 330, y: 0 });
  assert.deepEqual(clampPos({ x: 5000, y: 5000 }, 330, 120, 1024, 768), { x: 1024 - 48, y: 768 - 48 });
  assert.deepEqual(clampPos({ x: 100, y: 200 }, 330, 120, 1024, 768), { x: 100, y: 200 });
});

test("the Waiter Called alert can be held and dragged; its ✓ stays a button", () => {
  // Owner, 2026-10-31: it covered the menu's buttons.
  const popup = SRC("src/components/dashboard/WaiterCallPopup.jsx");
  assert.match(popup, /useHoldDrag\("kk\.waiterCallPos\.v1"\)/, "where it was left is kept on this device");
  assert.match(popup, /\{\.\.\.holdToMove\}\s*style=\{movedTo \|\| undefined\}/);
  const hook = SRC("src/hooks/useHoldDrag.js");
  assert.match(hook, /e\.target\.closest\("button, a, input, select, textarea"\)/);
  assert.match(hook, /window\.addEventListener\("touchmove", noScroll, \{ passive: false \}\)/);
  assert.match(hook, /localStorage\.setItem\(storageKey, JSON\.stringify\(d\.pos\)\)/);
});
