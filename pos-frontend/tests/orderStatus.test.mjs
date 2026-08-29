import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as S from "../src/constants/orderStatus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "..", "src");

/**
 * Guards the POS UI's order-status vocabulary.
 *
 * These failures are all silent: a status that doesn't match an equality check
 * simply isn't counted, so the symptom is a wrong total or a missing badge
 * rather than an error. That is why they survived so long.
 */

test("REGRESSION: 'done' counts every settled order, not just Completed", () => {
  // A realistic day: two finished by the auto-complete sweep, one settled
  // table bill, one cancelled, one still cooking.
  const orders = [
    { orderStatus: "Completed", amt: 100 },
    { orderStatus: "Served", amt: 200 },
    { orderStatus: "Delivered", amt: 300 },
    { orderStatus: "paid", amt: 400 },
    { orderStatus: "Cancelled", amt: 500 },
    { orderStatus: "Preparing", amt: 600 },
  ];

  let done = 0, ongoing = 0, cancelled = 0, revenue = 0;
  for (const o of orders) {
    if (!S.isCancelled(o.orderStatus)) revenue += o.amt;
    if (S.isSettled(o.orderStatus)) done += 1;
    else if (S.isCancelled(o.orderStatus)) cancelled += 1;
    else ongoing += 1;
  }

  // The old code was `=== "Completed"`, which reported done:1 / ongoing:4 —
  // three finished orders counted as still in the kitchen.
  assert.equal(done, 4, "all four settled orders are done");
  assert.equal(ongoing, 1, "only the one still cooking is ongoing");
  assert.equal(cancelled, 1);
  assert.equal(revenue, 1600, "revenue excludes only the cancelled order");
});

test("awaiting acceptance stays distinct from cooking", () => {
  // Collapsing these two is what made the Accept / Reject buttons vanish.
  assert.ok(S.isAwaitingAcceptance("Pending"));
  assert.ok(!S.isAwaitingAcceptance("In Progress"));
  assert.ok(!S.isAwaitingAcceptance("Preparing"));
  // ...while "Pending" is still a kitchen state in the plain order list.
  assert.ok(S.isPreparing("Pending"));
  assert.equal(S.statusLabel("Pending"), "Pending");
});

test("labels keep meaning that 'Completed' would throw away", () => {
  assert.equal(S.statusLabel("Served"), "Served");
  assert.equal(S.statusLabel("Delivered"), "Delivered");
  assert.equal(S.statusLabel("paid"), "Paid");
  assert.equal(S.statusLabel("cancelled"), "Cancelled");
  assert.equal(S.statusLabel("in progress"), "Preparing");
  assert.equal(S.statusLabel("Weird"), "Weird", "unknown passes through");
  assert.equal(S.statusLabel(""), "");
  assert.equal(S.statusLabel(null), "");
});

test("finished and active never overlap", () => {
  for (const s of ["Completed", "Served", "Delivered", "paid", "Cancelled", "Refunded"]) {
    assert.ok(S.isFinished(s) && !S.isActive(s), `${s} is finished, not active`);
  }
  for (const s of ["Pending", "Preparing", "In Progress", "Ready"]) {
    assert.ok(S.isActive(s) && !S.isFinished(s), `${s} is active, not finished`);
  }
});

test("the UI vocabulary matches the backend's", async () => {
  // The two files are separate by necessity (ESM UI, CJS server) but must not
  // drift: the server decides what is written, the UI decides what is shown.
  const backend = await import(
    "../../pos-backend/constants/orderStatus.js"
  ).then((m) => m.default || m);

  for (const name of ["PREPARING", "READY", "COMPLETED", "CANCELLED", "REFUNDED", "PAID", "SERVED", "DELIVERED", "AWAITING_ACCEPTANCE"]) {
    assert.equal(S[name], backend[name], `${name} must match the backend`);
  }

  for (const s of ["Completed", "completed", "Served", "Delivered", "paid", "Cancelled", "cancelled", "Refunded"]) {
    assert.equal(S.isFinished(s), backend.isFinished(s), `isFinished("${s}") must agree`);
    assert.equal(S.isSettled(s), backend.isSettled(s), `isSettled("${s}") must agree`);
  }
});

test("no component hand-writes a status literal", () => {
  // The same structural guard the backend has. Every comparison and every
  // write goes through the vocabulary, so a new spelling cannot be invented
  // by accident — it has to be added deliberately.
  const WORDS =
    /(["'])(Preparing|Ready|Completed|Cancelled|Served|Delivered|Pending|In Progress|paid)\1/;
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(jsx?|mjs)$/.test(entry.name)) continue;
      if (full.includes("orderStatus.js")) continue; // the vocabulary itself

      fs.readFileSync(full, "utf8").split("\n").forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
        if (!/orderStatus/.test(line)) return;
        if (WORDS.test(line)) {
          offenders.push(`${path.relative(SRC, full)}:${i + 1}  ${code.slice(0, 90)}`);
        }
      });
    }
  };
  walk(SRC);

  assert.deepEqual(
    offenders,
    [],
    "Use the helpers in src/constants/orderStatus.js instead of literals:\n" +
      offenders.join("\n")
  );
});
