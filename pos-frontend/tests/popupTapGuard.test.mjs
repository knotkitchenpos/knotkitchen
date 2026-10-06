import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/**
 * A live alert opens wherever the till's next tap is about to land, and the
 * next queued card opens in the same spot the moment one is decided. Every
 * action button was live on the first frame, so a tap aimed at the till (or a
 * double tap on Accept) acted on a card nobody had read.
 */

// popup -> the handlers that must swallow taps until the card is armed
const POPUPS = {
  NewOrderPopup: ["const decide = async (action) => {"],
  AddedItemsPopup: ["const decide = async (action, itemIds) => {", "const cancelWholeOrder = () => {"],
  WaiterCallPopup: ["const acknowledge = async (call) => {"],
  PrepDuePopup: ["const start = async (order) => {"],
  TableBookingPopup: [
    "const startAccept = async (booking) => {",
    "const confirmAccept = async () => {",
    "const cancel = async (booking) => {",
  ],
};

test("new alert cards ignore taps for 500 ms", () => {
  const hook = SRC("src/hooks/useArmed.js");
  assert.match(hook, /export default function useArmed\(key, ms = 500\)/);
  // Armed only for the key it timed: a new card is disarmed on its first frame.
  assert.match(hook, /return armedFor === key;/);

  for (const [name, handlers] of Object.entries(POPUPS)) {
    const src = SRC(`src/components/dashboard/${name}.jsx`);
    assert.match(src, /import useArmed from "\.\.\/\.\.\/hooks\/useArmed";/, `${name} imports useArmed`);
    // A hook below the early `return null` breaks the rules of hooks.
    const hookAt = src.indexOf("useArmed(");
    const earlyReturn = src.search(/\n {2}if \([^\n]*\) return null;/);
    assert.ok(hookAt > 0 && hookAt < earlyReturn, `${name} calls useArmed above its early return`);
    for (const h of handlers) {
      const at = src.indexOf(h);
      assert.ok(at > 0, `${name}: ${h}`);
      assert.match(src.slice(at + h.length, at + h.length + 40), /^\s*if \(!armed\) return;/, `${name}: ${h} is guarded`);
    }
  }
});

test("the View in Orders link and the item ticks are guarded too", () => {
  const popup = SRC("src/components/dashboard/NewOrderPopup.jsx");
  assert.match(popup, /if \(!armed\) return;\s*drop\(current\.orderId\);\s*navigate\("\/orders"\);/);
  const added = SRC("src/components/dashboard/AddedItemsPopup.jsx");
  assert.match(added, /onChange=\{\(e\) => \{\s*if \(!armed\) return;/);
});
