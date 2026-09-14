import test from "node:test";
import assert from "node:assert";
import { buildQuickDates } from "../src/utils/quickDates.js";

const NOW = new Date(2026, 8, 14, 15, 0); // 14 Sep 2026
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("REGRESSION: after picking a past day, Today is still on the strip", () => {
  for (const picked of ["2026-09-10", "2026-08-01", "2025-12-25"]) {
    const days = buildQuickDates(picked, NOW).map(key);
    assert.equal(days.at(-1), "2026-09-14", `Today must stay the last chip after picking ${picked}`);
    assert.ok(days.includes(picked), `${picked} must be on the strip`);
  }
});

test("the strip shows at least two weeks and no future dates", () => {
  const days = buildQuickDates("2026-09-14", NOW).map(key);
  assert.equal(days.length, 15);
  assert.equal(days[0], "2026-08-31");
  assert.equal(buildQuickDates(undefined, NOW).map(key).at(-1), "2026-09-14");
});
