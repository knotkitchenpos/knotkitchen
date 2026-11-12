import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { opensFromLeft } from "../src/utils/popoverSide.js";

const at = (left, right) => ({ getBoundingClientRect: () => ({ left, right }) });
const src = (f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

test("a menu opens from the button's left edge only when the right-anchored one would leave the screen", () => {
  // Phone: Export starts 100 px in, ends at 200; a 240 px menu from its right edge would start at -40.
  assert.equal(opensFromLeft(at(100, 200), 240), true);
  // Desktop: plenty of room to the left.
  assert.equal(opensFromLeft(at(1000, 1100), 240), false);
  assert.equal(opensFromLeft(at(0, 247), 240), true, "inside the 8 px margin");
  assert.equal(opensFromLeft(null, 240), false);
});

test("Reports → Export and Manage Menu → Manage pick their side when they open, and never exceed the screen", () => {
  const rep = src("pages/Reports.jsx");
  assert.match(rep, /setExportFromLeft\(opensFromLeft\(exportRef\.current, 240\)\)/);
  assert.match(rep, /\$\{exportFromLeft \? "left-0" : "right-0"\}[^"`]*max-w-\[calc\(100vw-2rem\)\]/);
  const mm = src("components/dashboard/ManageMenu.jsx");
  assert.match(mm, /setBulkFromLeft\(opensFromLeft\(bulkRef\.current, 224\)\)/);
  assert.match(mm, /\$\{bulkFromLeft \? "left-0" : "right-0"\} mt-2 w-56 max-w-\[calc\(100vw-2rem\)\]/);
});
