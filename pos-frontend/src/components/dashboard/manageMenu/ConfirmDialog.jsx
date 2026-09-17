import React from "react";

/**
 * The confirmation for every destructive Manage Menu action (delete product,
 * category, group, component, bulk delete). `state` is what `askConfirm()` on
 * the page stored: { title, message, confirmLabel, tone, onConfirm }.
 */
const ConfirmDialog = ({ state, onClose }) => (
  <>
  {/*
    Shared confirmation modal.
  
    Every destructive action in Manage Menu (Delete Product,
    Delete Category, Delete Group, Delete Component, Bulk Delete)
    now routes through `askConfirm()` which populates `state`.
    The old `window.confirm()` calls have been replaced so the biller
    never loses an item to an accidental mis-click, and so the
    confirmation UX matches the rest of the app (no native browser
    dialog).
  */}
  {state && (
    <div
      className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-[440px] bg-white rounded-2xl shadow-2xl p-6 space-y-4 text-[#0F172A]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span
            className={`w-10 h-10 rounded-full flex items-center justify-center text-[18px] font-extrabold shrink-0 ${
              state.tone === "danger"
                ? "bg-[#FEE2E2] text-[#DC2626]"
                : "bg-[#FFF1E8] text-[#C2410C]"
            }`}
            aria-hidden="true"
          >
            {state.tone === "danger" ? "!" : "?"}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[16.5px] font-extrabold text-[#0F172A] leading-snug">
              {state.title}
            </h3>
            {state.message && (
              <p className="mt-1 text-[13px] leading-relaxed text-[#475569]">
                {state.message}
              </p>
            )}
          </div>
        </div>
  
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-[40px] px-4 rounded-xl border border-[#E2E8F0] text-[#475569] text-[13px] font-bold hover:bg-[#F8FAFC]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const fn = state.onConfirm;
              // Close the modal FIRST so the confirm callback can open
              // another modal (e.g. success toast + re-render) without
              // fighting our onClose() call.
              onClose();
              if (typeof fn === "function") fn();
            }}
            className={`h-[40px] px-5 rounded-xl text-white text-[13px] font-extrabold shadow-md ${
              state.tone === "danger"
                ? "bg-[#DC2626] hover:bg-[#B91C1C]"
                : "bg-[#FD5302] hover:bg-[#D64502]"
            }`}
            autoFocus
          >
            {state.confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  )}
  </>
);

export default ConfirmDialog;
