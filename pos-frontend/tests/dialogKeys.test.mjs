// A3, A5 (POS dialogs), A2 (CSD form dialogs), A4 (website steppers).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const shell = SRC("src/components/pos/ModalShell.jsx");
// The key handler is plain JS inside the .jsx file: run it as is.
const dialogKeyDown = new Function(
  `${shell.slice(shell.indexOf("const FOCUSABLE"), shell.indexOf("/** Shared modal chrome"))}\nreturn dialogKeyDown;`,
)();

const btn = (n) => ({ n, focused: 0, focus() { this.focused += 1; } });
const ev = (key, root, shiftKey = false) => ({ key, shiftKey, currentTarget: root, prevented: 0, preventDefault() { this.prevented += 1; }, stopped: 0, stopPropagation() { this.stopped += 1; } });

test("Escape closes the dialog, and only the top one", () => {
  let closed = 0;
  const e = ev("Escape", null);
  dialogKeyDown(e, () => (closed += 1));
  assert.equal(closed, 1);
  assert.equal(e.stopped, 1, "a dialog over another must not close both");
});

test("Tab from the last control wraps to the first; Shift+Tab from the first to the last", () => {
  const a = btn("a"), b = btn("b");
  const root = { querySelectorAll: () => [a, b] };
  const t = ev("Tab", root);
  dialogKeyDown(t, null, b);
  assert.equal(t.prevented, 1); assert.equal(a.focused, 1);
  const s = ev("Tab", root, true);
  dialogKeyDown(s, null, a);
  assert.equal(s.prevented, 1); assert.equal(b.focused, 1);
  const mid = ev("Tab", root);
  dialogKeyDown(mid, null, a);
  assert.equal(mid.prevented, 0, "Tab between controls is left to the browser");
  const other = ev("Enter", root);
  dialogKeyDown(other, () => assert.fail("Enter must not close"), a);
  assert.equal(other.prevented, 0);
});

test("ModalShell is announced as a dialog, takes focus and gives it back", () => {
  assert.match(shell, /role="dialog"\s+aria-modal="true"\s+aria-labelledby=\{titleId\}\s+tabIndex=\{-1\}\s+onKeyDown=\{\(e\) => dialogKeyDown\(e, onClose\)\}/);
  assert.match(shell, /<h3 id=\{titleId\}/);
  // The opener is read before an autoFocus field takes focus, and refocused on close.
  assert.match(shell, /const \[opener\] = useState\(\(\) => document\.activeElement\);/);
  assert.match(shell, /if \(panel\.current && !panel\.current\.contains\(document\.activeElement\)\) panel\.current\.focus\(\);/);
  assert.match(shell, /return \(\) => opener\?\.focus\?\.\(\);/);
});

test("A5: the ModalShell subtitle is slate-500, readable on white", () => {
  assert.match(shell, /\{subtitle && <p className="text-\[12\.5px\] text-\[#64748B\] mt-1">/);
  assert.doesNotMatch(shell, /\{subtitle && <p[^>]*#94A3B8/);
});

test("A2: CSD form dialogs scroll instead of hiding their buttons on a short screen", () => {
  const csd = (p) => fs.readFileSync(new URL(`../../csd-web/src/${p}`, import.meta.url), "utf8");
  const detail = csd("pages/RestaurantDetail.jsx");
  for (const form of ["cancelSubscription", "adjustWallet", "saveGbp"]) {
    assert.match(detail, new RegExp(`<form onSubmit=\\{${form}\\} className="[^"]*max-h-full overflow-y-auto`), form);
  }
  for (const f of ["components/StoreDocuments.jsx", "pages/Chat.jsx"]) {
    assert.match(csd(f), /<div role="dialog" aria-modal="true" className="w-full max-w-md max-h-full overflow-y-auto/, f);
  }
});

test("A4: the website's quantity steppers are at least 40 px", () => {
  const cw = (p) => fs.readFileSync(new URL(`../../customer-web/src/components/${p}`, import.meta.url), "utf8");
  assert.equal((cw("CartDrawer.jsx").match(/className="px-2 py-1 min-w-\[40px\] min-h-\[40px\]"/g) || []).length, 2);
  assert.equal((cw("ProductCard.jsx").match(/className="h-full w-8 min-w-\[40px\] min-h-\[40px\] text-lg leading-none"/g) || []).length, 2);
});
