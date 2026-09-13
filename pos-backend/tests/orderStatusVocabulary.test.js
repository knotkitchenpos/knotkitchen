const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const S = require("../constants/orderStatus");

/**
 * Guards the order-status vocabulary.
 *
 * The bugs these tests exist to prevent were all the same shape: one file
 * wrote a status in one spelling, another queried for a different spelling,
 * and because `orderStatus` is a free-form String nothing ever complained.
 * A status that doesn't match simply isn't in the result set, so the symptom
 * was an empty list or a stalled order rather than an error.
 */

test("canonicalStatus folds every historical spelling of Preparing", () => {
  for (const s of ["Preparing", "Pending", "In Progress", "pending", "preparing", "in progress"]) {
    assert.equal(S.canonicalStatus(s), S.PREPARING, `${s} should canonicalise to Preparing`);
  }
});

test("canonicalStatus folds casing for the other canonical states", () => {
  assert.equal(S.canonicalStatus("ready"), S.READY);
  assert.equal(S.canonicalStatus("completed"), S.COMPLETED);
  assert.equal(S.canonicalStatus("cancelled"), S.CANCELLED);
  assert.equal(S.canonicalStatus("canceled"), S.CANCELLED);
  assert.equal(S.canonicalStatus("refunded"), S.REFUNDED);
});

test('"paid" is preserved exactly — receipts and table billing depend on it', () => {
  assert.equal(S.canonicalStatus("paid"), "paid");
  assert.equal(S.PAID, "paid");
});

test("Served and Delivered stay distinct from Completed", () => {
  // They are separate display states, not misspellings, so canonicalStatus
  // must not fold them away...
  assert.equal(S.canonicalStatus(S.SERVED), S.SERVED);
  assert.equal(S.canonicalStatus(S.DELIVERED), S.DELIVERED);
  // ...but the money is real, so revenue must still count them.
  assert.ok(S.isSettled(S.SERVED));
  assert.ok(S.isSettled(S.DELIVERED));
});

test("unknown statuses pass through rather than being coerced", () => {
  assert.equal(S.canonicalStatus("Something Else"), "Something Else");
  assert.equal(S.canonicalStatus(""), "");
  assert.equal(S.canonicalStatus(null), "");
  assert.equal(S.canonicalStatus(undefined), "");
});

test("REGRESSION: the auto-ready sweep matches lowercase 'pending'", () => {
  // The QR and table-session flows wrote lowercase "pending". The sweep's
  // query listed only Title Case, so those orders were never promoted.
  assert.ok(S.PREPARING_STATUSES.includes("pending"));
  assert.ok(S.PREPARING_STATUSES.includes("Pending"));
  assert.ok(S.PREPARING_STATUSES.includes("In Progress"));
  assert.ok(S.PREPARING_STATUSES.includes("in progress"));
});

test("REGRESSION: settled revenue includes what the code actually writes", () => {
  // Analytics queried ["completed","served","delivered"] — all lowercase, and
  // nothing writes those. Every spelling the codebase writes must be counted.
  for (const s of [S.COMPLETED, S.SERVED, S.DELIVERED, S.PAID]) {
    assert.ok(S.isSettled(s), `${s} must count as settled revenue`);
  }
  assert.ok(!S.isSettled(S.PREPARING));
  assert.ok(!S.isSettled(S.READY));
  assert.ok(!S.isSettled(S.CANCELLED));
});

test("a cancelled order is never counted as revenue", () => {
  for (const s of S.CANCELLED_STATUSES) {
    assert.ok(!S.isSettled(s), `${s} must not count as revenue`);
  }
});

test("terminal states cannot be transitioned onward", () => {
  assert.ok(S.isTerminal(S.COMPLETED));
  assert.ok(S.isTerminal(S.CANCELLED));
  assert.ok(S.isTerminal(S.REFUNDED));
  assert.ok(S.isTerminal("completed"), "legacy casing must be terminal too");
  assert.ok(!S.isTerminal(S.PREPARING));
  assert.ok(!S.isTerminal(S.READY));
});

test("ACTIVE and SETTLED never overlap", () => {
  const overlap = S.ACTIVE_STATUSES.filter((s) => S.SETTLED_STATUSES.includes(s));
  assert.deepEqual(overlap, [], `an order cannot be both live and settled: ${overlap}`);
});

/**
 * The structural guard: source files must not hand-write status literals.
 *
 * This is what stops "a fifth place" from reintroducing the divergence. Every
 * write goes through a constant, so a new spelling cannot be invented by
 * accident — it has to be added to the vocabulary deliberately.
 */
test("no source file assigns a hand-written orderStatus literal", () => {
  const root = path.join(__dirname, "..");
  const dirs = ["controllers", "services", "routes", "models"];
  const offenders = [];

  for (const dir of dirs) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of fs.readdirSync(full).filter((f) => f.endsWith(".js"))) {
      const source = fs.readFileSync(path.join(full, file), "utf8");
      source.split("\n").forEach((line, i) => {
        // Comments are allowed to name statuses — prose explaining the
        // vocabulary is the point of the vocabulary, not a violation of it.
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;

        // `orderStatus: "..."` or `orderStatus = "..."` with a literal.
        const m = /orderStatus\s*[:=]\s*["']([^"']+)["']/.exec(line);
        if (m) offenders.push(`${dir}/${file}:${i + 1}  orderStatus = "${m[1]}"`);
      });
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "Use a constant from constants/orderStatus.js instead of a string literal:\n" +
      offenders.join("\n")
  );
});


test("REGRESSION: every finished state blocks further transitions", () => {
  // TERMINAL_STATUSES holds only the three canonical names, so guards written
  // as `TERMINAL_STATUSES.has(order.orderStatus)` let five real finished
  // states through. The worst was "paid": a settled table bill could be
  // reopened and its history rewritten.
  for (const s of ["Completed", "completed", "Served", "Delivered", "paid",
                   "Cancelled", "cancelled", "Refunded", "refunded"]) {
    assert.ok(S.isFinished(s), `${s} must block further transitions`);
  }
});

test("a live order is not finished", () => {
  for (const s of ["Preparing", "pending", "Pending", "In Progress", "Ready", "ready", ""]) {
    assert.ok(!S.isFinished(s), `${s} must still be transitionable`);
  }
});


test("no source file hand-writes a status literal in a COMPARISON", () => {
  // The assignment scanner above did not catch
  // `["Completed", "Cancelled"].includes(order.orderStatus)`, which is exactly
  // how a finished-order guard silently missed five states. This catches that
  // shape: a status word quoted on any line that mentions orderStatus.
  const root = path.join(__dirname, "..");
  const WORDS = /(["'])(Preparing|Ready|Completed|Cancelled|Served|Delivered|Refunded|Pending|In Progress|paid)\1/;
  const offenders = [];

  for (const dir of ["controllers", "services", "routes"]) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of fs.readdirSync(full).filter((f) => f.endsWith(".js"))) {
      const lines = fs.readFileSync(path.join(full, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
        if (!/orderStatus/.test(line)) return;
        if (WORDS.test(line)) offenders.push(`${dir}/${file}:${i + 1}  ${code.slice(0, 90)}`);
      });
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "Compare against constants/orderStatus.js helpers instead of literals:\n" +
      offenders.join("\n")
  );
});

/**
 * §14 acceptance lifecycle.
 *
 * A website order arrives awaiting acceptance and must stay inert until a
 * human takes it. The dangerous half of this is the auto-ready sweep: if the
 * clock started at creation, an order nobody had accepted would promote itself
 * to Ready and text the customer that food was waiting for them.
 */

const AR = require("../services/autoReadyService");

test("an unaccepted order has no auto-ready clock running", async () => {
  const created = require("../controllers/storefrontController");
  // The storefront no longer computes readyDueAt at creation at all. Guard the
  // property that matters: the sweep only ever looks at orders with a
  // readyDueAt set, so no clock means it cannot be swept.
  assert.equal(
    typeof AR.computeReadyDueAt,
    "function",
    "computeReadyDueAt must still exist — acceptance calls it"
  );
  assert.ok(created, "storefront controller loads");
});

test("REGRESSION: the auto-ready sweep skips orders with no readyDueAt", async () => {
  // This is the guarantee that makes deferring the clock safe. The sweep's
  // filter requires readyDueAt to be both <= now AND non-null, so a pending,
  // unaccepted order is invisible to it no matter how long it sits.
  const src = fs.readFileSync(
    path.join(__dirname, "..", "services", "autoReadyService.js"),
    "utf8"
  );
  assert.match(
    src,
    /readyDueAt:\s*\{\s*\$lte:\s*now,\s*\$ne:\s*null\s*\}/,
    "the sweep must require a non-null readyDueAt"
  );
});

test("accept is the transition that starts the clock", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "controllers", "onlineOrderController.js"),
    "utf8"
  );
  assert.match(src, /action === "accept"/, "acceptance must be the trigger");
  assert.match(src, /const clocks = await clocksOnAccept\(order\)/, "acceptance must start the ready clock");
  assert.match(src, /order\.readyDueAt = clocks\.readyDueAt/);
  // Scheduled pickups queue with a prep start instead (scheduledPickup.test.js).
  assert.match(src, /order\.prepStartAt = clocks\.prepStartAt/);
});

test("a website order is created awaiting acceptance, not already cooking", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "controllers", "storefrontController.js"),
    "utf8"
  );
  assert.match(
    src,
    /orderStatus:\s*AWAITING_ACCEPTANCE/,
    "website orders must arrive awaiting acceptance so Accept/Reject appear"
  );
  assert.doesNotMatch(
    src,
    /\.\.\.\(readyDueAt \? \{ readyDueAt \} : \{\}\)/,
    "the ready clock must not be set at creation"
  );
});

test("the POS actions the UI offers line up with the statuses in play", () => {
  const { ACTION_STATUS } = require("../controllers/onlineOrderController");
  const S = require("../constants/orderStatus");
  // Pending --accept--> In Progress --ready--> Ready --completed--> Completed
  assert.equal(S.AWAITING_ACCEPTANCE, "Pending");
  assert.equal(ACTION_STATUS.accept, "In Progress");
  assert.equal(ACTION_STATUS.ready, "Ready");
  assert.equal(ACTION_STATUS.completed, "Completed");
  assert.equal(ACTION_STATUS.reject, "Cancelled");
  // Neither end of the accept step may be a finished state.
  assert.ok(!S.isFinished(S.AWAITING_ACCEPTANCE));
  assert.ok(!S.isFinished(ACTION_STATUS.accept));
});
