/**
 * Backfill storefront configuration for stores that existed before the
 * multi-tenant website feature shipped (§35).
 *
 * Safe to run repeatedly — provisionWebsiteForStore() is idempotent and will
 * never change an existing slug (which would break shared customer links).
 *
 *   node scripts/backfillWebsiteSettings.js
 *   node scripts/backfillWebsiteSettings.js --dry-run
 */
require("dotenv").config();
const mongoose = require("mongoose");
const config = require("../config/config");
const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");
const WebsiteSettings = require("../models/websiteSettingsModel");
const { provisionWebsiteForStore, buildStorefrontUrl } = require("../services/websiteProvisioningService");

const DRY_RUN = process.argv.includes("--dry-run");

(async () => {
  try {
    await mongoose.connect(config.databaseURI);
    console.log("✅ Connected to", config.databaseURI.replace(/\/\/[^@]*@/, "//***@"));

    const stores = await Store.find({ isDeleted: { $ne: true } });
    console.log(`Found ${stores.length} store(s).`);

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const store of stores) {
      const existing = await WebsiteSettings.findOne({ storeId: store.storeId });
      if (existing) {
        skipped += 1;
        console.log(`  ↷ ${store.storeId} ${store.storeName} — already provisioned (/${existing.slug})`);
        continue;
      }

      if (DRY_RUN) {
        created += 1;
        console.log(`  + ${store.storeId} ${store.storeName} — WOULD provision`);
        continue;
      }

      try {
        const restaurant = store.restaurantId ? await Restaurant.findById(store.restaurantId) : null;
        const settings = await provisionWebsiteForStore({
          storeId: store.storeId,
          storeName: store.storeName,
          restaurantId: store.restaurantId,
          currency: restaurant?.currency,
          contact: {
            phone: store.ownerPhone || "",
            addressLine1: restaurant?.address?.line1 || "",
            city: restaurant?.address?.city || "",
            postalCode: restaurant?.address?.postalCode || "",
          },
        });
        created += 1;
        console.log(`  ✓ ${store.storeId} ${store.storeName} -> ${buildStorefrontUrl(settings)}`);
      } catch (err) {
        failed += 1;
        console.error(`  ✗ ${store.storeId} ${store.storeName} — ${err.message}`);
      }
    }

    console.log(`\nDone. provisioned=${created} skipped=${skipped} failed=${failed}${DRY_RUN ? " (dry run)" : ""}`);
    await mongoose.disconnect();
    process.exit(failed ? 1 : 0);
  } catch (error) {
    console.error("Backfill failed:", error);
    process.exit(1);
  }
})();
