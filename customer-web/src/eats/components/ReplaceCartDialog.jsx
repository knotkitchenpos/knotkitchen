import React, { useEffect, useRef } from "react";

/**
 * "Your cart has dishes from A. Start a new cart with B?" One basket at a
 * time (lib/eatsCart.guardCart). Native <dialog>: focus trap, Esc and the
 * backdrop come from the browser. Esc counts as Cancel, and focus starts on
 * Cancel because the other button empties a basket.
 */
export default function ReplaceCartDialog({ fromName, toName, onAnswer }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    if (d.showModal) d.showModal();
    else d.setAttribute("open", "");
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="ke-replace-title"
      onCancel={(e) => {
        e.preventDefault();
        onAnswer(false);
      }}
      className="w-[min(92vw,380px)] rounded-2xl p-5 text-slate-800 shadow-2xl backdrop:bg-black/40"
    >
      <h2 id="ke-replace-title" className="text-[18px] font-semibold text-slate-900">
        Start a new cart?
      </h2>
      <p className="mt-2 text-[15px]">
        Your cart has dishes from {fromName || "another restaurant"}. Start a new cart with {toName || "this restaurant"}?
      </p>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={() => onAnswer(false)}
          className="min-h-[44px] flex-1 rounded-xl border border-slate-300 font-semibold focus-visible:ring-2 focus-visible:ring-brand"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onAnswer(true)}
          className="min-h-[44px] flex-1 rounded-xl bg-brand font-semibold text-brand-fg focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          Start new cart
        </button>
      </div>
    </dialog>
  );
}
