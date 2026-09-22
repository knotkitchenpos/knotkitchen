import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("the website tiles are locked on plans without the website, and point to Billing", () => {
  // "For the Essential Plan ... Manage Website, Website Timing and Holidays
  // should remain locked." The server enforces it (services/planFeatures).
  const settings = SRC("src/pages/Settings.jsx");
  assert.match(settings, /id: "timings",[^\n]*feature: "website" \}/);
  assert.match(settings, /if \(blockedByPlan\(item\)\) \{\s*navigate\("\/settings\/billing"\);/);
  assert.match(settings, /\{locked \? <I\.lock \/> : <I\.chevron \/>\}/);
  // Manage Website still opens, as the payment gateway only: every plan keeps it.
  assert.match(settings, /id: "website",[^\n]*feature: "website",[^\n]*openWhenLocked: true \}/);
  const site = SRC("src/pages/WebsiteSettings.jsx");
  assert.match(site, /const tabs = websiteLocked \? TABS\.filter\(\(t\) => t\.key === "payments"\) : TABS;/);
  assert.match(site, /updateWebsiteSettings\(websiteLocked \? \{ paymentGateways: settings\.paymentGateways \} : settings\)/);
});

test("a paid installation can be upgraded from Billing, paying only the difference", () => {
  const billing = SRC("src/pages/Billing.jsx");
  assert.match(billing, /terms\?\.installationUpgrades/);
  assert.match(billing, /installUpgrade\.mutate\(\{ optionCode: option\.code, accepted: true \}\)/);
  assert.match(SRC("src/https/index.js"), /"\/api\/subscription\/installation\/upgrade"/);
});
