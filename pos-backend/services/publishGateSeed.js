/**
 * One-time seed for the website publish gate.
 *
 * Before the gate, the customer website served the Manage Menu draft and the
 * Manage Website draft directly. Now it serves only what was published. So
 * that no live store went blank the moment the gate arrived, this runs once
 * at boot and makes each store's then-live draft its published copy:
 *
 *   - every menu never published to the website gets websiteSnapshot = draft
 *   - every website settings document without a publishedSnapshot gets one
 *
 * Guarded by a flag document, so a category created after this never gets
 * auto-published by a restart.
 */
const mongoose = require("mongoose");

const FLAG = "website-publish-gate-seeded-v1";

const seedPublishGate = async () => {
  if (mongoose.connection?.readyState !== 1) return { skipped: "not connected" };
  const flags = mongoose.connection.db.collection("system_flags");
  const done = await flags.findOne({ key: FLAG });
  if (done) return { skipped: "already seeded" };

  const Menu = require("../models/menuModel");
  const WebsiteSettings = require("../models/websiteSettingsModel");
  const { snapshotForPublish } = require("./websitePublish");
  const now = new Date();

  let menus = 0;
  const cursor = Menu.find({ isDeleted: { $ne: true }, hasPublishedToWebsite: { $ne: true } }).cursor();
  for await (const menu of cursor) {
    await Menu.updateOne(
      { _id: menu._id },
      {
        $set: {
          hasPublishedToWebsite: true,
          lastPublishedToWebsiteAt: now,
          websiteVersion: (menu.websiteVersion || 0) + 1,
          websiteSnapshot: { name: menu.name, items: JSON.parse(JSON.stringify(menu.items || [])) },
        },
      },
    );
    menus += 1;
  }

  let settings = 0;
  const scursor = WebsiteSettings.find({ isDeleted: { $ne: true }, publishedSnapshot: null }).cursor();
  for await (const doc of scursor) {
    await WebsiteSettings.updateOne({ _id: doc._id }, { $set: { publishedSnapshot: snapshotForPublish(doc) } });
    settings += 1;
  }

  await flags.insertOne({ key: FLAG, at: now, menus, settings });
  return { menus, settings };
};

module.exports = { seedPublishGate, FLAG };
