import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nextTableName } from "../src/utils/tableNames.js";

// Create Table keeps the form open, with the same area and capacity and the
// next name ready to edit, so a floor is set up quickly (owner, 2026-10-29).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("the next name counts on from the number at the end, keeping its zeros", () => {
  assert.equal(nextTableName("T1"), "T2");
  assert.equal(nextTableName("Table 2"), "Table 3");
  assert.equal(nextTableName("GF-T9"), "GF-T10");
  assert.equal(nextTableName("VIP-01"), "VIP-02");
  assert.equal(nextTableName("Garden"), "Garden", "no number: offered as it was, to type over");
});

test("Create Table keeps the form open with its area and capacity, and the next name selected", () => {
  const page = SRC("src/pages/Tables.jsx");
  const add = page.slice(page.indexOf("const addTableMutation = useMutation({"), page.indexOf("const updateTableMutation"));
  assert.doesNotMatch(add, /setIsAddModalOpen\(false\)/, "the form stays open");
  assert.doesNotMatch(add, /resetForm\(\)/, "area, capacity and the switch are kept");
  assert.match(add, /setDisplayId\(nextTableName\(vars\.displayId\)\);/);
  assert.match(add, /tableNameRef\.current\?\.select\(\);/);
  assert.match(page, /Added: \{addedNames\.join\(", "\)\}/);
});
