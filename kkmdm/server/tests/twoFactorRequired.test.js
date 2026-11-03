const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/** Security audit (owner, 2026-11-03): two-factor sign-in is required for KKMDM admins in production. */
test("an admin without 2FA reaches only the 2FA setup in production", () => {
  const auth = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "adminAuth.js"), "utf8");
  assert.match(auth, /if \(config\.isProduction && !admin\.totpEnabled && !TWO_FA_SETUP_PATHS\.includes\(req\.originalUrl\.split\("\?"\)\[0\]\)\) \{/);
  assert.match(auth, /"\/api\/auth\/2fa\/setup", "\/api\/auth\/2fa\/enable"/);
  const dash = fs.readFileSync(path.join(__dirname, "..", "..", "dashboard", "src", "App.jsx"), "utf8");
  assert.match(dash, /const needs2fa = admin\.twoFactorRequired && !admin\.totpEnabled;/);
});
