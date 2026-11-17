const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { condition } = require("../src/lib/alerts");
const { ALERT_TYPES } = require("../src/models");

/** Owner, 2026-11-17: an "Outdated POS" alert rule, and one click to update every outdated tablet. */
test("pos_outdated fires only for a tablet that reports an older POS than the newest uploaded", () => {
  const rule = { type: "pos_outdated" };
  const now = new Date();
  assert.ok(ALERT_TYPES.includes("pos_outdated"));
  assert.match(condition(rule, { posVersionCode: 40, posVersion: "1.4.0" }, now, { posVersionCode: 42 }), /POS 1\.4\.0 is older than the latest \(42\)/);
  assert.equal(condition(rule, { posVersionCode: 42 }, now, { posVersionCode: 42 }), false, "up to date");
  assert.equal(condition(rule, { posVersionCode: null }, now, { posVersionCode: 42 }), false, "not reporting yet: no noise");
  assert.equal(condition(rule, { posVersionCode: 40 }, now, { posVersionCode: null }), false, "no POS uploaded");
});

test("wiring: notify results are added, not assigned (CSD's push mark survives); the update route is bulk-permissioned and re-authenticated", () => {
  const alerts = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "alerts.js"), "utf8");
  assert.match(alerts, /\$addToSet: \{ notified: \{ \$each: sent \} \}/);
  assert.doesNotMatch(alerts, /alert\.notified = await notify/);
  const devices = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "devices.js"), "utf8");
  assert.match(devices, /router\.post\("\/update-outdated", requirePerm\("fleet\.bulk"\), wrap\(async \(req, res\) => \{\n\s+checkCommandAllowed\(req, "install_app"\);\n\s+if \(!requireRecentAuth\(req\)\) throw new HttpError\(428, "reauth_required"\);/);
});
