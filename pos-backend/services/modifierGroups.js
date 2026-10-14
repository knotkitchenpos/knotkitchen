/**
 * How many options a modifier group allows.
 *
 * This rule was written out by hand in five places and they disagreed, which
 * is the whole bug: the Manage Menu editor read an ABSENT `maxSelectionEnabled`
 * as OFF (`=== true`), while every consumer read the same absent field as ON
 * (`!== false`). So a group could show "Maximum Selection: off" in the editor
 * and still refuse the sixth option at the till.
 *
 * One rule now, matching the schema default (`maxSelectionEnabled: false`) and
 * what the editor shows: a cap applies only when the flag is EXPLICITLY true.
 * Every write path stores it explicitly, and migration 008 backfilled the
 * groups that predate the field, so "absent" no longer occurs in practice.
 */

/** Does this group cap selections at all? */
const isCapEnabled = (group) => group?.maxSelectionEnabled === true;

/**
 * The maximum number of option-units this group accepts.
 * Infinity when Maximum Selection is off -- "no limit" means no limit.
 */
const capFor = (group) => {
  if (!isCapEnabled(group)) return Infinity;
  return Math.max(1, Number(group?.maxSelections) || 1);
};

/**
 * Normalise what a client sent into the pair that gets stored, so no write
 * path can persist one without the other and leave the group ambiguous again.
 */
const normalizeCap = ({ maxSelectionEnabled, maxSelections } = {}) => ({
  maxSelectionEnabled: maxSelectionEnabled === true || maxSelectionEnabled === "true",
  // The number is kept even while the cap is off, so switching Maximum
  // Selection back on restores the figure the operator last chose instead
  // of silently resetting it to 1.
  maxSelections: Math.max(1, Number(maxSelections) || 1),
});

/**
 * A group's rules from what a client sent, with anything it left out taken
 * from `base` (the group as stored, or the store's group list). Absent means
 * "unchanged", never "off": the product drawer, bulk add and component delete
 * sent no `maxSelectionEnabled`, normalizeCap read that as false, and every
 * such save turned a choose-one group into choose-any. The cap moves as a
 * pair (flag and number), from the side that states the flag, sent first.
 */
const groupRules = (sent = {}, base = {}) => ({
  required: Boolean(sent.required ?? base.required),
  ...normalizeCap(sent.maxSelectionEnabled == null && base.maxSelectionEnabled != null ? base : sent),
});

/** Options as stored: name, price and availability. Nameless lines are dropped. */
const cleanGroupOptions = (options) =>
  (Array.isArray(options) ? options : [])
    .filter((o) => o && String(o.name || "").trim())
    .map((o) => ({
      name: String(o.name).trim(),
      price: Number.isFinite(Number(o.price)) ? Number(o.price) : 0,
      isAvailable: o.isAvailable !== false,
    }));

/**
 * A group joining a product (bulk add, a group ticked in the product drawer).
 * No rule is being edited, so the rules and on/off come from the store's group
 * list (`lib`, the operator's last explicit edit). Only a group the list lacks
 * falls back to what the client sent.
 */
const attachedGroup = (name, sent = {}, lib = null) => {
  const options = cleanGroupOptions(sent.options);
  return {
    name,
    ...groupRules(lib || sent),
    isActive: (lib || sent).isActive !== false,
    options: options.length ? options : cleanGroupOptions(lib?.options),
  };
};

/**
 * A product's groups after a save that lists them (the product drawer). The
 * list says which groups and in what order, nothing else: a group the product
 * already has is kept exactly as stored (rules, options, ids, on/off) and only
 * takes its new position. A new one is built by attachedGroup.
 * `library` maps a group name to its row in the store's group list.
 */
const placeGroups = (current = [], sent = [], library = new Map()) => {
  const have = new Map((current || []).map((g) => [g.name, g]));
  const out = [];
  for (const s of Array.isArray(sent) ? sent : []) {
    const name = String(s?.name || "").trim();
    if (!name || out.some((g) => g.name === name)) continue;
    const g = have.get(name) || attachedGroup(name, s, library.get(name));
    g.sortOrder = out.length;
    out.push(g);
  }
  return out;
};

/**
 * Saving a group's option list sends name and price only. Each option keeps
 * the id and availability of its stored namesake, so a save does not switch
 * a sold-out option back on or give every option a new id.
 */
const keepOptionState = (sent, stored = []) =>
  sent.map((o) => {
    const prev = (stored || []).find((p) => p.name === o.name);
    return prev ? { ...o, _id: prev._id, isAvailable: o.isAvailable ?? prev.isAvailable } : o;
  });

module.exports = {
  isCapEnabled,
  capFor,
  normalizeCap,
  groupRules,
  cleanGroupOptions,
  attachedGroup,
  placeGroups,
  keepOptionState,
};
