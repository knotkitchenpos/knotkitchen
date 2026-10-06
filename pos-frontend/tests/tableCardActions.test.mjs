import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("Delete sits alone on the left of a table card, away from QR and Edit", () => {
  const page = src("pages/Tables.jsx");
  const del = page.indexOf('title="Delete Table"');
  const qr = page.indexOf('title="View QR Code"');
  assert.ok(del > 0 && del < qr, "Delete comes first, in its own corner");
  const group = page.indexOf('<div className="flex gap-1.5 pointer-events-auto">');
  assert.ok(del < group && group < qr, "QR and Edit are grouped on the right");
  // The row spans the card, so it must let taps through to the table name.
  assert.match(page, /absolute top-2 left-2 right-2 z-20 flex justify-between pointer-events-none/);
  assert.doesNotMatch(page, /\[@media\(hover:none\)\]:justify-end/);
});

test("GET /api/table/:id is read as { table, activeSession }", () => {
  const page = src("pages/Tables.jsx");
  // Seating: the table's own id and capacity, and the head count goes with it.
  const seat = page.slice(page.indexOf("const handleConfirmGuestCount"), page.indexOf("// Filters"));
  assert.match(seat, /const \{ table: fullTable = table, activeSession \} = res\?\.data\?\.data \|\| \{\};/);
  assert.match(seat, /tableId: fullTable\._id/);
  assert.match(seat, /activeSessionId: activeSession\?\._id/);
  assert.match(seat, /guests: Number\(guests\)/);
  assert.doesNotMatch(seat, /const fullTable = res\?\.data\?\.data/);
  // Session detail with no session id on the row: the session is in the same answer.
  const detail = page.slice(page.indexOf("const openSessionDetail"), page.indexOf("const handleTableClick"));
  assert.match(detail, /setSessionData\(res\?\.data\?\.data\?\.activeSession \|\| null\)/);
});

test("Cancel on the reason box does not void the dish", () => {
  const page = src("pages/Tables.jsx");
  const fn = page.slice(page.indexOf("const handleCancelSessionItem"), page.indexOf("const releaseMut"));
  assert.match(fn, /if \(raw === null\) return;/);
  assert.doesNotMatch(fn, /window\.prompt\([^)]*\) \|\| ""/);
});

test("Release Table only shows when no dish is left on the bill", () => {
  const modal = src("components/tables/SessionDetailModal.jsx");
  assert.match(modal, /onRelease && !\(session\?\.items \|\| \[\]\)\.some\(\(i\) => i\.status !== "cancelled"\)/);
});

test("the API wrappers the table and checkout screens build on", () => {
  const api = src("https/index.js");
  assert.match(api, /export const setTableDiscount = \(sessionId, data\) =>\s*axiosWrapper\.post\(`\/api\/table-session\/\$\{sessionId\}\/discount`, data\)/);
  assert.match(api, /addOrder = \(data, key\) =>\s*axiosWrapper\.post\("\/api\/order\/", data, key \? \{ headers: \{ "Idempotency-Key": key \} \} : undefined\)/);
  // The KDS reads the orders themselves now (decision 3).
  assert.doesNotMatch(api, /\/api\/kds|getKDSOrders|updateKDSItemStatus|updateKDSOrderStatus/);
});
