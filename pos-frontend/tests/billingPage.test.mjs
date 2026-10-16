import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/**
 * Billing v3: a plan (POS, or the smaller Billing plan chosen before the first
 * recharge) started by the first recharge, add-ons (monthly with the plan, or
 * yearly on their own date) paid from the wallet, and devices (tablets and
 * printers) bought once online. No installation charge, no commitment. A plan
 * is only ever upgraded in the POS; KnotKitchen (CSD) moves a store down.
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

// Changed 2026-10-16 (was: legacy rentals listed until each one ends): tablet rent ended, so no rent line is shown.
test("tablets are bought once online like printers; no rented tablets or rent lines are shown", () => {
  const billing = SRC("src/pages/Billing.jsx");
  // No rental flow, top-up credits or per-tablet recharge left.
  assert.doesNotMatch(billing, /rentSubscriptionTablet|rentTablet|credits|rechargeRequired|item: "TABLET"/);
  // The server's device list (Tablet + printers) is bought through the gateway.
  assert.match(billing, /<Card title="Devices"/);
  // 1600 (was 800): each row now shows its picture and description first.
  assert.match(billing, /\{sub\.printers\.map\(\(p\) =>[\s\S]{0,1600}onClick=\{\(\) => buyPrinter\(p\)\}/);
  assert.match(billing, /enqueueSnackbar\("Paid\. KnotKitchen will confirm and deliver it/);
  assert.doesNotMatch(billing, /Rented tablets|sub\?\.tablets|sub\.tablets|rental/i);
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

test("no old plan names, installation or commitment is left in the POS", () => {
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

/* ---------- The Billing plan (₹199): choose at activation, upgrade only ---------- */

test("the plan is set through POST /api/subscription/plan", () => {
  const api = SRC("src/https/index.js");
  assert.match(api, /export const setSubscriptionPlan = \(data\) => axiosWrapper\.post\("\/api\/subscription\/plan", data\);/);
  assert.ok(!api.includes("/api/subscription/plans"));
});

test("before the first recharge both plans are shown side by side to choose from", () => {
  const billing = SRC("src/pages/Billing.jsx");
  assert.match(
    billing,
    /\{sub\?\.needsActivation && !sub\.exempt && !storeClosed && sub\.plans\?\.length > 0 && \(\s*<Card\s+title="Choose your plan"[\s\S]{0,300}<div className="grid gap-3 sm:grid-cols-2">\s*\{sub\.plans\.map\(\(p\) =>/,
  );
  // Each tile: price per period, both top-up minimums, what it unlocks.
  assert.match(billing, /\{money\(p\.price\)\} \+ GST \/ \{periodDays\} days/);
  assert.match(billing, /First recharge \{money\(p\.firstRechargeMin\)\} · later top-ups at least \{money\(p\.topUpMin\)\}/);
  assert.match(billing, /\{PLAN_BLURB\[p\.code\]/);
  assert.match(billing, /BILLING: "Billing only: Collection orders at the counter/);
  assert.match(billing, /\{p\.current && <Tag tone="green">SELECTED<\/Tag>\}/);
  assert.match(billing, /run: \(\) => setSubscriptionPlan\(\{ code: p\.code, accepted: true \}\)/);
  // The wallet note names the chosen plan.
  assert.match(billing, /Your\{" "\}\s*\{sub\.basePlan\?\.name\} plan \(\{money\(sub\.basePlan\?\.price\)\}/);
});

test("a Billing-plan store upgrades through the usual quote, summary and acceptance", () => {
  const billing = SRC("src/pages/Billing.jsx");
  assert.match(billing, /const billingPlan = sub\?\.planCode === "BILLING";/);
  assert.match(billing, /\{posPlan && billingPlan && !sub\.needsActivation && !sub\.exempt && !cancelled && !sub\.cancelAt && \(/);
  assert.match(
    billing,
    /const upgradePlan = \(pos\) =>\s*review\(\{\s*item: "PLAN:POS",[\s\S]{0,500}run: \(\) => setSubscriptionPlan\(\{ code: "POS", accepted: true \}\)/,
  );
  assert.match(billing, /Charged now: the difference for the days left in this period, \+ GST\./);
  assert.match(billing, /onClick=\{\(\) => upgradePlan\(posPlan\)\}/);
});

test("no downgrade from the POS: only the pre-start choice and the upgrade set a plan", () => {
  const billing = SRC("src/pages/Billing.jsx");
  assert.equal(billing.match(/setSubscriptionPlan\(/g).length, 2);
  // Nowhere in the POS sends a store to the Billing plan by name.
  const src = path.join(__dirname, "..", "src");
  for (const f of fs.readdirSync(src, { recursive: true }).filter((f) => /\.(jsx?|mjs)$/.test(f))) {
    assert.ok(!/setSubscriptionPlan\(\{ code: "BILLING"/.test(fs.readFileSync(path.join(src, f), "utf8")), f);
  }
  // A move KnotKitchen scheduled is shown, with nothing to press.
  assert.match(billing, /\{pendingPlan && \(\s*<p[^>]*>\s*KnotKitchen is moving this store to the \{pendingPlan\} plan on \{dateOf\(sub\.pendingPlanAt\)\}\.\s*<\/p>\s*\)\}/);
});

test("QR Table Ordering is in the POS plan, not an add-on: the server stops listing it, so the list has no special case", () => {
  const billing = SRC("src/pages/Billing.jsx");
  // Changed 2026-10-16 (was: a "Needs the POS plan" note for tableQr on the Billing plan).
  assert.doesNotMatch(billing, /tableQr|Needs the POS plan/);
  assert.match(billing, /Keep\s*<\/button>\s*\) : \(\s*<button[^>]*onClick=\{\(\) => addAddon\(a\)\}/, "not owned: Add, for every add-on listed");
  assert.match(billing, /POS: "Everything: [^"]*tables and table QR ordering\. The website is an add-on\."/);
});
