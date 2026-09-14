import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("a locked restaurant is sent to Billing from every screen, and warned before", () => {
  const app = SRC("src/App.jsx");
  assert.match(app, /useAccountLock\(/);
  assert.match(app, /lock\.locked \? <LockRedirect \/> : null/);
  assert.match(app, /<AccountLockBanner \{\.\.\.lock\} \/>/);

  const gate = SRC("src/components/shared/AccountLock.jsx");
  assert.match(gate, /LOCK_OPEN_PATHS = \["\/settings\/billing", "\/auth", "\/impersonate"\]/);
  assert.match(gate, /<Navigate to="\/settings\/billing" replace \/>/);
  assert.match(gate, /Sign out/, "a locked user can still leave");

  // A refused call triggers an immediate re-check rather than waiting a minute.
  assert.match(SRC("src/https/axiosWrapper.js"), /ACCOUNT_LOCKED[\s\S]*kk:account-locked/);
});
