import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC = (rel) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");
const panel = SRC("components/pos/OrderPanel.jsx");

test("counter checkout takes Cash, UPI, Card and a split", () => {
  const modal = SRC("components/pos/PaymentMethodModal.jsx");
  for (const id of ["cash", "upi", "card"]) assert.match(modal, new RegExp(`id: "${id}"`));
  assert.match(modal, /onSelect\("split", parts\.map/);
  assert.doesNotMatch(modal, /from "\.\.\/tables\/TableSettleModal"/);
  assert.match(panel, /const PAYMENT_METHODS = \{ cash: "Cash", upi: "UPI", card: "Card", split: "Split" \};/);
  assert.match(panel, /\.\.\.\(paymentMethod === "split" \? \{ splits \} : \{\}\)/);
});

test("a held order shows its total after the saved discount", () => {
  assert.match(panel, /const heldTotal = round2\(gross - computeDiscountAmount\(heldOrder\.discount \|\| \{\}, gross\)\);/);
});

test("a table cart neither offers nor counts a discount it never sends", () => {
  assert.match(panel, /\(isTable \? 0 : computeDiscountAmount\(discount, subtotal\)\)/);
  assert.match(panel, /\{!isTable && \(\n\s*<button\n\s*type="button"\n\s*onClick=\{\(\) => setShowDiscount\(true\)\}/);
});

test("the till's GST follows the server's rule and arithmetic", () => {
  // No GST number, or GST set to the website only: no tax at the till.
  assert.match(panel, /Boolean\(String\(storeProps\.gstNumber \|\| ""\)\.trim\(\)\) && \(gstApplyTo === "both" \|\| gstApplyTo === "system"\)/);
  assert.match(panel, /const taxPercent = gstOn \?/);
  // round2(base * rate), as price.computeTotals: (base * pct) / 100 was a paisa off on some totals.
  assert.match(panel, /round2\(taxableBase \* \(taxPercent \/ 100\)\)/);
  assert.match(panel, /taxInclusive,\n\s*totalWithTax,/, "the offline invoice knows the GST is included");
  // A 409 means the settings changed: reload them.
  assert.match(panel, /if \(e\.response\?\.status === 409\) \{/);
});

test("the till never bills without its settings", () => {
  assert.match(panel, /queryFn: withSavedCopy\("kk\.pos\.websiteSettings", getWebsiteSettings\)/);
  assert.match(panel, /queryFn: withSavedCopy\("kk\.pos\.storeProps", getStoreProperties\)/);
  assert.match(panel, /if \(saved && !err\?\.response\) return saved;/);
  assert.match(panel, /if \(!websiteRes \|\| !propsRes\) \{/);
});

test("a required option has no remove button; a discount by staff needs the PIN", () => {
  assert.match(panel, /\{canRemoveModifier\(item, idx\) \? \(/);
  assert.match(panel, /!checkActionAuthorization\(user, \{\}\)\.allowed\) \{\n\s*try \{\n\s*await requestPin\(\);/);
  // The PIN comes before the discount is applied.
  const apply = panel.slice(panel.indexOf("onApply={async"));
  assert.ok(apply.indexOf("requestPin()") < apply.indexOf("setPercentDiscount("));
});

test("a live order and its offline copy share one id", () => {
  assert.match(panel, /const localId = newLocalId\(\);/);
  assert.match(panel, /await addOrder\(d, localId\)/);
  assert.match(panel, /enqueueOrder\(d, localId\)/);
});
