/**
 * 003 — seed the System and Website menu snapshots from the current draft.
 *
 * The POS and the customer website now read ONLY their published snapshot;
 * the old fallback to `menu.items` is gone (see services/menuCache.js). For a
 * store that has never pressed Publish — or a category created since its last
 * publish — that fallback was the only reason its items were visible at all.
 * Without this backfill, shipping that change would empty live tills and live
 * storefronts.
 *
 * So: every menu's snapshots are seeded from whatever it is serving RIGHT NOW.
 * The visible catalogue is therefore byte-identical the moment this runs, and
 * the publish contract starts applying to changes made from then on.
 *
 * Menus that already have a snapshot for a target are LEFT ALONE — that
 * snapshot is a deliberate published state and must not be overwritten with
 * newer unpublished draft edits.
 *
 * Idempotent — safe to re-run.
 */
const mongoose = require("mongoose");
const config = require("../config/config");

const run = async () => {
  const Menu = require("../models/menuModel");

  await mongoose.connect(config.databaseURI);

  const menus = await Menu.find({ isDeleted: { $ne: true } });
  const now = new Date();

  let seededSystem = 0;
  let seededWebsite = 0;
  let untouched = 0;

  for (const menu of menus) {
    const items = JSON.parse(JSON.stringify(menu.items || []));
    let changed = false;

    if (!menu.hasPublishedToSystem || !menu.systemSnapshot || !menu.systemSnapshot.items) {
      menu.hasPublishedToSystem = true;
      menu.lastPublishedToSystemAt = menu.lastPublishedToSystemAt || now;
      menu.systemVersion = menu.systemVersion || 1;
      menu.systemSnapshot = { name: menu.name, items };
      seededSystem += 1;
      changed = true;
    }

    if (!menu.hasPublishedToWebsite || !menu.websiteSnapshot || !menu.websiteSnapshot.items) {
      menu.hasPublishedToWebsite = true;
      menu.lastPublishedToWebsiteAt = menu.lastPublishedToWebsiteAt || now;
      menu.websiteVersion = menu.websiteVersion || 1;
      menu.websiteSnapshot = { name: menu.name, items };
      seededWebsite += 1;
      changed = true;
    }

    if (!changed) {
      untouched += 1;
      continue;
    }

    try {
      await menu.save();
    } catch (err) {
      console.warn(`  ! menu ${menu._id} failed to save: ${err.message}`);
    }
  }

  console.log(
    `Migration complete. ${menus.length} menu(s) inspected — ` +
      `system snapshot seeded on ${seededSystem}, website snapshot seeded on ${seededWebsite}, ` +
      `${untouched} already published and left untouched.`
  );
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
