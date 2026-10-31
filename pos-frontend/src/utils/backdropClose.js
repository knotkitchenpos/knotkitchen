// The backdrop the current press started on. Kept outside the props: tapping
// the backdrop blurs a field, and the re-render that follows would hand out
// fresh props that never saw the press.
let pressedOn = null;

/**
 * Props for a drawer's or dialog's dark backdrop: a tap on the backdrop
 * itself closes it (owner, 2026-10-31). Only a press that starts AND ends on
 * the backdrop counts, so selecting text in a field and letting go outside
 * the panel does not throw the form away.
 *
 *   <div className="fixed inset-0 ..." {...backdropClose(onClose)}>
 */
export const backdropClose = (onClose) => ({
  onPointerDown: (e) => {
    pressedOn = e.target === e.currentTarget ? e.currentTarget : null;
  },
  onClick: (e) => {
    const started = pressedOn;
    pressedOn = null;
    if (started === e.currentTarget && e.target === e.currentTarget) onClose?.();
  },
});
