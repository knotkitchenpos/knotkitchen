import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tableLabel } from "../src/utils/orderLabels.js";

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("the table pickers show the restaurant's table name, not the row number", () => {
  for (const file of ["components/pos/TableModal.jsx", "components/tables/TableSelectModal.jsx"]) {
    const code = src(file);
    assert.match(code, /tableLabel\(/, file);
    assert.ok(!/Table \{(t|table|picked)\.tableNumber\}/.test(code), `${file} still prints "Table <number>"`);
  }
});

test("tableLabel prefers the name and falls back to the number", () => {
  assert.equal(tableLabel({ tableNumber: 5, displayId: "LA - 1" }), "LA - 1");
  assert.equal(tableLabel({ tableNumber: 5, tableName: "Terrace" }), "Terrace");
  assert.equal(tableLabel({ tableNumber: 5 }), "Table 5");
});
