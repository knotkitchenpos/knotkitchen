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

module.exports = { isCapEnabled, capFor, normalizeCap };
