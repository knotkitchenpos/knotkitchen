import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("../src/components/tables/TableSettleModal.jsx", import.meta.url), "utf8");

test("the e-bill is opt-in, and never sent by hand when Auto E-Bill already sends it", () => {
  assert.match(modal, /const \[alsoEBill, setAlsoEBill\] = useState\(false\);/);
  assert.match(modal, /queryKey: \["store-properties"\], queryFn: getStoreProperties/);
  assert.match(modal, /const autoEBill = Boolean\(propsRes\?\.data\?\.data\?\.posSettings\?\.autoEBill\);/);
  assert.match(modal, /sendEBill: Boolean\(phone && alsoEBill && !autoEBill\)/);
});

test("the settle panel reads the session live and refuses a table already paid", () => {
  // The key starts with "tables", so socket events and mutations refetch it.
  assert.match(modal, /const liveKey = \["tables", "session", session\?\._id\];/);
  assert.match(modal, /queryFn: \(\) => getTableSessionById\(session\._id\)/);
  assert.doesNotMatch(modal, /useState\(session\?\.bills/, "no frozen copy of the bill");
  assert.match(modal, /const settled = live\.status === "CLOSED" \|\| live\.status === "PAID" \|\| live\.payment\?\.status === "PAID";/);
  assert.match(modal, /disabled=\{busy \|\| settled \|\|/);
  assert.match(modal, /This table has already been paid\./);
});

test("a discount can be set on the table bill, struck by the server", () => {
  assert.match(modal, /import DiscountModal from "\.\.\/pos\/DiscountModal";/);
  assert.match(modal, /setTableDiscount\(session\._id, d\)/);
  assert.match(modal, /onClear=\{\(\) => applyDiscount\(\{ mode: "none", value: 0 \}\)\}/);
  assert.match(modal, /qc\.setQueryData\(liveKey, await call\(\)\)/);
});
