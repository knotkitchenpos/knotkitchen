import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
// The option list (MENU_ITEMS) lives in its own module; the screen logic stays in Settings.jsx.
const MENU = () => SRC("src/constants/settingsMenu.js");

test("the website tiles are locked without the Website add-on, and point to Billing", () => {
  // Manage Website needs the Website add-on. Website Timing & Holidays opens on
  // the POS plan, or on the Billing plan with the Website add-on (websiteHours).
  // The server enforces both (services/planFeatures, middlewares/planGate).
  const settings = SRC("src/pages/Settings.jsx");
  assert.match(MENU(), /id: "timings",[^\n]*feature: "websiteHours" \}/);
  assert.match(settings, /if \(blockedByPlan\(item\)\) \{\s*navigate\("\/settings\/billing"\);/);
  assert.match(settings, /\{locked \? <I\.lock \/> : <I\.chevron \/>\}/);
  // Manage Website is the Website add-on, nothing else: no gateway-only way in.
  assert.match(MENU(), /id: "website",[^\n]*feature: "website" \}/);
  assert.doesNotMatch(settings, /openWhenLocked/);
  // Knot Eats works without the website, but needs the POS plan.
  assert.match(MENU(), /id: "eats",[^\n]*mode: "view", feature: "pos" \}/);
  const site = SRC("src/pages/WebsiteSettings.jsx");
  assert.doesNotMatch(site, /key: "payments"/);
  assert.match(site, /if \(websiteLocked\) return <Navigate to="\/settings\/billing" replace \/>;/);
  assert.match(site, /updateWebsiteSettings\(\{ \.\.\.withoutRulesKeys\(settings\), paymentGateways: undefined \}\)/);
  assert.doesNotMatch(site, /existing_secret_token/);
});

test("locked tiles name the add-on, or the plan upgrade on the Billing plan", () => {
  const settings = SRC("src/pages/Settings.jsx");
  assert.match(settings, /\{locked \? lockedNote\(item\) :/);
  assert.match(settings, /`Needs the \$\{ADDON_FOR\[item\.feature\] \|\| "Website"\} add-on\. Tap to add it in Billing\.`/);
  // Changed 2026-10-16: QR Table Ordering is in the POS plan, so no tile names it as an add-on.
  assert.match(settings, /const ADDON_FOR = \{ website: "Website", websiteHours: "Website" \};/);
  assert.doesNotMatch(settings, /QR Table Ordering/);
  // Billing plan: a screen an add-on opens still names the add-on; every other lock is the plan.
  assert.match(settings, /features\?\.pos === false && item\.feature !== "website" && item\.feature !== "websiteHours"\s*\? "Not on the Billing plan\. Tap to upgrade in Billing & Subscription\."/);
  assert.doesNotMatch(settings, /onlineOrdering/);
});

test("the payment gateway lives in Store Properties, and Knot Eats blockers point to their screens", () => {
  const props = SRC("src/components/settings/StorePropertiesView.jsx");
  assert.match(props, /import PaymentGatewayCard from "\.\/PaymentGatewayCard";/);
  assert.match(props, /<PaymentGatewayCard \/>/);
  const card = SRC("src/components/settings/PaymentGatewayCard.jsx");
  assert.match(card, /validateGatewayCredentials\(/);
  assert.match(card, /updateWebsiteSettings\(\{ paymentGateways: \{ activeGateway/);
  assert.doesNotMatch(card, /existing_secret_token/);
  const eats = SRC("src/components/settings/KnotEatsView.jsx");
  assert.match(eats, /NO_FSSAI: "\/settings\?view=properties"/);
  assert.match(eats, /NO_MENU: "\/settings\?view=cache"/);
  assert.doesNotMatch(eats, /WEBSITE_OFF|NO_WEBSITE_ADDON/);
});

test("Manage Tables (tableQr = the POS plan) and Order Toggles need the POS plan, Rules & Charges is open; locked ones cannot be pinned or deep-linked", () => {
  const settings = SRC("src/pages/Settings.jsx");
  assert.match(MENU(), /id: "tables",[^\n]*feature: "tableQr" \}/);
  assert.match(MENU(), /id: "toggles",[^\n]*feature: "pos" \}/);
  // Rules, Charges & Promotions: open on both plans, so a billing-only store can set its GST.
  assert.match(MENU(), /id: "rules",[^\n]*mode: "view" \}/);
  assert.doesNotMatch(MENU(), /onlineOrdering/);
  assert.match(settings, /if \(!canPin\(item\) \|\| blockedByPlan\(item\)\) return;/);
  assert.match(settings, /\{activeMeta && blockedByPlan\(activeMeta\) \? \(/, "a ?view= link to a locked screen shows the lock");
});
