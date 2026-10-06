import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as S from "../src/constants/orderStatus.js";

const SRC = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("REGRESSION: a finished order's timer stops and goes grey", () => {
  // Paid, served and cancelled orders kept counting from createdAt and turned red.
  const page = SRC("src/pages/Orders.jsx");
  assert.match(page, /const minsAgo = \(d, end = Date\.now\(\)\) =>/);
  assert.match(page, /const done = isFinished\(o\.orderStatus\);/);
  assert.match(page, /minsAgo\(o\.createdAt, done \? \(o\.completedAt \|\| o\.cancelledAt \|\| o\.updatedAt\) : undefined\)/);
  assert.match(page, /const ring = done \? "#94A3B8" :/);
});

test("a delivery goes Ready → Out for delivery → Delivered", () => {
  assert.equal(S.OUT_FOR_DELIVERY, "Out for delivery");
  for (const s of ["Out for delivery", "dispatched"]) {
    assert.ok(S.isOutForDelivery(s) && S.isActive(s) && !S.isFinished(s), s);
  }
  assert.equal(S.statusLabel("dispatched"), "Out for delivery");

  const page = SRC("src/pages/Orders.jsx");
  assert.match(page, /\{ key: "Out for delivery", statuses: \[OUT_FOR_DELIVERY\] \}/);
  // Ready delivery offers Out for delivery; out for delivery offers Delivered.
  assert.match(page, /isReady\(selected\.orderStatus\) && String\(selected\.orderType\)\.toLowerCase\(\) === "delivery" \? \(/);
  assert.match(page, /statusMutation\.mutate\(\{ orderId: selected\._id, orderStatus: OUT_FOR_DELIVERY \}\)/);
  assert.match(page, /isOutForDelivery\(selected\.orderStatus\) \? \(/);
  assert.match(page, /statusMutation\.mutate\(\{ orderId: selected\._id, orderStatus: DELIVERED \}\)/);
});

test("the UI's Out for delivery matches the backend's", async () => {
  const backend = await import("../../pos-backend/constants/orderStatus.js").then((m) => m.default || m);
  assert.equal(S.OUT_FOR_DELIVERY, backend.OUT_FOR_DELIVERY);
});

test("manual Print and KOT say they are printing and whether it went", () => {
  const page = SRC("src/pages/Orders.jsx");
  assert.match(page, /printWithFeedback\("receipt", \(\) => printOrderReceipt\(selected\)\)/);
  assert.match(page, /printWithFeedback\("KOT", \(\) => printKot\(selected\)\)/);
});

test("REGRESSION: a tip shows on the order and in Reports and the Z report", () => {
  const page = SRC("src/pages/Orders.jsx");
  assert.match(page, /Number\(selected\.bills\?\.tip \|\| selected\.tips\) > 0 && \(/);
  assert.match(page, /<span className="text-\[#475569\]">Tip<\/span>/);
  const shift = SRC("src/components/settings/ShiftView.jsx");
  assert.match(shift, /money\(s\?\.cashTips\)/, "drawer table");
  assert.match(shift, /row\("Cash tips", money\(s\.cashTips\)\)/, "Z report");
  assert.match(shift, /\["card", "Card", true\]/);
});

test("REGRESSION: the payment cards add up to Total, and the label matches the card", () => {
  const reports = SRC("src/pages/Reports.jsx");
  for (const [key, label] of [["card", "Card Orders"], ["split", "Split Payments"], ["other", "Unpaid / Other"], ["tips", "Tips"]]) {
    assert.match(reports, new RegExp(`\\{ key: "${key}", label: "${label.replace("/", "\\/")}"`), key);
  }
  assert.match(reports, /<DetailRow label="Payment Method" value=\{order\.paymentLabel \|\| "—"\} \/>/);
});

test("REGRESSION: dish and category tables reconcile to Total; legacy lines are not doubled", () => {
  const reports = SRC("src/pages/Reports.jsx");
  assert.match(reports, /\.\.\.\(breakdown\.adjustments \|\| \[\]\)\.map\(\(a\) => \(\{ \.\.\.a, quantity: "" \}\)\)/);
  assert.match(reports, /\{ name: "Total", quantity: "", amount: s\.total\?\.amount \}/);
  assert.equal((reports.match(/reconciles: true/g) || []).length, 2, "byItem and byCategory only");
  // A legacy POS line has total 0 and the line total in price; price × qty doubled it.
  assert.match(reports, /money\(resolveItemAmounts\(it\)\.lineTotal\)/);
  assert.doesNotMatch(reports, /it\.price \* it\.quantity/);
});

test("REGRESSION: a period over 1,000 orders says the list is cut, not the totals", () => {
  const reports = SRC("src/pages/Reports.jsx");
  assert.match(reports, /const truncated = Boolean\(data\?\.data\?\.data\?\.truncated\);/);
  assert.match(reports, /the totals above count all of them/);
});
