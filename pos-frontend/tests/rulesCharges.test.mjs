import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fieldErrorLines, withoutRulesKeys } from "../src/utils/rulesCharges.js";

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("Rules & Charges builds its form only from loaded settings, remounted per version", () => {
  const view = src("components/settings/RulesChargesView.jsx");
  // No hooks seeded from `{}` while the query is loading or failed.
  assert.match(view, /if \(!webRes\) \{/);
  assert.match(view, /return <RulesChargesForm key=\{settings\.version\} settings=\{settings\} \/>;/);
  // The saved answer replaces the cache, which bumps the version and remounts the form.
  assert.match(view, /qc\.setQueryData\(\["website", "settings"\], res\)/);
});

test("a rejected rule never lands in the list; its fieldErrors name the row", () => {
  const view = src("components/settings/RulesChargesView.jsx");
  // The lists are the server's, not local state an Add can change ahead of the save.
  assert.doesNotMatch(view, /setCoupons|setSlabs|setFreeRules/);
  assert.match(view, /const coupons = settings\.couponsConfig \|\| \[\];/);
  assert.match(view, /if \(!COUPON_CODE\.test\(code\)\)/);

  const sent = {
    couponsConfig: [{ code: "WELCOME50" }, { code: "SAVE-10" }],
    ordering: { deliverySlabsConfig: { maxDistanceKm: 50, slabs: [{ minKm: 0, maxKm: 3 }, { minKm: 3, maxKm: 40 }] } },
  };
  assert.deepEqual(
    fieldErrorLines(
      {
        "couponsConfig.1.code": "Use 3 to 20 letters or digits.",
        "ordering.deliverySlabsConfig.maxDistanceKm": "Max distance must be from 0.5 to 30 km.",
        "ordering.deliverySlabsConfig.slabs.1": "Use 0 to 30 km, with the end after the start.",
        couponsConfig: "Up to 30 coupons.",
      },
      sent,
    ),
    [
      "SAVE-10: Use 3 to 20 letters or digits.",
      "Max distance must be from 0.5 to 30 km.",
      "3–40 km: Use 0 to 30 km, with the end after the start.",
      "Up to 30 coupons.",
    ],
  );
  assert.deepEqual(fieldErrorLines(undefined, {}), []);
});

test("Manage Website's full save never sends the Rules & Charges lists", () => {
  const loaded = {
    theme: "classic",
    couponsConfig: [{ code: "OLD" }],
    freeItemConfig: [{ itemName: "Old" }],
    ordering: { pickupEnabled: true, deliverySlabsConfig: { maxDistanceKm: 7 }, minOrderConfig: { website: {} } },
  };
  assert.deepEqual(withoutRulesKeys(loaded), { theme: "classic", ordering: { pickupEnabled: true } });
  assert.equal(loaded.couponsConfig.length, 1, "the editor's own copy is untouched");
  assert.ok(loaded.ordering.deliverySlabsConfig);
  assert.match(src("pages/WebsiteSettings.jsx"), /: withoutRulesKeys\(settings\)\);/);
  // The server writes these lists only from a body without `version` (rulesEdit in
  // websiteSettingsController), so Rules & Charges, their one owner, must never send it.
  assert.doesNotMatch(src("components/settings/RulesChargesView.jsx"), /\bversion\s*:/);
});
