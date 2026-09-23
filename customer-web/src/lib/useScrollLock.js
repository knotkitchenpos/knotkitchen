import { useEffect } from "react";

// While an overlay (cart, product, booking, confirmation) is open, the page
// behind it must not scroll: a drag on the dimmed area used to move the menu
// underneath the cart. Counted, so closing one of two stacked overlays does
// not unlock the page under the other.
let locks = 0;

export default function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    if (locks++ === 0) document.body.style.overflow = "hidden";
    return () => {
      if (--locks === 0) document.body.style.overflow = "";
    };
  }, [active]);
}
