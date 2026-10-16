// The till's checkout guard and its offline path (QA batch 8: D8, M7/S10, O1).
// The pieces are cut out of OrderPanel.jsx and run with fakes, so they fail on behaviour, not wording.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const panel = fs.readFileSync(path.join(FE, "components/pos/OrderPanel.jsx"), "utf8").replace(/\r\n/g, "\n");

const between = (from, to) => {
  const a = panel.indexOf(from);
  const b = panel.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `OrderPanel: cannot find ${from}`);
  return panel.slice(a, b);
};

// guard() with the component's state passed in.
const makeGuard = ({ cart, orderType = "collection", totalWithTax = 50, isDelivery = false, ordering = {} }) => {
  const warned = [];
  const enqueueSnackbar = (msg) => warned.push(msg);
  const src = between("const guard = () => {", "const finish = () => {");
  const guard = new Function(
    "cart", "orderType", "totalWithTax", "isDelivery", "ordering", "enqueueSnackbar",
    `${src}\nreturn guard;`,
  )(cart, orderType, totalWithTax, isDelivery, ordering, enqueueSnackbar);
  return { ok: guard(), warned };
};

test("D8: the till is not held to the website's minimum order", () => {
  assert.doesNotMatch(panel, /const minOrderValue|< minOrderValue|Minimum order value|Below minimum order value/);
  const { ok, warned } = makeGuard({ cart: [{ name: "Tea", quantity: 1 }], totalWithTax: 20, ordering: { minOrderValue: 500 } });
  assert.equal(ok, true, warned.join());
  // The other guards stay.
  assert.equal(makeGuard({ cart: [] }).ok, false);
  assert.equal(makeGuard({ cart: [{ name: "Tea" }], totalWithTax: 0 }).ok, false);
  assert.equal(makeGuard({ cart: [{ name: "Tea" }], isDelivery: true, ordering: { deliveryEnabled: false } }).ok, false);
  assert.ok(panel.includes("if (!websiteRes || !propsRes) {"), "Finish still waits for GST and charges");
});

test("M7: a cart line cannot be sold through an order type its dish is not offered for", () => {
  const refused = makeGuard({ cart: [{ name: "Biryani", orderTypes: ["delivery"] }], orderType: "collection" });
  assert.equal(refused.ok, false);
  assert.match(refused.warned[0], /Biryani is not sold for collection/);
  assert.equal(makeGuard({ cart: [{ name: "Biryani", orderTypes: ["collection", "delivery"] }] }).ok, true);
  // A line stamped before the rule existed (no orderTypes) is never refused.
  assert.equal(makeGuard({ cart: [{ name: "Tea" }] }).ok, true);
});

// orderMutation's mutationFn with the network down.
const offlineSale = async ({ kotPrint, printFails = false, code = "ERR_NETWORK" }) => {
  const printed = [];
  const warned = [];
  const marked = [];
  const fnSrc = between("mutationFn: async (d) => {", "\n    onSuccess:").replace(/^mutationFn: /, "").replace(/,\s*$/, "");
  const mutationFn = new Function(
    "roundKey", "addOrder", "isNetworkError", "enqueueOrder", "enqueueSnackbar", "localOrderView", "loadPrinterConfig", "printKot", "markKotPrinted", "warnNotPrinted",
    `return (${fnSrc});`,
  )(
    "L1",
    async () => { throw Object.assign(new Error("Network Error"), { code }); },
    () => true,
    (order, localId) => ({ order, localId, localNumber: "OFF-001" }),
    (msg, opts) => warned.push([msg, opts?.variant]),
    (entry) => ({ ...entry.order, _id: entry.localId, orderNumber: entry.localNumber, offline: true }),
    () => ({ kotPrint }),
    (order, opts) => {
      printed.push([order, opts]);
      return printFails ? Promise.reject(new Error("Printer not connected")) : Promise.resolve({ printed: true });
    },
    (localId) => marked.push(localId),
    (what, err) => warned.push([`${what} not printed: ${err.message}`, "warning"]),
  );
  const res = await mutationFn({ items: [{ name: "Tea", quantity: 2 }] });
  await new Promise((r) => setImmediate(r));
  return { res, printed, warned, marked };
};

test("O1: an order saved offline prints its KOT on this device when Auto KOT Print is on", async () => {
  const on = await offlineSale({ kotPrint: true });
  assert.equal(on.res.data.offline, true);
  assert.equal(on.printed.length, 1);
  assert.equal(on.printed[0][0].orderNumber, "OFF-001");
  assert.deepEqual(on.printed[0][1], { auto: true });

  const off = await offlineSale({ kotPrint: false });
  assert.equal(off.printed.length, 0);

  const failed = await offlineSale({ kotPrint: true, printFails: true });
  assert.equal(failed.res.data.offline, true, "a printer failure never loses the sale");
  assert.deepEqual(failed.warned.at(-1), ["KOT not printed: Printer not connected", "warning"]);
});

test("REGRESSION O1: only a KOT that printed here stops the synced copy printing; a timeout prints nothing locally", async () => {
  // The synced copy is printed by the kitchen device unless kotPrinted says this till already did.
  assert.deepEqual((await offlineSale({ kotPrint: true })).marked, ["L1"]);
  assert.deepEqual((await offlineSale({ kotPrint: true, printFails: true })).marked, [], "a failed print leaves it to the kitchen device");
  assert.deepEqual((await offlineSale({ kotPrint: false })).marked, []);
  // A timed-out request may have reached the server: that live copy prints on the kitchen device, so no second ticket here.
  const timedOut = await offlineSale({ kotPrint: true, code: "ECONNABORTED" });
  assert.equal(timedOut.res.data.offline, true, "the sale is still queued");
  assert.equal(timedOut.printed.length, 0);
  assert.deepEqual(timedOut.marked, []);
});
