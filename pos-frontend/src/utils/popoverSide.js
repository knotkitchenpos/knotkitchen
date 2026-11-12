/**
 * Which side a dropdown should open from its button.
 *
 * Menus here hang from the button's right edge, which suits a toolbar on the
 * right of a wide screen. On a phone the toolbar wraps to the left, and a menu
 * wider than the space to the button's right edge ran off the screen with its
 * options cut off (Reports → Export, Manage Menu → Manage). Measured when the
 * menu opens: true means anchor it to the button's LEFT edge instead.
 */
export const opensFromLeft = (anchorEl, menuWidth, margin = 8) => {
  const r = anchorEl?.getBoundingClientRect?.();
  return Boolean(r) && r.right - menuWidth < margin;
};
