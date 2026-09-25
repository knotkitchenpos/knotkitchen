import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");

/**
 * Item photos are made 4:3 in the POS, so every photo frame on the website is
 * 4:3 too. A fixed height (h-40, 260px, 700px) crops or letterboxes them.
 */
test("the menu card and the item popup frame photos 4:3", () => {
  assert.match(SRC("components/ProductCard.jsx"), /aspect-\[4\/3\]/);
  assert.match(SRC("components/ProductModal.jsx"), /relative aspect-\[4\/3\] w-full/);
});

test("every landing design frames its hero and dish photos 4:3, never at a fixed height", () => {
  for (const f of ["citrus", "garden", "night", "sunset"]) {
    const css = SRC(`components/landing/styles/${f}.css`);
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/(hero-visual|menu-card)[^,]*\bimg\s*$/.test(sel.trim())) continue;
      assert.doesNotMatch(body, /height:\s*\d+px/, `${f}: ${sel.trim()}`);
    }
    assert.match(css, /aspect-ratio: 4 \/ 3/, f);
  }
  const peddler = SRC("components/landing/styles/peddler.css");
  for (const [, ratio] of peddler.matchAll(/(?:dish-image|hero-image-frame)\{[^}]*aspect-ratio:([^;}]+)/g)) {
    assert.equal(ratio.trim(), "4/3");
  }
});
