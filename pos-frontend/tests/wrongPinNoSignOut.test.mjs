import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// QA walkthrough, 2026-11-18: a wrong Security PIN is a 401, and the POS took
// every 401 for an expired session: it refreshed and sent the PIN again, so one
// typo counted twice toward the 5-try lockout. In Partners every 401 signed the
// owner out, so "Link a store" with a wrong password reloaded the page and the
// error was never seen.

test("a wrong PIN is marked WRONG_PIN on every PIN check", () => {
  const rc = SRC("../pos-backend/controllers/restaurantController.js");
  for (const msg of ["Invalid Security PIN.", "Current PIN is invalid.", "PIN verification required to update Store Properties."]) {
    assert.match(rc, new RegExp(`createHttpError\\(401, "${msg.replace(/\./g, "\\.")}", \\{ code: "WRONG_PIN" \\}\\)`), msg);
  }
  const ws = SRC("../pos-backend/controllers/websiteSettingsController.js");
  assert.doesNotMatch(ws, /createHttpError\(401, GATEWAY_PIN_MESSAGE\)/, "gateway PIN refusal carries its code");
});

test("the POS does not refresh the session and resend on a wrong PIN", () => {
  const ax = SRC("src/https/axiosWrapper.js");
  assert.match(ax, /const wrongPin = error\.response\?\.data\?\.code === "WRONG_PIN";/);
  assert.match(ax, /status === 401 && originalRequest && !originalRequest\._retry && !isAuthEndpoint && !wrongPin/);
});

test("Partners signs out only when the Partners session itself ended", () => {
  const ax = SRC("src/https/axiosWrapper.js");
  assert.match(ax, /status === 401 && error\.response\?\.data\?\.code === "PARTNER_SIGNED_OUT"\) partnersSignedOut\(\)/);
  assert.doesNotMatch(ax, /if \(error\.response\?\.status === 401\) partnersSignedOut\(\);/);
});
