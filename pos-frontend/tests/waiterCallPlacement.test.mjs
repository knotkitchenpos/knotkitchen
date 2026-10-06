import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const POPUP = SRC("src/components/dashboard/WaiterCallPopup.jsx");

test("waiter alerts sit clear of the order-type tabs", () => {
  // Pinned top-right, one card covered the cart's Collection / Delivery /
  // Table tabs and two hid them completely.
  const cart = Number(SRC("src/components/pos/OrderPanel.jsx").match(/lg:w-\[(\d+)px\]/)?.[1]);
  const right = Number(POPUP.match(/lg:right-\[(\d+)px\]/)?.[1]);
  assert.ok(cart > 0, "OrderPanel's desktop width");
  assert.ok(right >= cart + 16, `desktop: left of the ${cart}px cart column (got right-[${right}px])`);

  // Phone: the 56px header plus the cart sheet's tabs end about 126px down.
  const top = Number(POPUP.match(/fixed top-\[(\d+)px\]/)?.[1]);
  assert.ok(top >= 126, `phone: below the cart tabs (got top-[${top}px])`);
  assert.match(POPUP, /lg:top-4/);
});

test("the call time is the store's clock, not the device's", () => {
  assert.match(POPUP, /import \{ timeIN \} from "\.\.\/\.\.\/utils";/);
  assert.match(POPUP, /\{timeIN\(call\.requestedAt\)\}/);
  assert.ok(!/toLocaleTimeString/.test(POPUP), "a raw toLocaleTimeString formats in the device's zone");
});
