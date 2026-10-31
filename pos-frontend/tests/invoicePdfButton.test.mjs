import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Billing → Invoices has a PDF button that saves the file, in the app too", () => {
  // Owner, 2026-10-31.
  const page = fs.readFileSync(new URL("../src/pages/Billing.jsx", import.meta.url), "utf8");
  assert.match(page, /onClick=\{\(\) => downloadInvoicePdf\(inv\)\}/);
  assert.match(page, /format=pdf`\)/);
  assert.match(page, /await saveBlob\(await res\.blob\(\), /, "the app's FileSave, not a link its WebView ignores");
});
