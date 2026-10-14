import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("N016b: the till's table detail and its settle target are a live query, not a snapshot", () => {
  const page = src("pages/Tables.jsx");
  // Under the "tables" prefix, so every table socket event refetches it.
  assert.match(
    page,
    /useQuery\(\{\s*queryKey: \["tables", "session", sessionData\?\._id\],\s*queryFn: \(\) => getTableSessionById\(sessionData\._id\),\s*enabled: Boolean\(sessionData\?\._id\),\s*\}\)/,
  );
  assert.match(page, /const liveSession = detailRes\?\.data\?\.data \|\| sessionData;/);
  assert.match(page, /session=\{liveSession\}\s*onComplete=\{\(\) => setSettleTarget\(\{ table: sessionTable, session: liveSession \}\)\}/);
  assert.doesNotMatch(page, /session=\{sessionData\}/);
});

test("N017: a guest's dish the till has not accepted reads 'Awaiting approval'", () => {
  const modal = src("components/tables/SessionDetailModal.jsx");
  assert.match(modal, /const awaiting = item\.status === "pending" && item\.addedBy === "QR";/);
  assert.match(modal, /awaiting \? \(\s*<span[^>]*>Awaiting approval<\/span>/);
  // The running total is the server's bill, which leaves those dishes out; no client sum.
  assert.match(modal, /session\?\.bills\?\.totalWithTax/);
  assert.doesNotMatch(modal, /\.reduce\(/);
});
