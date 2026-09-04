/**
 * 008 - make every modifier group's Maximum Selection state explicit.
 *
 * `maxSelectionEnabled` was added to the schema after groups already existed,
 * and two write paths (bulkAddGroupToDishes, addModifierGroup) persisted
 * `maxSelections` without ever setting it. Mongoose only applies a subdocument
 * default when the subdocument is created, so those groups carry no value at
 * all -- every group in production had `maxSelections: 5` and no flag.
 *
 * Absent then meant different things in different places: the Manage Menu
 * editor read it as OFF, every consumer read it as ON. That is why a group
 * could show "Maximum Selection: off" and still refuse the sixth option.
 *
 * Stamping the field removes the ambiguity. The value is chosen to preserve
 * what the operator intended, not to blanket-apply one answer:
 *
 *   maxSelections <= 1  ->  ON   A cap of one is a single-choice group. Left
 *                                off it would become "pick as many as you
 *                                like", which is not what "choose 1" means.
 *   maxSelections >  1  ->  OFF  This is the ambiguous case, and OFF is what
 *                                the editor has been showing the operator all
 *                                along. Behaviour now matches the screen.
 *
 * Applied to the draft and both published snapshots so the tills, the website
 * and Manage Menu agree.
 *
 * Raw driver, no Mongoose model - see 004 for why.
 *
 * Idempotent - safe to re-run. A group that already has the flag keeps it.
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
  let on = 0;
  let off = 0;
  let touched = 0;

  for (const menu of docs) {
    const update = {};

    for (const path of LISTS) {
      const list = getList(menu, path);
      if (!Array.isArray(list)) continue;

      list.forEach((item, itemIdx) => {
        (item?.modifierGroups || []).forEach((group, groupIdx) => {
          if (!group || typeof group.maxSelectionEnabled === "boolean") return;

          const max = Number(group.maxSelections) || 1;
          const enabled = max <= 1;
          update[`${path}.${itemIdx}.modifierGroups.${groupIdx}.maxSelectionEnabled`] = enabled;
          if (enabled) on += 1;
          else off += 1;

          if (path === "items") {
            console.log(
              `   ${menu.name} / ${item.name} / ${group.name}: max ${max} -> ` +
                `Maximum Selection ${enabled ? "ON" : "OFF (no limit)"}`,
            );
          }
        });
      });
    }

    if (Object.keys(update).length > 0) {
      await menus.updateOne({ _id: menu._id }, { $set: update });
      touched += 1;
    }
  }

  if (on + off === 0) {
    console.log("Every group already states its Maximum Selection - nothing to do.");
  } else {
    console.log(`\nStamped ${on + off} group entr(ies) across ${touched} menu(s):`);
    console.log(`   ON  (single choice, cap kept): ${on}`);
    console.log(`   OFF (no limit):                ${off}`);
  }

  const after = await menus.find({ isDeleted: { $ne: true } }).toArray();
  let remaining = 0;
  for (const menu of after) {
    for (const path of LISTS) {
      const list = getList(menu, path);
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        for (const g of item?.modifierGroups || []) {
          if (typeof g?.maxSelectionEnabled !== "boolean") remaining += 1;
        }
      }
    }
  }
  console.log(remaining === 0 ? "All groups now state it explicitly." : `WARNING: ${remaining} still unset.`);

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
