/**
 * 013 - put each product's modifier-group rules back to the group's.
 *
 * Until 2026-10-12, saving a product and Add Group sent a group without
 * `maxSelectionEnabled`, and the server read the silence as "Maximum Selection
 * off". A choose-one Bread group became choose-any on the products (all 18
 * sandwiches) while the store's group list (menugroups) kept choose-one, so
 * guests could pick 2 breads. The fixed code no longer does this, but nothing
 * repairs what it already did.
 *
 * Manage Menu has no per-product rule: the group editor writes the list row
 * and every product together. So a product whose copy sells differently from
 * the row (required, or how many may be picked) is damage, and takes the row's
 * required / maxSelectionEnabled / maxSelections. On/off and options are not
 * touched.
 *
 * The draft (`items`) is repaired, and a published copy (systemSnapshot for
 * tills and table QR, websiteSnapshot for the website and Knot Eats) only for
 * a product and group whose draft was damaged too. A published copy that
 * differs while its draft is right is an unpublished edit, left for Publish.
 * Groups with no list row are only listed: nothing says which copy is right.
 * The Groups list marks them "Rules differ"; Edit Group, then Save, fixes one.
 *
 * Dry run by default, listing every change. `--apply` writes them.
 *   node migrations/013-repair-group-rules.js
 *   node migrations/013-repair-group-rules.js --apply
 *
 * Raw driver, no Mongoose model - see 004 for why. Idempotent.
 */
const mongoose = require("mongoose");

const SNAPSHOTS = ["systemSnapshot", "websiteSnapshot"];

// services/modifierGroups capFor: a cap only when the flag is explicitly on.
const capOf = (g) => (g?.maxSelectionEnabled === true ? Math.max(1, Number(g.maxSelections) || 1) : Infinity);
const differs = (g, row) => Boolean(g.required) !== Boolean(row.required) || capOf(g) !== capOf(row);
const describe = (g) => `${g.required ? "required" : "optional"}, ${capOf(g) === Infinity ? "any number" : `max ${capOf(g)}`}`;

/**
 * The $set that repairs one menu document, with a line per change.
 * `rows` maps a group name to the store's list row.
 */
const repairsFor = (menu, rows) => {
  const set = {};
  const lines = [];
  const fix = (path, item, g, row, where) => {
    set[`${path}.required`] = Boolean(row.required);
    set[`${path}.maxSelectionEnabled`] = row.maxSelectionEnabled === true;
    set[`${path}.maxSelections`] = Math.max(1, Number(row.maxSelections) || 1);
    lines.push(`${menu.name} / ${item.name} / ${g.name} [${where}]: ${describe(g)} -> ${describe(row)}`);
  };
  (menu.items || []).forEach((item, i) => {
    (item?.modifierGroups || []).forEach((g, j) => {
      const row = g && rows.get(g.name);
      if (!row || !differs(g, row)) return;
      fix(`items.${i}.modifierGroups.${j}`, item, g, row, "draft");
      for (const snap of SNAPSHOTS) {
        const list = menu[snap]?.items || [];
        const k = list.findIndex((x) => String(x?._id) === String(item._id));
        const groups = list[k]?.modifierGroups || [];
        const gi = groups.findIndex((x) => x?.name === g.name);
        if (gi < 0 || !differs(groups[gi], row)) continue;
        fix(`${snap}.items.${k}.modifierGroups.${gi}`, list[k], groups[gi], row, snap);
      }
    });
  });
  return { set, lines };
};

/** Groups with no list row whose products disagree among themselves, as lines. */
const unlistedMixed = (menus, rows) => {
  const seen = new Map();
  for (const menu of menus) {
    for (const item of menu.items || []) {
      for (const g of item?.modifierGroups || []) {
        if (!g?.name || rows.has(g.name)) continue;
        if (!seen.has(g.name)) seen.set(g.name, new Set());
        seen.get(g.name).add(describe(g));
      }
    }
  }
  return [...seen].filter(([, rules]) => rules.size > 1).map(([name, rules]) => `${name}: ${[...rules].join(" / ")}`);
};

const run = async () => {
  const apply = process.argv.includes("--apply");
  const config = require("../config/config");
  await mongoose.connect(config.databaseURI);
  const db = mongoose.connection;

  const stores = new Map();
  for (const row of await db.collection("menugroups").find({}).toArray()) {
    const scope = row.restaurantId ? { restaurantId: row.restaurantId } : { createdBy: row.createdBy };
    const key = JSON.stringify(scope);
    if (!stores.has(key)) stores.set(key, { scope, rows: new Map() });
    stores.get(key).rows.set(row.name, row);
  }

  let changes = 0;
  for (const { scope, rows } of stores.values()) {
    const menus = await db.collection("menus").find({ ...scope, isDeleted: { $ne: true } }).toArray();
    for (const menu of menus) {
      const { set, lines } = repairsFor(menu, rows);
      if (!lines.length) continue;
      lines.forEach((l) => console.log(`   ${l}`));
      changes += lines.length;
      if (apply) await db.collection("menus").updateOne({ _id: menu._id }, { $set: set });
    }
    for (const l of unlistedMixed(menus, rows)) console.log(`   NOT CHANGED (no list row) ${l}`);
  }

  if (!changes) console.log("Every product sells its groups as the group list says - nothing to do.");
  else console.log(`\n${changes} group cop(ies) ${apply ? "repaired" : "would be repaired; re-run with --apply to write"}.`);
  await mongoose.disconnect();
};

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { repairsFor, unlistedMixed };
