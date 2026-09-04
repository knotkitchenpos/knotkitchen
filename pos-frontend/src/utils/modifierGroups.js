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
