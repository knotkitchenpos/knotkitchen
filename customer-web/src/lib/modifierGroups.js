/**
 * How many options a modifier group allows.
 *
 * Mirrors `pos-frontend/src/utils/modifierGroups.js` and, behind it,
 * `pos-backend/services/modifierGroups.js`, which is the authority. A cap
 * applies only when Maximum Selection is EXPLICITLY on.
 *
 * The customer website did not have this and read `maxSelections` directly.
 * That field defaults to 1, so every uncapped group behaved as "pick one": a
 * section the restaurant had set to "choose any" let a customer add a single
 * drink and silently ignored the next tap.
 */
export const capOf = (group) => {
  if (group?.maxSelectionEnabled !== true) return Infinity;
  return Math.max(1, Number(group?.maxSelections) || 1);
};

/** How the cap should read to a customer. */
export const capLabel = (group) => {
  const cap = capOf(group);
  if (cap === Infinity) return "Choose any";
  return cap === 1 ? "Choose 1" : `Choose up to ${cap}`;
};
