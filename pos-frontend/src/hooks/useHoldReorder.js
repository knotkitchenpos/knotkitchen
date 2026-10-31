import { useEffect, useRef, useState } from "react";

// How long a card is held before it lifts and follows the finger. Shorter and
// a slow scroll picked tables up by mistake.
export const HOLD_MS = 450;
// A finger or mouse that moves this far before the hold is up is scrolling.
const SLOP_PX = 8;

/** `ids` with `id` moved to where `target` is. */
export const moveId = (ids, id, target) => {
  const from = ids.indexOf(id);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = ids.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
};

/**
 * Hold a card, then drag it to a new place among the others (owner,
 * 2026-10-31). No library: pointer events, so it works by touch and mouse.
 *
 * bind(id) goes on each card's wrapper; the card under the finger is found by
 * its data-reorder-id. Buttons inside a card keep working: a press on one
 * never lifts the card. While a card is lifted, `order` is the order to show
 * and a finger that moves drags it instead of scrolling the page. On release
 * onDrop gets the new order, only if it changed, and the tap that ends the
 * drag does not open the card.
 */
export const useHoldReorder = ({ ids, onDrop }) => {
  const [dragId, setDragId] = useState(null);
  const [order, setOrder] = useState(null);
  const hold = useRef(null);
  const dragging = useRef(null); // { id, start, order }
  const swallowClick = useRef(false);
  const latest = useRef({ ids, onDrop });
  latest.current = { ids, onDrop };

  useEffect(() => {
    const cancelHold = () => {
      clearTimeout(hold.current?.timer);
      hold.current = null;
    };
    const onMove = (e) => {
      const d = dragging.current;
      if (!d) {
        if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > SLOP_PX) cancelHold();
        return;
      }
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-reorder-id]");
      const target = over?.getAttribute("data-reorder-id");
      if (!target || target === d.id) return;
      const next = moveId(d.order, d.id, target);
      if (next !== d.order) {
        d.order = next;
        setOrder(next);
      }
    };
    const onUp = () => {
      cancelHold();
      const d = dragging.current;
      if (!d) return;
      dragging.current = null;
      swallowClick.current = true;
      setTimeout(() => {
        swallowClick.current = false;
      }, 400);
      setDragId(null);
      setOrder(null);
      if (d.order.join() !== d.start.join()) latest.current.onDrop(d.order);
    };
    // Non-passive, or the browser scrolls instead of letting the card move.
    const noScroll = (e) => {
      if (dragging.current && e.cancelable) e.preventDefault();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", noScroll, { passive: false });
    return () => {
      cancelHold();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", noScroll);
    };
  }, []);

  const bind = (id) => ({
    "data-reorder-id": id,
    onPointerDown: (e) => {
      if (e.button !== 0 || e.target.closest("button, a, input, select, textarea")) return;
      clearTimeout(hold.current?.timer);
      const timer = setTimeout(() => {
        hold.current = null;
        const start = latest.current.ids;
        dragging.current = { id, start, order: start };
        setDragId(id);
        setOrder(start);
        navigator.vibrate?.(30);
      }, HOLD_MS);
      hold.current = { x: e.clientX, y: e.clientY, timer };
    },
    // A long press on a phone would otherwise open the copy / share menu.
    onContextMenu: (e) => e.preventDefault(),
    onClickCapture: (e) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    },
  });

  return { bind, dragId, order };
};
