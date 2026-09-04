import React, { useState } from "react";
import { ModalShell, Field, inputCls } from "./ModalShell";

const AddCategoryModal = ({ submitting, onClose, onSubmit }) => {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return setErr("Category name is required");
    onSubmit(name.trim());
  };

  return (
    <ModalShell title="Add Category" subtitle="Categories group your products on the POS screen." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Category Name" error={err}>
          <input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErr("");
            }}
            placeholder="e.g. Burgers, Starters, Drinks"
            maxLength={80}
            className={inputCls(err)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-[48px] rounded-xl border border-[#E2E8F0] text-[#334155] text-[14px] font-bold hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="h-[48px] rounded-xl bg-[#FD5302] text-white text-[14px] font-bold hover:bg-[#D64502] disabled:opacity-50"
          >
            {submitting ? "Adding…" : "Add Category"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

export default AddCategoryModal;
