import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/**
 * Billing v3: one POS plan started by the first recharge, add-ons (monthly with
 * the plan, or yearly on their own date) paid from the wallet, and devices
 * (tablets and printers) bought once online. No plans to pick, no installation
 * charge, no commitment.
 */

test("the API wrappers match /api/subscription, and the old plan endpoints are gone", () => {
  const api = SRC("src/https/index.js");
  assert.match(api, /axiosWrapper\.get\("\/api\/subscription\/quote", \{ params: \{ item \} \}\)/);
  assert.match(api, /axiosWrapper\.post\("\/api\/subscription\/addons", data\)/);
  assert.match(api, /axiosWrapper\.delete\(`\/api\/subscription\/addons\/\$\{encodeURIComponent\(code\)\}`\)/);
  assert.match(api, /axiosWrapper\.post\("\/api\/subscription\/printers", data\)/);
  assert.match(api, /axiosWrapper\.post\("\/api\/subscription\/renew"\)/);
  assert.match(api, /axiosWrapper\.get\("\/api\/subscription\/invoices"\)/);
  // Tablets are bought like printers now: no rental wrapper is left.
  for (const gone of ["/plans", "/purchase", "/installation", "/terms", "/quote/", "/tablets"]) {
    assert.ok(!api.includes(`/api/subscription${gone}`), gone);
  }
});

test("every purchase is priced by /quote, shown as an order summary, and sent only once accepted", () => {
  const billing = SRC("src/pages/Billing.jsx");
  assert.match(billing, /item: `ADDON:\$\{a\.code\}`/);
  assert.match(billing, /item: `PRINTER:\$\{p\.code\}`/);
  assert.match(billing, /await getSubscriptionQuote\(item\)/);
  assert.match(billing, /addSubscriptionAddon\(\{ code: a\.code, accepted: true \}\)/);
  // A printer is paid through Cashfree, never from the wallet, and only a
  // payment Cashfree confirmed counts.
  assert.match(billing, /buySubscriptionPrinter\(\{\s*code: p\.code,\s*accepted: true,/);
  assert.match(billing, /payWith: "gateway"/);
  assert.match(billing, /if \(!verified\.purchased\) throw new Error/);
  // The terms box gates the button, and starts unticked for every summary.
  assert.match(billing, /disabled=\{!accepted \|\| busy\}/);
  assert.match(billing, /\{summary && \(\s*<OrderSummary/);
  // The accepted agreement is one tap away (landing/X-AGREEMENT-IN-APP).
  assert.match(billing, /href="https:\/\/agreement\.knotkitchen\.com\/agreement\.html"/);
  // A short wallet (402) is a warning with the server's shortfall, not a generic failure.
  assert.match(billing, /err\?\.response\?\.status === 402 \? "warning" : "error"/);
});

test("the first recharge minimum is shown until the POS plan starts, and presets never go under it", () => {
  const billing = SRC("src/pages/Billing.jsx");
  assert.match(billing, /const minRupees = Number\(sub\?\.minTopUp\?\.rupees\) \|\| 0;/);
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

test("add-ons stop at renewal and can be kept", () => {
  const billing = SRC("src/pages/Billing.jsx");
  assert.match(billing, /run: \(\) => stopSubscriptionAddon\(a\.code\)/);
  assert.match(billing, /Stop at renewal/);
  assert.match(billing, /addSubscriptionAddon\(\{ code: a\.code \}\)[\s\S]{0,300}Keep/);
});

test("a yearly add-on shows its own period, renewal and failure, and its own accepted terms", () => {
  const billing = SRC("src/pages/Billing.jsx");
  // "₹3,600.00 + GST / year", never "/ 30 days".
  assert.match(billing, /\+ GST \/ \{a\.yearly \? "year" : `\$\{a\.periodDays \|\| periodDays\} days`\}/);
  assert.match(billing, / · renews \$\{dateOf\(a\.renewsAt\)\}/);
  assert.match(billing, /\{a\.lastRenewalError\} Recharge the wallet and it renews by itself\./);
  // Bought whole for a year: no days-left share, its own renewal, no refund.
  assert.match(billing, /terms: a\.yearly\s*\?\s*\[\s*`\$\{money\(a\.price\)\} \+ GST now for one year \(until \$\{until\}\), then yearly from your wallet\.`,\s*`Stop any time: it works until \$\{until\}\. No refund\.`/);
  // Stopping it keeps it to the end of its own paid year.
  assert.match(billing, /It works until \$\{dateOf\(a\.paidUntil \|\| sub\.currentPeriodEnd\)\}/);
});

test("tablets are bought once online like printers; rentals are listed only while they last", () => {
  const billing = SRC("src/pages/Billing.jsx");
  // No rental flow, top-up credits or per-tablet recharge left.
  assert.doesNotMatch(billing, /rentSubscriptionTablet|rentTablet|credits|rechargeRequired|item: "TABLET"/);
  // The server's device list (Tablet + printers) is bought through the gateway.
  assert.match(billing, /<Card title="Devices"/);
  assert.match(billing, /\{sub\.printers\.map\(\(p\) =>[\s\S]{0,800}onClick=\{\(\) => buyPrinter\(p\)\}/);
  assert.match(billing, /enqueueSnackbar\("Paid\. KnotKitchen will confirm and deliver it/);
  // Legacy rentals stay visible until each one ends.
  assert.match(billing, /\{tablets\.length > 0 && \(\s*<Card title="Rented tablets"/);
});

test("the POS never shows the platform-fee or e-bill charges, only unpaid dues that explain a lock", () => {
  const billing = SRC("src/pages/Billing.jsx");
  assert.doesNotMatch(billing, /per-order|e-bill|per order|order charge/i);
  assert.match(billing, /\{balance\.dues\.count\} unpaid platform fee\(s\) — \{money\(balance\.dues\)\}/);
});

test("Billing carries no explanatory texts the owner asked to remove", () => {
  const billing = SRC("src/pages/Billing.jsx");
  for (const gone of [
    /Your Business Balance, prepaid/,
    /Paid securely through Cashfree/,
    /set this store up as a demo store/,
    /add-ons renew with the POS plan/,
    /Opens in a new tab\. Use your browser/,
  ]) assert.doesNotMatch(billing, gone);
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
