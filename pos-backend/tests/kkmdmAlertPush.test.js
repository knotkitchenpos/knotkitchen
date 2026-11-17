const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { LABEL } = require("../services/kkmdmAlertPush");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

/** Owner, 2026-11-17: KKMDM alerts reach CSD staff phones, once each. */
test("each new KKMDM alert is claimed before it is pushed, to Device management staff only", () => {
  const s = src("services/kkmdmAlertPush.js");
  assert.match(s, /\{ status: "open", notified: \{ \$ne: MARK \}, openedAt: \{ \$gte: new Date\(now\.getTime\(\) - LOOKBACK_MS\) \} \},\n\s+\{ \$addToSet: \{ notified: MARK \} \}/);
  assert.match(s, /\{ section: "devices" \}/);
  assert.match(s, /url: "\/mdm\/alerts"/);
  assert.equal(LABEL.pos_outdated, "POS out of date");
  // Only the scheduler process runs it (pos-api-2 has RUN_SCHEDULERS=false), started with the others.
  const app = src("app.js");
  assert.ok(app.indexOf('require("./services/kkmdmAlertPush").startKkmdmAlertPush();') > app.indexOf("if (runSchedulers) try {"));
});
