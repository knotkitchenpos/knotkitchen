import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const bcrypt = require("bcryptjs");
const { setPassword } = require("../server/reset-password.js");

const tmpDb = (agents) => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kkreset-")), "database.json");
  fs.writeFileSync(p, JSON.stringify({ agents, agreements: { keep: { id: "keep" } } }));
  return p;
};

test("reset-password stores only a bcrypt hash, for the named user, and touches nothing else", () => {
  const p = tmpDb([
    { username: "Owner.One", password: "old-hash", role: "admin", enabled: false },
    { username: "agent.two", password: "untouched", role: "agent", enabled: true },
  ]);
  assert.equal(setPassword(p, "owner.one", "  a-new-passphrase  "), "Owner.One");
  const db = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.match(db.agents[0].password, /^\$2[aby]\$12\$/);
  assert.ok(bcrypt.compareSync("a-new-passphrase", db.agents[0].password), "trimmed, as the login trims");
  assert.equal(db.agents[0].enabled, true, "a locked-out admin can get back in");
  assert.equal(db.agents[1].password, "untouched");
  assert.deepEqual(db.agreements, { keep: { id: "keep" } });
  assert.ok(!fs.readFileSync(p, "utf8").includes("a-new-passphrase"), "never the password itself");
});

test("reset-password refuses a short password and an unknown user", () => {
  const p = tmpDb([{ username: "owner.one", password: "x", role: "admin", enabled: true }]);
  assert.throws(() => setPassword(p, "owner.one", "short"), /at least 8/);
  assert.throws(() => setPassword(p, "nobody", "long-enough-pass"), /No user "nobody"\. Users: owner\.one/);
});

test("the password can only be typed, never passed on the command line", () => {
  const src = fs.readFileSync(new URL("../server/reset-password.js", import.meta.url), "utf8");
  assert.match(src, /process\.argv\.length > 3/);
  assert.match(src, /setRawMode\(true\)/);
});
