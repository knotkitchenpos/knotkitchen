import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/** Security audit (owner, 2026-11-03): the POS side of the owner reset code and the Security PIN. */

const SRC = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("setting or resetting the owner password asks for the reset code from support", () => {
  const login = SRC("src/components/auth/Login.jsx");
  assert.match(login, /setupMutation\.mutate\(\{ storeId: storeId\.trim\(\), ownerPhone: cleanPhone, resetCode, password \}\);/);
  assert.match(login, /if \(!\/\^\\d\{6\}\$\/\.test\(resetCode\)\) \{/);
  assert.match(login, /I have a reset code/);
  assert.match(login, /Reset code from support/);
});

test("with no Security PIN set, the owner is asked to set one; the first needs no current PIN", () => {
  const props = SRC("src/components/settings/StorePropertiesView.jsx");
  assert.match(props, /const hasPin = storeData\.hasCustomPin === true;/);
  assert.match(props, /Set a Security PIN below to edit/);
  assert.match(props, /\{hasPin && <div>/, "the current-PIN field only once a PIN exists");
  assert.doesNotMatch(props, /8796/);
});
