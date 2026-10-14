import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// QA N032-N034: settings and staff saves need a PIN typed for that save; the
// POS sends the one just typed in the popup for 30 s.
test("REGRESSION N034: the typed PIN is kept for 30 seconds, then forgotten", async () => {
  const { rememberTypedPin, typedPin } = await import("../src/utils/pinPrompt.js");
  const realNow = Date.now;
  try {
    assert.equal(typedPin(), null);
    rememberTypedPin("8796");
    assert.equal(typedPin(), "8796");
    const at = realNow();
    Date.now = () => at + 29_000;
    assert.equal(typedPin(), "8796");
    Date.now = () => at + 31_000;
    assert.equal(typedPin(), null);
  } finally {
    Date.now = realNow;
  }
});

test("REGRESSION N034: a verified PIN is remembered and sent as x-staff-pin", () => {
  assert.match(SRC("src/utils/security.js"), /setPinSession\(res\.data\.pinToken, res\.data\.expiresAt\);\s*rememberTypedPin\(pinInput\);/);
  const ax = SRC("src/https/axiosWrapper.js");
  assert.match(ax, /const pin = typedPin\(\);\s*if \(pin\) config\.headers\["x-staff-pin"\] = pin;/);
  assert.match(ax, /await requestPin\(\);/, "the PIN_REQUIRED popup and retry stay");
});

test("REGRESSION N006: a refresh that fails offline does not sign the tab out", () => {
  assert.match(
    SRC("src/https/axiosWrapper.js"),
    /if \(!isPublicPath\(\) && \[401, 403\]\.includes\(refreshError\?\.response\?\.status\)\) \{\s*window\.location\.href = "\/auth";/,
  );
});

test("REGRESSION N032: Manage Staff confirms a role change and a delete", () => {
  const view = SRC("src/components/settings/ManageStaffView.jsx");
  assert.match(view, /onChange=\{\(e\) => window\.confirm\(`Change \$\{s\.name\}'s role to \$\{e\.target\.value\}\?`\) && roleMutation\.mutate\(\{ id: s\._id, role: e\.target\.value \}\)\}/);
  assert.match(view, /onClick=\{\(\) => window\.confirm\(`Delete \$\{s\.name\}\? They will no longer be able to sign in\.`\) && deleteMutation\.mutate\(s\._id\)\}/);
});
