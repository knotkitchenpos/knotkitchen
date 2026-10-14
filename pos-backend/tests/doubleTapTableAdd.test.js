const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const { runWithSessionRetry } = require("../controllers/tableSessionController");

/**
 * N013. Two taps on Add to Order / Complete Order run two transactions on one
 * table session; the loser got MongoDB's WriteConflict (112), which was only
 * retried for E11000 and so reached the till as "Internal server error". The
 * rerun finds the winner's round under the same key and answers with it.
 */
test("a double tap's write conflict is run again, not a 500", async () => {
  const real = mongoose.startSession;
  mongoose.startSession = async () => ({ startTransaction() {}, async commitTransaction() {}, async abortTransaction() {}, endSession() {} });
  try {
    let runs = 0;
    const { result } = await runWithSessionRetry(async () => {
      runs += 1;
      if (runs === 1) {
        const err = Object.assign(new Error("Write conflict during plan execution"), { code: 112 });
        err.hasErrorLabel = (l) => l === "TransientTransactionError";
        throw err;
      }
      return "replayed";
    });
    assert.equal(result, "replayed");
  } finally {
    mongoose.startSession = real;
  }
});

test("an unkeyed till round (older app) is not rerun on a clash, so a double tap cannot add it twice", async () => {
  const real = mongoose.startSession;
  mongoose.startSession = async () => ({ startTransaction() {}, async commitTransaction() {}, async abortTransaction() {}, endSession() {} });
  try {
    let runs = 0;
    await assert.rejects(
      runWithSessionRetry(async () => { runs += 1; throw Object.assign(new Error("Write conflict"), { code: 112 }); }, { retryConflicts: false }),
      { code: 112 },
    );
    assert.equal(runs, 1);
  } finally {
    mongoose.startSession = real;
  }
  const ctrl = fs.readFileSync(path.join(__dirname, "..", "controllers", "tableSessionController.js"), "utf8");
  assert.equal((ctrl.match(/\{ retryConflicts: Boolean\(req\.body\?\.idempotencyKey\) \}/g) || []).length, 2);
});

test("both table add endpoints replay a key already on the session, and settle replays legacy-safe", () => {
  const ctrl = fs.readFileSync(path.join(__dirname, "..", "controllers", "tableSessionController.js"), "utf8");
  assert.equal((ctrl.match(/i\.requestId === key\)\) return \{ session, replay: true \}/g) || []).length, 2);
  // A legacy payment entry with no key must not throw on the replay match.
  assert.match(ctrl, /const k = String\(p\.idempotencyKey \|\| ""\);/);
  assert.match(ctrl, /\(k === idempotencyKey \|\| k\.startsWith\(`\$\{idempotencyKey\}-`\)\) && p\.status === "PAID"/);
});

test("a QR add that still clashes is a retryable 503, not the 409 that ends the diner's session", () => {
  const qr = fs.readFileSync(path.join(__dirname, "..", "controllers", "qrController.js"), "utf8");
  assert.match(qr, /err\.code === 112 \|\| err\.name === "VersionError"[^\n]*\n\s*return res\.status\(503\)/);
});

test("REGRESSION N013: a QR round is not rerun on a clash (each tap has a fresh requestId), so a double tap cannot add it twice", () => {
  const qr = fs.readFileSync(path.join(__dirname, "..", "controllers", "qrController.js"), "utf8");
  const fn = qr.slice(qr.indexOf("const addSessionItems"), qr.indexOf("placed.duplicate"));
  assert.match(fn, /\}, \{ retryConflicts: false \}\)\)\.result,/);
});
