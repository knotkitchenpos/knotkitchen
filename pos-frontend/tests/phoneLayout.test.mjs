import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
const events = [];
globalThis.window = { dispatchEvent: (e) => events.push(e) };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const { loadPhoneColumns, savePhoneColumns, gridLayout, PHONE_COLUMNS } = await import("../src/utils/phoneLayout.js");
const src = (f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

test("phone columns: 2 by default, 2/3/4 kept on the device, anything else falls back", () => {
  assert.equal(loadPhoneColumns(), 2);
  assert.equal(savePhoneColumns(4), 4);
  assert.equal(loadPhoneColumns(), 4);
  assert.equal(events.at(-1).type, "kk:phone-layout");
  assert.equal(savePhoneColumns(7), 2);
  assert.equal(loadPhoneColumns(), 2);
});

test("each layout sets the phone's columns and never fewer from sm up", () => {
  for (const n of PHONE_COLUMNS) {
    const { grid } = gridLayout(n);
    assert.match(grid, new RegExp(`(^| )grid-cols-${n}( |$)`));
    const sm = Number(grid.match(/sm:grid-cols-(\d)/)[1]);
    assert.ok(sm >= n, `${n} per row: sm shows ${sm}`);
  }
  // Denser rows: square photos and smaller type on a phone, the usual from sm.
  assert.match(gridLayout(4).image, /aspect-square sm:aspect-\[4\/3\]/);
  assert.match(gridLayout(4).name, /sm:text-\[12\.5px\]/);
});

test("the POS grid and Device Configuration use the layout and the Popular Items settings", () => {
  const panel = src("components/pos/ProductPanel.jsx");
  assert.match(panel, /className=\{`grid \$\{layout\.grid\}`\}/);
  assert.match(panel, /window\.addEventListener\(LAYOUT_EVENT, changed\)/);
  const dc = src("components/settings/DeviceConfiguration.jsx");
  assert.match(dc, /<PhoneLayoutCard \/>/);
  assert.match(dc, /<PopularItemsCard form=\{form\} patch=\{patch\} \/>/);
  assert.match(dc, /popularItemIds: form\.popularItemIds \|\| \[\]/);
  assert.match(dc, /queryKey: \["popular-items"\]/);
  const card = src("components/settings/PosScreenSettings.jsx");
  assert.match(card, /useHoldReorder\(\{ ids, onDrop: setIds \}\)/);
  // Typing a count is applied on leaving the box: "12" never stops at a clamped "1".
  assert.match(card, /value=\{draft \?\? count\}/);
  assert.match(card, /onBlur=\{applyDraft\}/);
  // The picker offers the published menu, the one the tills show.
  assert.match(card, /queryFn: loadSystemMenu/);
  // Other tills refresh their Popular Items when the settings are saved.
  assert.match(src("hooks/useRealtimeSync.js"), /"posSettings:updated": \["popular-items", "store-properties"\]/);
});
