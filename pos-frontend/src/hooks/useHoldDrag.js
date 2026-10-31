import { useEffect, useRef, useState } from "react";
import { HOLD_MS } from "./useHoldReorder.js";

// A finger or mouse that moves this far before the hold is up is not holding.
const SLOP_PX = 8;
// Always this much of the box stays on screen, so it can be grabbed again.
const KEEP_PX = 48;

const readPos = (key) => {
  try {
    const p = JSON.parse(localStorage.getItem(key) || "null");
    return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? p : null;
  } catch {
    return null;
  }
};

/** `pos` kept on screen for a box `w` x `h`. */
export const clampPos = (pos, w, h, vw, vh) => ({
  x: Math.min(Math.max(pos.x, KEEP_PX - w), vw - KEEP_PX),
  y: Math.min(Math.max(pos.y, 0), vh - KEEP_PX),
});

/**
 * Hold a floating box, then drag it anywhere on screen (owner, 2026-10-31).
 * Where it was left is kept on this device under `storageKey`.
 *
 * bind goes on the box. Buttons inside it keep working: a press on one never
 * lifts it. `style` is null until the box has been moved; spread it after the
 * box's own position classes so it wins.
 */
export const useHoldDrag = (storageKey) => {
  const [pos, setPos] = useState(() => readPos(storageKey));
  const [dragging, setDragging] = useState(false);
  const hold = useRef(null);
  const drag = useRef(null); // { dx, dy, w, h, pos }

  useEffect(() => {
    const cancelHold = () => {
      clearTimeout(hold.current?.timer);
      hold.current = null;
    };
    const onMove = (e) => {
      const d = drag.current;
      if (!d) {
        if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > SLOP_PX) cancelHold();
        return;
      }
      d.pos = clampPos({ x: e.clientX - d.dx, y: e.clientY - d.dy }, d.w, d.h, window.innerWidth, window.innerHeight);
      setPos(d.pos);
    };
    const onUp = () => {
      cancelHold();
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      setDragging(false);
      try {
        localStorage.setItem(storageKey, JSON.stringify(d.pos));
      } catch {
        /* kept for this visit only */
      }
    };
    // Non-passive, or the browser scrolls instead of letting the box move.
    const noScroll = (e) => {
      if (drag.current && e.cancelable) e.preventDefault();
    };
    // A box left near an edge of a bigger screen stays reachable on a smaller one.
    const onResize = () =>
      setPos((p) => (p ? clampPos(p, 0, 0, window.innerWidth, window.innerHeight) : p));
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", noScroll, { passive: false });
    window.addEventListener("resize", onResize);
    return () => {
      cancelHold();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", noScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [storageKey]);

  const bind = {
    onPointerDown: (e) => {
      if (e.button !== 0 || e.target.closest("button, a, input, select, textarea")) return;
      const box = e.currentTarget.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;
      clearTimeout(hold.current?.timer);
      const timer = setTimeout(() => {
        hold.current = null;
        drag.current = { dx: x - box.left, dy: y - box.top, w: box.width, h: box.height, pos: { x: box.left, y: box.top } };
        setDragging(true);
        setPos(drag.current.pos);
        navigator.vibrate?.(30);
      }, HOLD_MS);
      hold.current = { x, y, timer };
    },
    // A long press on a phone would otherwise open the copy / share menu.
    onContextMenu: (e) => e.preventDefault(),
  };

  const style = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : null;
  return { bind, style, dragging };
};
