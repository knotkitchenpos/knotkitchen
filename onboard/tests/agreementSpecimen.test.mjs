import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const read = (f) => fs.readFileSync(path.join(pub, f), "utf8");

// The public Agreement page that knotkitchen.com/terms.html and the POS link to.
// Runs its scripts in page order, the way a browser would, and keeps what the
// page writes into #agr.
function render() {
  const page = read("agreement.html");
  const box = { innerHTML: "" };
  const ctx = { window: {}, document: { getElementById: (id) => (id === "agr" ? box : null) } };
  vm.createContext(ctx);
  const scripts = [...page.matchAll(/<script(?: src="([^"]+)")?>([\s\S]*?)<\/script>/g)];
  for (const [, src, inline] of scripts) vm.runInContext(src ? read(src) : inline, ctx);
  return { scripts: scripts.map(([, src]) => src || "inline"), html: box.innerHTML };
}

test("the public Agreement page builds the full text from the portal's own scripts", () => {
  const { scripts, html } = render();
  assert.deepEqual(scripts, ["js/agreement_v3.js", "inline", "js/agreement_text.js", "js/markdown.js", "inline"]);
  assert.match(html, /<h4>1\. /, "the clauses rendered");
  assert.match(html, /AGREEMENT ACCEPTANCE/);
  assert.match(html, /ANNEXURE A/);
  assert.doesNotMatch(html, /\[[A-Z_]+\]|ANNEXURE_A_PLACEHOLDER|undefined/, "every placeholder is filled");
});
