import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { backdropClose } from "../src/utils/backdropClose.js";

test("a tap on the dark backdrop closes the menu drawers; a tap inside never does", () => {
  // Owner, 2026-10-31.
  let closed = 0;
  const backdrop = {};
  const panel = {};
  const ev = (target) => ({ target, currentTarget: backdrop });
  backdropClose(() => (closed += 1)).onPointerDown(ev(backdrop));
  // A field blurring re-renders the drawer: the fresh props still close it.
  backdropClose(() => (closed += 1)).onClick(ev(backdrop));
  assert.equal(closed, 1);
  // Pressed inside (selecting text), let go on the backdrop: stays open.
  const p = backdropClose(() => (closed += 1));
  p.onPointerDown(ev(panel));
  p.onClick(ev(backdrop));
  p.onClick(ev(panel));
  assert.equal(closed, 1);
  for (const f of ["ProductDrawer", "CategoryDrawer", "GroupDrawer"]) {
    const src = fs.readFileSync(new URL(`../src/components/dashboard/manageMenu/${f}.jsx`, import.meta.url), "utf8");
    assert.match(src, /bg-black\/50 flex justify-end" \{\.\.\.backdropClose\(onClose\)\}>/, f);
  }
});
