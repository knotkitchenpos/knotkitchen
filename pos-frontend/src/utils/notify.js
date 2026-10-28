import { closeSnackbar, enqueueSnackbar as show } from "notistack";

/**
 * The POS's pop-ups, with one rule for which ones appear (owner, 2026-10-29:
 * "only give the important alert popups as it is disturbing in mobile
 * screen").
 *
 * Errors, warnings and info always show: something failed, needs fixing, or
 * needs doing. A success shows only when marked `important`: money moved, a
 * message went to a customer, offline orders synced, a printer connected, a
 * link was copied. A routine "Saved!" or "Order completed!" only repeats what
 * the screen already shows, so it is dropped.
 *
 *   enqueueSnackbar("Balance added.", { variant: "success", important: true });
 *
 * Every screen imports enqueueSnackbar from here, never from notistack.
 */
export const enqueueSnackbar = (message, { important = false, ...options } = {}) => {
  if (options.variant === "success" && !important) return null;
  return show(message, options);
};

export { closeSnackbar };
