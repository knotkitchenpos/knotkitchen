const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/** Security audit (owner, 2026-11-03): two-factor sign-in is required for KKMDM admins in production. */
test("an admin without 2FA reaches only the 2FA setup in production", () => {
  const auth = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "adminAuth.js"), "utf8");
  // Accounts from CSD signed in with CSD's own two-factor sign-in (lib/csdSso.js).
  assert.ok(auth.includes(`if (config.isProduction && !admin.totpEnabled && admin.ssoProvider !== "csd" && !TWO_FA_SETUP_PATHS.includes(req.originalUrl.split("?")[0])) {`));
  assert.match(auth, /"\/api\/auth\/2fa\/setup", "\/api\/auth\/2fa\/enable"/);
  const dash = fs.readFileSync(path.join(__dirname, "..", "..", "dashboard", "src", "App.jsx"), "utf8");
  assert.match(dash, /const needs2fa = admin\.twoFactorRequired && !admin\.totpEnabled;/);
});

/** Owner, 2026-11-03: a device stays signed in until it signs out; signing out ends only that device. */
test("sessions last until signed out, one per device", () => {
  const auth = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "adminAuth.js"), "utf8");
  const cfg = fs.readFileSync(path.join(__dirname, "..", "src", "config.js"), "utf8");
  assert.match(cfg, /adminSessionDays: 400,/);
  assert.match(auth, /if \(age > config\.adminSessionRenewHours \* 3600\) issueSession\(res, admin, \{ authAt: claims\.authAt, sid: claims\.sid \}\);/);
  assert.match(auth, /await AdminUser\.updateOne\(\{ _id: admin\._id \}, \{ \$pull: \{ sessions: \{ sid \} \} \}\);/);
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "auth.js"), "utf8");
  assert.match(routes, /await endSession\(req\.admin, req\.sessionId\);/);
});
