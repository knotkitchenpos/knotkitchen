import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyAutoCase } from "../src/utils/autoCase.js";

/** Type `text` one key at a time ("\b" is backspace at the end). */
const type = (text, mode, start = "") => {
  let value = start;
  let keepAt = null;
  for (const key of text) {
    const next = key === "\b" ? value.slice(0, -1) : value + key;
    ({ value, keepAt } = applyAutoCase(value, next, mode, keepAt));
  }
  return value;
};

test("names come out in Capitalized Case as they are typed", () => {
  // Owner, 2026-10-31.
  assert.equal(type("paneer tikka pizza", "title"), "Paneer Tikka Pizza");
  assert.equal(type("mac & cheese (large)", "title"), "Mac & Cheese (Large)");
  assert.equal(type("BBQ chicken", "title"), "BBQ Chicken", "the rest of a word stays as typed");
  assert.equal(type("coca-cola", "title"), "Coca-Cola");
});

test("descriptions come out in Sentence case", () => {
  assert.equal(type("crispy base. topped with cheese! try it", "sentence"), "Crispy base. Topped with cheese! Try it");
  assert.equal(type("serves two\nspicy", "sentence"), "Serves two\nSpicy");
});

test("the owner can always have it otherwise: backspace a capital, type a small letter", () => {
  assert.equal(type("x\bxl pizza", "title"), "xl Pizza");
  assert.equal(type("small fries with ketchup", "title").length, 24);
  assert.equal(type("with d\bdip", "title"), "With dip");
  // Pasted text is left as it is.
  assert.equal(applyAutoCase("", "paneer tikka", "title").value, "paneer tikka");
  // A capital typed on purpose mid-word stays.
  assert.equal(type("iPhone case", "title"), "IPhone Case");
});

test("the product, category, group and component fields use it", () => {
  const dir = "src/components/dashboard/manageMenu";
  const src = (f) => fs.readFileSync(new URL(`../${dir}/${f}`, import.meta.url), "utf8");
  assert.match(src("ProductDrawer.jsx"), /autoCase\("title", prodName, setProdName\)/);
  assert.match(src("ProductDrawer.jsx"), /autoCase\("sentence", prodDesc, setProdDesc\)/);
  assert.match(src("CategoryDrawer.jsx"), /autoCase\("title", catName, setCatName\)/);
  assert.match(src("CategoryDrawer.jsx"), /autoCase\("sentence", catDesc, setCatDesc\)/);
  assert.match(src("GroupDrawer.jsx"), /autoCase\("title", groupName, setGroupName\)/);
  assert.match(src("GroupDrawer.jsx"), /autoCase\("title", extraNameInput, setExtraNameInput\)/);
});
