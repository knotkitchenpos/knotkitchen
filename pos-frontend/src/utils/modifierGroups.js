/**
 * How many options a modifier group allows, and which radio the editor shows.
 *
 * The rule was written out by hand in five places and they disagreed. The
 * Manage Menu editor read an ABSENT `maxSelectionEnabled` as OFF
 * (`=== true`), while the POS panel, the storefront and the server all read
 * the same absent field as ON (`!== false`). A group could therefore show
 * "Maximum Selection: off" in the editor and still refuse the sixth option at
 * the till -- which is exactly what "OFF still limits to 5" was.
 *
 * One rule now, matching the schema default and the editor: a cap applies only
 * when the flag is EXPLICITLY true. Mirrors services/modifierGroups.js on the
 * server, which is the authority.
 */

/** The maximum number of option-units. Infinity when Maximum Selection is off. */
export const capOf = (group) => {
  if (group?.maxSelectionEnabled !== true) return Infinity;
  return Math.max(1, Number(group?.maxSelections) || 1);
};

/**
 * Which radio the editor should show for a saved group.
 *
 * "Single Choice" is stored as a cap of exactly one -- that is what the editor
 * writes for it -- so anything else is Multiple. Deriving this was simply
 * MISSING: opening a group set every other field from the saved data but left
 * selectionType at whatever it happened to be, defaulting to "single". The
 * editor then showed Single for a Multiple group, and saving from that stale
 * state wrote Single back, which is why edits appeared to revert.
 */
export const selectionTypeOf = (group) =>
  capOf(group) === 1 ? "single" : "multiple";

/**
 * A group as Manage Menu sends it to attach it to products: every rule stated.
 * A payload without maxSelectionEnabled used to be read as "Maximum
 * Selection off", which turned choose-one groups into choose-any.
 */
export const groupForSave = (g) => ({
  name: g.name,
  required: Boolean(g.required),
  maxSelectionEnabled: g.maxSelectionEnabled === true,
  maxSelections: Number(g.maxSelections) || 1,
  isActive: g.isActive !== false,
  options: Array.isArray(g.options) ? g.options : [],
});

/**
 * What the group editor saves, every rule stated whatever the operator
 * touched. Sending only the changed ones left products an old bug had turned
 * choose-any unrepairable: the form showed Single, nothing was sent, and each
 * product kept its own (damaged) rule. Manage Menu has no per-product rule,
 * so the group's rules are the products' rules. No `dishIds` when there are
 * none: that is a save to the store's list only.
 */
export const groupEditorPayload = ({ name, oldName, required, selectionType, maxEnabled, max, options, dishIds }) => {
  const single = selectionType === "single";
  return {
    groupName: String(name || "").trim(),
    oldGroupName: oldName || undefined,
    required: Boolean(required),
    // "Single" is a cap of one by definition; "Multiple" is capped only with
    // Maximum Selection on.
    maxSelectionEnabled: single || maxEnabled === true,
    maxSelections: single ? 1 : Math.max(1, Number(max) || 1),
    options: (options || []).map((e) => ({ name: String(e.name || "").trim(), price: Number(e.price) || 0 })),
    ...(dishIds && dishIds.size ? { dishIds: Array.from(dishIds) } : {}),
  };
};

/** Two copies of a group that sell differently (required, or how many). */
const rulesDiffer = (a, b) => Boolean(a.required) !== Boolean(b.required) || capOf(a) !== capOf(b);

/**
 * Manage Menu's group list: the store's saved groups (`savedGroups`) plus any
 * group found only on products, with the products each is attached to.
 *
 * A group's rules and list position come from its saved row. Products only add
 * their ids, their options, and "off" (off anywhere means off). Rules used to
 * be copied from whichever product was read last, so one product with a
 * damaged group made the editor show "Multiple", and the next save spread
 * choose-any to every product. A group with no saved row takes the first
 * product's. `mixedIds` holds the products whose own copy sells differently
 * from those rules (damage from the old product save / Add Group), so the
 * page can say so instead of hiding it.
 */
export const groupLibrary = (savedGroups, menus) => {
  const map = new Map();
  (savedGroups || []).forEach((g) => {
    if (!g || !g.name) return;
    map.set(g.name, {
      name: g.name,
      required: Boolean(g.required),
      maxSelectionEnabled: g.maxSelectionEnabled === true,
      maxSelections: g.maxSelections || 1,
      isActive: g.isActive !== false,
      sortOrder: Number(g.sortOrder) || 0,
      options: Array.isArray(g.options) ? g.options : [],
      dishIds: new Set(),
      mixedIds: new Set(),
    });
  });

  (Array.isArray(menus) ? menus : []).forEach((menu) => {
    (menu?.items || []).forEach((item) => {
      if (!item) return;
      (item.modifierGroups || []).forEach((group) => {
        if (!group || !group.name) return;
        const options = Array.isArray(group.options) ? group.options : [];
        const entry = map.get(group.name);
        if (!entry) {
          map.set(group.name, {
            name: group.name,
            required: Boolean(group.required),
            maxSelectionEnabled: group.maxSelectionEnabled === true,
            maxSelections: group.maxSelections || 1,
            isActive: group.isActive !== false,
            sortOrder: Number(group.sortOrder) || 0,
            options,
            dishIds: new Set([String(item._id)]),
            mixedIds: new Set(),
          });
          return;
        }
        entry.dishIds.add(String(item._id));
        if (rulesDiffer(group, entry)) entry.mixedIds.add(String(item._id));
        if (options.length) entry.options = options;
        if (group.isActive === false) entry.isActive = false;
      });
    });
  });
  return map;
};
