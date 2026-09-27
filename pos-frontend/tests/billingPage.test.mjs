import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/**
 * Billing v3: one POS plan started by the first recharge, monthly add-ons,
 * rented tablets and bought printers, all paid from the wallet. No plans to
 * pick, no installation charge, no commitment.
 */

test("the API wrappers match /api/subscription, and the old plan endpoints are gone", () => {
  const api = SRC("src/https/index.js");
  assert.match(api, /axiosWrapper\.get\("\/api\/subscription\/quote", \{ params: \{ item \} \}\)/);
  assert.match(api, /axiosWrapper\.post\("\/api\/subscription\/addons", data\)/);
  assert.match(api, /axiosWrapper\.delete\(`\/api\/subscription\/addons\/\$\{encodeURIComponent\(code\)\}`\)/);
  assert.match(api, /axiosWrapper\.post\("\/api\/subscription\/tablets", data\)/);
  assert.match(api, /axiosWrapper\.post\("\/api\/subscription\/printers", data\)/);
  assert.match(api, /axiosWrapper\.post\("\/api\/subscription\/renew"\)/);
  assert.match(api, /axiosWrapper\.get\("\/api\/subscription\/invoices"\)/);
  for (const gone of ["/plans", "/purchase", "/installation", "/terms", "/quote/"]) {
    assert.ok(!api.includes(`/api/subscription${gone}`), gone);
  }
});

test("every purchase is priced by /quote, shown as an order summary, and sent only once accepted", () => {
  const billing = SRC("src/pages/Billing.jsx");
  assert.match(billing, /item: `ADDON:\$\{a\.code\}`/);
  assert.match(billing, /item: "TABLET"/);
  assert.match(billing, /item: `PRINTER:\$\{p\.code\}`/);
  assert.match(billing, /await getSubscriptionQuote\(item\)/);
  assert.match(billing, /addSubscriptionAddon\(\{ code: a\.code, accepted: true \}\)/);
  assert.match(billing, /rentSubscriptionTablet\(\{ accepted: true, shipTo \}\)/);
  // A printer is paid through Cashfree, never from the wallet, and only a
  // payment Cashfree confirmed counts.
  assert.match(billing, /buySubscriptionPrinter\(\{\s*code: p\.code,\s*accepted: true,/);
  assert.match(billing, /payWith: "gateway"/);
  assert.match(billing, /if \(!verified\.purchased\) throw new Error/);
  // The terms box gates the button, and starts unticked for every summary.
  assert.match(billing, /disabled=\{!accepted \|\| busy\}/);
  assert.match(billing, /\{summary && \(\s*<OrderSummary/);
  // A short wallet (402) is a warning with the server's shortfall, not a generic failure.
  assert.match(billing, /err\?\.response\?\.status === 402 \? "warning" : "error"/);
});

test("the first recharge minimum is shown until the POS plan starts, and presets never go under it", () => {
  const billing = SRC("src/pages/Billing.jsx");
  assert.match(billing, /const minRupees = sub\?\.needsActivation \? Number\(sub\.firstRechargeMin\?\.rupees\) \|\| 0 : 0;/);
  assert.match(billing, /\{sub\?\.needsActivation && \(/);
  assert.match(billing, /starts automatically when it arrives/);
  assert.match(billing, /presetsFrom\(minRupees\)\.map/);
});

test("the POS plan card shows the next renewal from the wallet, line by line", () => {
  const billing = SRC("src/pages/Billing.jsx");
  assert.match(billing, /Renews on \$\{dateOf\(sub\.nextRenewal\.at\)\}/);
  assert.match(billing, /<Bill bill=\{sub\.nextRenewal\} totalLabel="Renewal total" \/>/);
  assert.match(billing, /await renewSubscription\(\)/);
});

test("add-ons stop at renewal and can be kept; tablets wait for a qualifying top-up", () => {
  const billing = SRC("src/pages/Billing.jsx");
  assert.match(billing, /run: \(\) => stopSubscriptionAddon\(a\.code\)/);
  assert.match(billing, /Stop at renewal/);
  assert.match(billing, /addSubscriptionAddon\(\{ code: a\.code \}\)[\s\S]{0,300}Keep/);
  assert.match(billing, /disabled=\{busy \|\| credits < 1 \|\| !sub\.active\}/);
  assert.match(billing, /credits < 1 \? `Top up \$\{money\(tablet\?\.rechargeRequired\)\} to rent a tablet` : "Request a tablet"/);
});

test("no plan picker, installation or commitment is left in the POS", () => {
  const files = [
    "src/pages/Billing.jsx",
    "src/pages/Settings.jsx",
    "src/pages/WebsiteSettings.jsx",
    "src/pages/Tables.jsx",
    "src/components/shared/AccountLock.jsx",
    "src/https/index.js",
  ];
  for (const f of files) {
    const src = SRC(f);
    assert.ok(!/Growth|\bScale\b|Essential|\bConnect\b/.test(src), f);
    assert.ok(!/installation|commitment|upgrade your plan/i.test(src), f);
  }
  // Staff are asked for the PIN by the global popup; Billing has no modal of its own.
  assert.ok(!SRC("src/pages/Billing.jsx").includes("SecurityPinModal"));
  assert.match(SRC("src/components/shared/AccountLock.jsx"), /recharge the wallet there and it unlocks by itself/);
});

test("a printer or tablet is requested to a delivery address, then priced and paid; the store follows and can cancel it", () => {
  const billing = SRC("src/pages/Billing.jsx");
  // Address first (prefilled from the store), then the usual order summary.
  assert.match(billing, /const rentTablet = \(\) =>\s*setDeliverFor\(/);
  assert.match(billing, /const buyPrinter = \(p\) =>\s*setDeliverFor\(/);
  assert.match(billing, /initial=\{sub\?\.shipTo\}/);
  assert.match(billing, /buySubscriptionPrinter\(\{\s*code: p\.code,\s*accepted: true,\s*shipTo,/);
  assert.match(billing, /deliverTo: shipTo/);
  // Where each request is, refreshed with every purchase (same "subscription" prefix).
  assert.match(billing, /queryKey: \["subscription", "hardware-requests"\]/);
  assert.match(billing, /\{r\.canCancel && \(/);
  assert.match(billing, /cancelHardwareRequest\(r\.id\)/);
  const api = SRC("src/https/index.js");
  assert.match(api, /axiosWrapper\.get\("\/api\/subscription\/hardware-requests"\)/);
  assert.match(api, /\/api\/subscription\/hardware-requests\/\$\{encodeURIComponent\(id\)\}\/cancel/);
  // CSD moving it along refreshes the till live.
  assert.match(SRC("src/hooks/useRealtimeSync.js"), /"hardwareRequest:updated": \["subscription", "business-balance"\]/);
});

test("cancelling is the owner's, in an in-page box; a closed store cannot top up", () => {
  const billing = SRC("src/pages/Billing.jsx");
  // window.prompt returns null in Electron, so the cancel would do nothing there.
  assert.ok(!billing.includes("window.prompt("));
  assert.match(billing, /const CancelPlan = /);
  assert.match(billing, /After that your store is Closed\./);
  assert.match(billing, /Your wallet balance is not refundable\./);
  assert.match(billing, /\) : owner && \(\s*<button[^>]*onClick=\{\(\) => setCancelling\(true\)\}/);
  assert.match(billing, /\{canUndo && owner && !sub\.storeClosed && \(/);
  // 409 SUBSCRIPTION_CANCELLED (or a cancelled plan) replaces the recharge form.
  assert.match(billing, /code === "SUBSCRIPTION_CANCELLED"\) setClosedByServer\(true\)/);
  assert.match(billing, /\{storeClosed \? \([\s\S]{0,300}This store is closed\. Contact KnotKitchen support to reopen\./);
});

test("a store KnotKitchen closed shows it is closed, with no Undo and no recharge", () => {
  const billing = SRC("src/pages/Billing.jsx");
  assert.match(
    billing,
    /const storeClosed = cancelled \|\| closedByServer \|\| Boolean\(sub\?\.topUpBlocked \|\| sub\?\.storeClosed \|\| balance\?\.closed\);/,
  );
  // The pending-cancellation banner says closed instead of "Cancels on …".
  assert.match(
    billing,
    /\{sub\.storeClosed \? \(\s*<p[^>]*>This store is closed\. Contact KnotKitchen support to reopen\.<\/p>\s*\) : \(\s*<p>\s*<span className="font-extrabold">Cancels on/,
  );
  // The recharge form sits in the not-closed branch only.
  const closed = billing.indexOf("{storeClosed ? (");
  const recharge = billing.indexOf(">Recharge</p>");
  const branchEnd = closed + billing.slice(closed).search(/<\/>\s*\)\}/);
  assert.ok(closed > 0 && closed < recharge && recharge < branchEnd);
});
