const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

/**
 * The CSD panel's side of the ₹199 Billing plan: its price and top-up
 * minimums are edited on Billing, it can carry a negotiated price, and an
 * admin moves a store to a smaller plan from the store's page.
 */

const web = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", "csd-web", "src", rel), "utf8");

test("CSD Billing edits the Billing plan's name, price and both top-up minimums", () => {
  const src = web("pages/Billing.jsx");
  const pos = src.indexOf('title="POS plan"');
  const card = src.indexOf('title="Billing plan"');
  assert.ok(pos > 0 && card > pos && card < src.indexOf('title="Add-ons"'), "right after the POS plan card");
  // An older API that does not send it skips the card instead of crashing the page.
  assert.match(src, /\{config\.billingPlan && \(\s*<Card\s+title="Billing plan"/);
  for (const key of ["name", "price", "firstRechargeMin", "topUpMin"]) {
    assert.ok(src.includes(`error={fieldErrors["billingPlan.${key}"]}`), `error key billingPlan.${key}`);
    assert.ok(src.includes(`value={config.billingPlan.${key}}`), `field bound to billingPlan.${key}`);
    assert.ok(
      src.includes(`set({ billingPlan: { ...config.billingPlan, ${key}: `),
      `${key} edits keep the other billingPlan fields`,
    );
  }
  // Changed 2026-10-16: QR Table Ordering is no add-on on any plan, so the copy no longer says the Billing plan cannot buy it.
  assert.match(src, /Website and GMB add-ons can be bought on it\. Everything else, tables and QR table ordering included, unlocks when the store upgrades\./);
  // Sent in the PATCH the way basePlan is: the whole config is spread into the save.
  assert.match(src, /billingConfig\.save\(\{\s*\.\.\.config,/);
});

test("negotiated prices can be set for the Billing plan", () => {
  const src = web("components/ChargesDialog.jsx");
  const start = src.indexOf("const catalogItems");
  const body = src.slice(start, src.indexOf("\n};\n", start) + 3);
  // eslint-disable-next-line no-new-func
  const catalogItems = new Function(`${body}; return catalogItems;`)();
  const base = {
    subscriptionDays: 30,
    basePlan: { code: "POS", name: "POS", price: 499 },
    addons: [],
    tablet: { firstPrice: 0, extraPrice: 0 },
    printers: [],
  };

  const items = catalogItems({ ...base, billingPlan: { code: "BILLING", name: "Billing", price: 199 } });
  assert.deepStrictEqual(items.slice(0, 2), [
    { code: "POS", label: "POS plan / 30 days", price: 499 },
    { code: "BILLING", label: "Billing plan / 30 days", price: 199 },
  ]);
  // An older API without billingPlan: no row, no crash.
  assert.ok(!catalogItems(base).some((i) => i.code === "BILLING"));
});

test("the CSD client posts a plan change to the admin-only route", () => {
  const src = web("api/index.js");
  assert.match(
    src,
    /changePlan: \(restaurantId, code, reason\) =>\s+api\.post\(`\/billing\/accounts\/\$\{restaurantId\}\/subscription\/plan`, \{ code, reason \}\)\.then\(\(r\) => r\.data\.data\)/,
  );
});

test("a store's page: Change plan… is admin-only, and a scheduled change is shown", () => {
  const src = web("pages/RestaurantDetail.jsx");
  const card = src.slice(src.indexOf("const PosPlanCard"), src.indexOf("const PERIODS"));

  // Inside the Plan row, for admins on a subscription that is not cancelled.
  const planRow = card.slice(card.indexOf('<Row label="Plan">'), card.indexOf('<Row label="Scheduled">'));
  assert.match(planRow, /\{isAdmin && !cancelled && sub\.plans\?\.length > 1 && \(\s*<button type="button" onClick=\{onChangePlan\}/);
  assert.match(planRow, /Change plan…/);
  assert.match(card, /\{sub\.pendingPlanCode && \(\s*<Row label="Scheduled">/);
  assert.match(card, /Moves to \$\{[^`]*\} plan on \$\{dOnly\(sub\.pendingPlanAt\)\}/);

  // The modal: a plan from sub.plans, a 3-300 character reason, the policy in words.
  assert.match(src, /onChangePlan=\{openPlan\}/);
  assert.match(src, /\(charges\.subscription\?\.plans \|\| \[\]\)\.map\(\(p\) => \(/);
  assert.match(src, /if \(reason\.length < 3 \|\| reason\.length > 300\) \{\s*setPlanErr\(/);
  for (const words of [
    "A move to a smaller plan takes effect at the end of the paid period",
    "No refund. QR Table Ordering stops then. A store that has not started switches now.",
    "current plan to cancel a scheduled change. Upgrades are made by the store in POS Billing.",
  ]) {
    assert.ok(src.replace(/\s+/g, " ").includes(words), words);
  }

  // Submit, reload the standing like cancel, and show the server's reason on an error
  // (409 UPGRADE_IN_POS for an upgrade of a started store).
  const handler = src.slice(src.indexOf("const changePlan = async"), src.indexOf("const reinstate = async"));
  assert.match(handler, /await billingApi\.changePlan\(data\.charges\.restaurantId, plan\.code, reason\);\s+\/\/[^\n]*\n\s+await load\(\);/);
  assert.match(handler, /setPlanErr\(fieldErrors\(err\)\.reason \|\| errorMessage\(err, /);
  assert.ok(!/UPGRADE_IN_POS/.test(web("api/index.js")), "not rewritten client-side: the server's message is shown");
});

// Changed 2026-10-16 (was: CSD showed the retired TABLE_QR row off sale): the owner asked for it removed completely,
// and for the tablet rentals section to go (rent ended for every store).
test("2026-10-16: CSD Billing has no QR Table Ordering add-on or tablet rentals; the POS plan includes tables", () => {
  const src = web("pages/Billing.jsx");
  assert.ok(!/tableQr|TABLE_QR|isRetired/.test(src), "no retired row, and no add-on can unlock table ordering");
  assert.match(src, /<option value="">Nothing \(a service\)<\/option>\s*<option value="website">Website and online payments<\/option>\s*<\/select>/);
  assert.ok(!/Tablet rentals|config\.tablet|rental/i.test(src), "the rentals section is gone");
  const charges = web("components/ChargesDialog.jsx");
  assert.ok(!/TABLET_FIRST|TABLET_EXTRA|c\.tablet/.test(charges), "no rental price to negotiate");
  const store = web("pages/RestaurantDetail.jsx");
  assert.ok(!/endTablet|onEndTablet|End rental|Rented tablets|sub\.tablets/.test(store), "a store page neither shows nor ends rentals");
  assert.ok(!/endTablet/.test(web("api/index.js")));
  assert.match(src, /Everything except the website: tables, dine-in and QR table ordering are included\./);
  assert.ok(!/come with the QR Table Ordering add-on/.test(src));
  assert.ok(!/QR Table Ordering/.test(web("components/NextSteps.jsx")), "not offered as an add-on to new stores");
});
