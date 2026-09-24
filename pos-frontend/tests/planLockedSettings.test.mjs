import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("the website tiles are locked without the Website add-on, and point to Billing", () => {
  // Manage Website and Website Timing & Holidays need the Website add-on.
  // The server enforces it (services/planFeatures).
  const settings = SRC("src/pages/Settings.jsx");
  assert.match(settings, /id: "timings",[^\n]*feature: "website" \}/);
  assert.match(settings, /if \(blockedByPlan\(item\)\) \{\s*navigate\("\/settings\/billing"\);/);
  assert.match(settings, /\{locked \? <I\.lock \/> : <I\.chevron \/>\}/);
  // Manage Website still opens as the payment gateway only, when a store has that without the website.
  assert.match(settings, /id: "website",[^\n]*feature: "website",[^\n]*openWhenLocked: "paymentGateway" \}/);
  const site = SRC("src/pages/WebsiteSettings.jsx");
  assert.match(site, /const tabs = websiteLocked \? TABS\.filter\(\(t\) => t\.key === "payments"\) : TABS;/);
  assert.match(site, /updateWebsiteSettings\(websiteLocked \? \{ paymentGateways: settings\.paymentGateways \} : settings\)/);
  // No payment gateway either (today it comes with the Website add-on): the page goes to Billing.
  assert.match(site, /if \(websiteLocked && gatewayLocked\) return <Navigate to="\/settings\/billing" replace \/>;/);
});

test("locked tiles and the website page speak of add-ons, not the old plans", () => {
  const settings = SRC("src/pages/Settings.jsx");
  assert.match(settings, /\{locked \? lockedNote\(item\) :/);
  assert.match(settings, /`Needs the \$\{ADDON_FOR\[item\.feature\] \|\| "Website"\} add-on\. Tap to add it in Billing\.`/);
  assert.match(settings, /const ADDON_FOR = \{ website: "Website", tableQr: "QR Table Ordering", onlineOrdering: "Website or QR Table Ordering" \};/);
  assert.match(SRC("src/pages/WebsiteSettings.jsx"), /The website is an add-on\./);
});

test("POS plan alone: Manage Tables, Order Toggles and Rules & Charges are locked, and cannot be pinned or deep-linked", () => {
  const settings = SRC("src/pages/Settings.jsx");
  assert.match(settings, /id: "tables",[^\n]*feature: "tableQr" \}/);
  assert.match(settings, /id: "toggles",[^\n]*feature: "onlineOrdering" \}/);
  assert.match(settings, /id: "rules",[^\n]*feature: "onlineOrdering" \}/);
  assert.match(settings, /if \(!canPin\(item\) \|\| blockedByPlan\(item\)\) return;/);
  assert.match(settings, /\{activeMeta && blockedByPlan\(activeMeta\) \? \(/, "a ?view= link to a locked screen shows the lock");
});
