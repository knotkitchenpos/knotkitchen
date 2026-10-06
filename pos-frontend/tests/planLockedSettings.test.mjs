import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("the website tiles are locked without the Website add-on, and point to Billing", () => {
  // Manage Website needs the Website add-on. Website Timing & Holidays also
  // holds the table QR's hours, so QR Table Ordering opens it too (REGRESSION:
  // a QR-only store was held to the 4 PM default). The server enforces both
  // (services/planFeatures).
  const settings = SRC("src/pages/Settings.jsx");
  assert.match(settings, /id: "timings",[^\n]*feature: "onlineOrdering" \}/);
  assert.match(settings, /if \(blockedByPlan\(item\)\) \{\s*navigate\("\/settings\/billing"\);/);
  assert.match(settings, /\{locked \? <I\.lock \/> : <I\.chevron \/>\}/);
  // Manage Website is the Website add-on, nothing else: no gateway-only way in.
  assert.match(settings, /id: "website",[^\n]*feature: "website" \}/);
  assert.doesNotMatch(settings, /openWhenLocked/);
  // Knot Eats works without the website.
  assert.match(settings, /id: "eats",[^\n]*mode: "view" \}/);
  const site = SRC("src/pages/WebsiteSettings.jsx");
  assert.doesNotMatch(site, /key: "payments"/);
  assert.match(site, /if \(websiteLocked\) return <Navigate to="\/settings\/billing" replace \/>;/);
  assert.match(site, /updateWebsiteSettings\(\{ \.\.\.withoutRulesKeys\(settings\), paymentGateways: undefined \}\)/);
  assert.doesNotMatch(site, /existing_secret_token/);
});

test("locked tiles and the website page speak of add-ons, not the old plans", () => {
  const settings = SRC("src/pages/Settings.jsx");
  assert.match(settings, /\{locked \? lockedNote\(item\) :/);
  assert.match(settings, /`Needs the \$\{ADDON_FOR\[item\.feature\] \|\| "Website"\} add-on\. Tap to add it in Billing\.`/);
  assert.match(settings, /const ADDON_FOR = \{ website: "Website", tableQr: "QR Table Ordering", onlineOrdering: "Website or QR Table Ordering" \};/);
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

test("POS plan alone: Manage Tables, Order Toggles and Rules & Charges are locked, and cannot be pinned or deep-linked", () => {
  const settings = SRC("src/pages/Settings.jsx");
  assert.match(settings, /id: "tables",[^\n]*feature: "tableQr" \}/);
  assert.match(settings, /id: "toggles",[^\n]*feature: "onlineOrdering" \}/);
  assert.match(settings, /id: "rules",[^\n]*feature: "onlineOrdering" \}/);
  assert.match(settings, /if \(!canPin\(item\) \|\| blockedByPlan\(item\)\) return;/);
  assert.match(settings, /\{activeMeta && blockedByPlan\(activeMeta\) \? \(/, "a ?view= link to a locked screen shows the lock");
});
