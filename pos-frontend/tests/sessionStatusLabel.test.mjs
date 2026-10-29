import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// "PAYMENT_PENDING" was shown as the server's code and ran out of its box on
// a phone (owner, 2026-10-29). The table session shows words, and wraps.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modal = fs.readFileSync(path.join(__dirname, "..", "src/components/tables/SessionDetailModal.jsx"), "utf8");

test("every session status has a label, and the status box wraps rather than overflows", () => {
  const model = fs.readFileSync(path.join(__dirname, "..", "..", "pos-backend/models/tableSessionModel.js"), "utf8");
  const statuses = /enum: \["OPEN", [^\]]+\]/.exec(model)[0].match(/"([A-Z_]+)"/g).map((s) => s.slice(1, -1));
  for (const s of statuses) assert.match(modal, new RegExp(`${s}: "[A-Z][a-z ]+"`), `${s} has a label`);
  assert.match(modal, /PAYMENT_PENDING: "Payment pending"/);
  assert.match(modal, /\{statusLabel\[session\?\.status\] \|\| session\?\.status \|\| "No active order"\}/);
  assert.match(modal, /leading-tight break-words/);
});
