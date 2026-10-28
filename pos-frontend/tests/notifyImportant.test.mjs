import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// "Only give the important alert popups as it is disturbing in mobile
// screen" (owner, 2026-10-29). One rule in src/utils/notify.js: errors,
// warnings and info show; a success shows only when marked important.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(p);
  }
};
walk(path.join(__dirname, "..", "src"));

test("a routine success is dropped; an important one, errors and warnings show", () => {
  const notify = SRC("src/utils/notify.js");
  assert.match(notify, /export const enqueueSnackbar = \(message, \{ important = false, \.\.\.options \} = \{\}\) => \{\n\s+if \(options\.variant === "success" && !important\) return null;\n\s+return show\(message, options\);/);
});

test("every screen goes through the rule: none imports enqueueSnackbar from notistack", () => {
  const direct = files.filter((f) => !f.endsWith(path.join("utils", "notify.js")) && /import \{[^}]*enqueueSnackbar[^}]*\} from "notistack"/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(direct.map((f) => path.relative(path.join(__dirname, ".."), f)), []);
});

test("the till's own order confirmation is not marked important; money and messages to customers are", () => {
  assert.match(SRC("src/components/pos/OrderPanel.jsx"), /enqueueSnackbar\("Order completed!", \{ variant: "success" \}\)/);
  assert.match(SRC("src/pages/Billing.jsx"), /enqueueSnackbar\("Balance added\.", \{ variant: "success", important: true \}\)/);
  assert.match(SRC("src/components/invoice/Invoice.jsx"), /`E-Bill sent to \$\{customerPhone\}`, \{ variant: "success", important: true \}/);
  assert.match(SRC("src/hooks/useOfflineQueue.js"), /offline order\(s\) synced\.`, \{ variant: "success", important: true \}/);
});
