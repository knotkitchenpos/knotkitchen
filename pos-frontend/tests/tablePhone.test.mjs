import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/** Every table order carries the customer's mobile: asked when the table opens, never on an append. */

test("the till asks for a 10-digit mobile when it opens a table, and hands name and phone on", () => {
  const modal = SRC("src/components/pos/TableModal.jsx");
  assert.match(modal, /\^\[6-9\]\\d\{9\}\$/);
  assert.match(modal, /if \(!adding && !\/\^\[6-9\]\\d\{9\}\$\/\.test\(phone\)\)/);
  assert.match(modal, /name: name\.trim\(\), phone/);
  // An append is still never asked for a head count or the table's id again.
  assert.match(modal, /guests: adding \? 0 : g/);
  assert.match(modal, /activeSessionId: sessionIdOf\(picked\)/);
  // A pasted "+91 98300 12345" keeps its last 10 digits; maxLength cut it to "9198300123".
  assert.match(modal, /onChange=\{\(e\) => setPhone\(mobileDigits\(e\.target\.value\)\)\}/);
  assert.doesNotMatch(modal, /maxLength=\{10\}/);

  const panel = SRC("src/components/pos/OrderPanel.jsx");
  assert.match(panel, /const doTable = \(\{ table, guests, name, phone \}\) =>/);
  assert.match(panel, /customerPhone: phone \|\| ""/);
  assert.match(panel, /initialPhone=\{customer\.customerPhone\}/);
});

test("seated from Manage Tables, Select Table opens on that table and head count", () => {
  const modal = SRC("src/components/pos/TableModal.jsx");
  assert.match(modal, /useState\(initialTableId \|\| null\)/);
  // Read from the live list, so it follows a QR order that took the table meanwhile.
  assert.match(modal, /const picked = tables\.find\(\(t\) => t\._id === pickedId\) \|\| null;/);
  assert.match(modal, /useState\(Math\.max\(1, Number\(initialGuests\) \|\| 1\)\)/);

  const panel = SRC("src/components/pos/OrderPanel.jsx");
  assert.match(panel, /initialTableId=\{customer\.table\?\.tableId\}/);
  assert.match(panel, /initialGuests=\{customer\.guests\}/);
});

test("a QR diner opening a table gives an Indian mobile", () => {
  const online = SRC("src/pages/OrderOnline.jsx");
  assert.match(online, /\^\[6-9\]\\d\{9\}\$/);
  assert.match(online, /Please enter a valid 10-digit mobile number\./);
});
