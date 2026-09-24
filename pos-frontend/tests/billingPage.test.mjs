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
  assert.match(billing, /rentSubscriptionTablet\(\{ accepted: true \}\)/);
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
  assert.match(billing, /credits < 1 \? `Top up \$\{money\(tablet\?\.rechargeRequired\)\} to rent a tablet` : "Rent a tablet"/);
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
