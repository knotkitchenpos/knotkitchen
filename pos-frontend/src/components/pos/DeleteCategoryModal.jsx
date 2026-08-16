import React from "react";
import { ModalShell } from "./ModalShell";

const DeleteCategoryModal = ({ category, submitting, onClose, onConfirm }) => (
  <ModalShell
    title="Delete Category"
    subtitle="This permanently removes the category and all dishes inside it."
    onClose={onClose}
  >
    <div className="space-y-4">
      <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3">
        <p className="text-[13.5px] leading-relaxed text-[#991B1B]">
          Are you sure you want to delete <strong>{category.name}</strong>? This action cannot be undone.
        </p>
        <p className="mt-1 text-[12px] text-[#B91C1C]">
          {category.items?.length || 0} dish{category.items?.length === 1 ? "" : "es"} will be removed.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="h-[48px] rounded-xl border border-[#E2E8F0] text-[#334155] text-[14px] font-bold hover:bg-[#F8FAFC] disabled:opacity-50"
        >
          Keep Category
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className="h-[48px] rounded-xl bg-[#DC2626] text-white text-[14px] font-bold hover:bg-[#B91C1C] disabled:opacity-50"
        >
          {submitting ? "Deleting…" : "Delete Category"}
        </button>
      </div>
    </div>
  </ModalShell>
);

export default DeleteCategoryModal;