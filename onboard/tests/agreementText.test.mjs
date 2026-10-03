import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const read = (f) => fs.readFileSync(path.join(pub, f), "utf8");

// The portal's globals, as index.html loads them, with one onboarding draft.
function build(data) {
  const ctx = { window: {}, state: { data, agreement: { id: "KK-AGR-20261003-1001", date: "03/10/2026" } } };
  vm.createContext(ctx);
  vm.runInContext(read("js/agreement_v3.js"), ctx);
  vm.runInContext(read("js/agreement_text.js"), ctx);
  return vm.runInContext("buildAgreementText()", ctx);
}

test("the agreement builds with no amounts and only what the PDF renderer can draw", () => {
  const text = build({ gbp: "knotkitchen", r_name: "Spice Route", b_gst: "no" });
  assert.match(text, /paid GMB Management Add-on, priced and taken up in the KnotKitchen application/);
  assert.doesNotMatch(text, /NaN|₹|Rs\.? ?\d|ANNEXURE_|KK_PRICES/);
  for (const line of text.split("\n")) {
    assert.doesNotMatch(line, /^\s*\||^\s+- |^\d+\.\s/, `renderer cannot draw: ${line}`);
  }
});

test("the portal tick-boxes are clause 14, word for word", () => {
  const text = build({});
  const clause = text.split("## 14. AGREEMENT ACCEPTANCE")[1].split("---")[0];
  const bullets = clause.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  const ticks = [...read("index.html").matchAll(/\{ key:'accept_\w+', text:'([^']*)' \}/g)].map((m) => m[1]);
  assert.equal(ticks.length, 5);
  assert.deepEqual(ticks, bullets);
});
