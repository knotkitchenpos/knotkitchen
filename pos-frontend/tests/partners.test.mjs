import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("the Partners build: its own entry at /partners/, same-origin API, served by the POS image", () => {
  const vite = src("vite.partners.config.js");
  assert.match(vite, /base: '\/partners\/'/);
  assert.match(vite, /'import\.meta\.env\.VITE_KK_APP': JSON\.stringify\('partners'\)/);
  assert.match(vite, /outDir: path\.join\(here, 'dist\/partners'\)/);
  assert.match(vite, /rewrite: \(p\) => p\.replace\(\/\^\\\/partners\\\/api\/, '\/api\/partners'\)/);
  assert.match(src("partners/index.html"), /<script type="module" src="\.\/main\.jsx"><\/script>/);
  assert.match(src("nginx.conf"), /location \/partners\/ \{\n\s+try_files \$uri \$uri\/ \/partners\/index\.html;/);
  const pkg = JSON.parse(src("package.json"));
  assert.equal(pkg.scripts["build:partners"], "vite build --config vite.partners.config.js");
});

test("in the Partners build the POS's Billing and Reports call the picked store through the pass-through", () => {
  const ax = src("src/https/axiosWrapper.js");
  assert.match(ax, /if \(PARTNERS_APP\) \{\n\s+config\.baseURL = PARTNERS_API;/);
  assert.match(ax, /if \(url\.startsWith\("\/api\/"\)\) config\.url = `\/s\/\$\{activePartnerStore\(\)\}\$\{url\}`;/);
  // No POS refresh or PIN loop there: a signed-out session goes to its own sign-in.
  assert.match(ax, /if \(PARTNERS_APP\) \{\n\s+if \(error\.response\?\.status === 401\) partnersSignedOut\(\);\n\s+return Promise\.reject\(error\);/);
  const mode = src("src/partners/mode.js");
  assert.match(mode, /export const PARTNERS_APP = import\.meta\.env\.VITE_KK_APP === "partners";/);
  // Switching store drops the other store's cached billing and reports.
  assert.match(src("src/partners/PartnersApp.jsx"), /qc\.removeQueries\(\{ predicate: \(q\) => !String\(q\.queryKey\[0\] \|\| ""\)\.startsWith\("partner-"\) \}\);/);
  assert.match(src("src/partners/pages/BillingPage.jsx"), /<Billing key=\{current\.storeId\} \/>/);
});

test("the POS no longer has Billing: its route says where it moved and keeps ?device=", () => {
  const app = src("src/App.jsx");
  assert.match(app, /BillingMoved: \(\) => import\("\.\/pages\/BillingMoved\.jsx"\),/);
  assert.match(app, /<Route path="\/settings\/billing" element=\{<ProtectedRoutes><BillingMoved \/><\/ProtectedRoutes>\} \/>/);
  assert.doesNotMatch(app, /import\("\.\/pages\/Billing\.jsx"\)/);
  const moved = src("src/pages/BillingMoved.jsx");
  assert.match(moved, /const href = `\$\{PARTNERS_URL\}\/billing\$\{typeof window !== "undefined" \? window\.location\.search : ""\}`;/);
  assert.match(moved, /"https:\/\/knotkitchen\.com\/partners"/);
  assert.match(src("src/constants/settingsMenu.js"), /desc: "Moved to the Partners dashboard at knotkitchen\.com\/partners\."/);
  assert.match(src("src/components/shared/AccountLock.jsx"), /recharges the wallet on the Partners dashboard/);
});

test("the Partners pages: sign-in with a store's Owner login, link any number of stores", () => {
  const routes = src("src/partners/PartnersApp.jsx");
  for (const p of ["/login", "/", "/stores", "/billing", "/reports", "/orders", "/account"]) assert.ok(routes.includes(`path="${p}"`), p);
  const login = src("src/partners/pages/Login.jsx");
  assert.match(login, /Only the store&apos;s Owner can sign in here\./);
  // ?next= only to a path inside the app (no open redirect).
  assert.match(login, /next && next\.startsWith\("\/"\) && !next\.startsWith\("\/\/"\) \? next : "\/"/);
  assert.match(src("src/partners/pages/Stores.jsx"), /partnersApi\.linkStore\(v\)/);
});

test("Accountant exports: one store and month, figures and checks first, then the files", () => {
  const routes = src("src/partners/PartnersApp.jsx");
  assert.ok(routes.includes('path="/exports"'));
  assert.match(routes, /\{ to: "\/exports", label: "Exports", Icon: MdFileDownload \}/);
  const page = src("src/partners/pages/Exports.jsx");
  // Last month by default: the return being filed.
  assert.match(page, /useState\(months\[1\]\.key\)/);
  assert.match(page, /onClick=\{\(\) => download\("gstr1\.xlsx"\)\}/);
  assert.match(page, /disabled=\{!valid \|\| !registered \|\| !oneMonth\}/, "JSON only for a registered store and one month");
  assert.match(page, /download\("tally\.xml", \{ mode, ledgers: JSON\.stringify\(ledgers\) \}\)/);
  assert.match(src("src/partners/api.js"), /responseType: "blob"/);
});
