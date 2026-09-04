/**
 * 007 - give existing modifier groups a sortOrder.
 *
 * Groups gained a `sortOrder` when drag-and-drop reordering was added, but
 * groups created before that have the field unset. The reorder endpoint writes
 * it, yet until someone reorders a product's groups by hand there is nothing
 * to sort by, so ordering silently falls back to insertion order and a
 * reordered list can appear not to have saved.
 *
 * This stamps the CURRENT order -- the array order the operator already sees --
 * as 0,1,2..., so nothing visibly moves. It only makes the existing order
 * explicit and therefore stable.
 *
 * Both the draft (`items`) and the two published snapshots are stamped, so the
 * POS and website do not disagree with Manage Menu about group order.
 *
 * Raw driver, no Mongoose model - see 004 for why.
 *
 * Idempotent - safe to re-run. Groups that already have a sortOrder keep it.
 */
const mongoose = require("mongoose");
const config = require("../config/config");

const LISTS = ["items", "systemSnapshot.items", "websiteSnapshot.items"];

const getList = (menu, path) =>
  path === "items" ? menu.items : (menu[path.split(".")[0]] || {}).items;

const run = async () => {
  await mongoose.connect(config.databaseURI);
  const menus = mongoose.connection.collection("menus");

  const docs = await menus.find({ isDeleted: { $ne: true } }).toArray();
  let stamped = 0;
  let touchedMenus = 0;

  for (const menu of docs) {
    const update = {};

    for (const path of LISTS) {
      const list = getList(menu, path);
      if (!Array.isArray(list)) continue;

      list.forEach((item, itemIdx) => {
        const groups = item?.modifierGroups;
        if (!Array.isArray(groups) || groups.length === 0) return;

        groups.forEach((group, groupIdx) => {
          if (group && typeof group.sortOrder === "number") return;
          update[`${path}.${itemIdx}.modifierGroups.${groupIdx}.sortOrder`] = groupIdx;
          stamped += 1;
        });
      });
    }

    if (Object.keys(update).length > 0) {
      await menus.updateOne({ _id: menu._id }, { $set: update });
      touchedMenus += 1;
      console.log(`   ${menu.name}: stamped ${Object.keys(update).length} group(s)`);
    }
  }

  if (stamped === 0) {
    console.log("Every modifier group already has a sortOrder - nothing to do.");
  } else {
    console.log(`\nStamped ${stamped} group(s) across ${touchedMenus} menu(s).`);
  }

  // Report what is left, so a partial run is visible rather than assumed.
  const after = await menus.find({ isDeleted: { $ne: true } }).toArray();
  let remaining = 0;
  for (const menu of after) {
    for (const path of LISTS) {
      const list = getList(menu, path);
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        for (const g of item?.modifierGroups || []) {
          if (typeof g?.sortOrder !== "number") remaining += 1;
        }
      }
    }
  }
  console.log(remaining === 0 ? "All groups now carry a sortOrder." : `WARNING: ${remaining} still unset.`);

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
