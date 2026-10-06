import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// settings-batch5/S1 + S3: ?view= draws only a sub-view (or a lock). ?view=tables opens
// Manage Tables' own page; a hidden id (?view=shift|inventory) is the plain list.
test("?view= draws only sub-views; a page option redirects and a hidden one is the list", () => {
  const settings = SRC("src/pages/Settings.jsx");
  assert.match(settings, /const activeMeta = linked && \(linked\.mode === "view" \|\| blockedByPlan\(linked\)\) \? linked : null;/);
  assert.match(settings, /if \(linked\?\.path && !activeMeta\) return <Navigate to=\{linked\.path\} replace \/>;/);
  assert.doesNotMatch(settings, /activeSubView === "shift"/);
  assert.match(settings, /\{activeMeta && \(\s*<button/, "Back shows only over a sub-view");
});

// Small FE-5 copy and rule fixes, one line each.
test("settings copy: manager refunds, Pincode, store time zone, QR pay phone", () => {
  // csd-billing/B8: a manager can cancel paid orders and refund.
  assert.match(SRC("src/components/settings/ManageStaffView.jsx"), /value: "Manager", hint: "Can also cancel paid orders and refund\." \}/);
  // delivery-offline/X-3: Indian wording.
  assert.doesNotMatch(SRC("src/pages/WebsiteSettings.jsx"), /Postcode/);
  // reports/R2: Knot Eats' fee date and Billing dates are the store's (IST), not the device's.
  assert.match(SRC("src/components/settings/KnotEatsView.jsx"), /year: "numeric", timeZone: STORE_TZ \}/);
  const billing = SRC("src/pages/Billing.jsx");
  assert.match(billing, /dateStyle: "medium", timeZone: STORE_TZ \}/);
  assert.doesNotMatch(billing, /toLocaleDateString\("en-IN", \{ dateStyle: "medium" \}\)/);
  // settings-batch5/X-qr-payphone: the QR pay button needs a real Indian mobile.
  assert.match(SRC("src/pages/OrderOnline.jsx"), /disabled=\{loadingPayment \|\| !\/\^\[6-9\]\\d\{9\}\$\/\.test\(payPhone\)\}/);
});
