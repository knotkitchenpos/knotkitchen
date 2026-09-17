import React from "react";

/**
 * Tick which groups to attach to (or detach from) the selected products.
 * `mode` is "add" | "remove" | null; `picked` is a Set of group names the
 * page owns so the apply handler can read it.
 */
const BulkGroupPickerModal = ({ mode, picked, setPicked, groups, selectedCount, pending, onClose, onApply }) => (
  <>
  {/* Modal: Bulk Group Picker — appears after choosing "+ Add Group
      to Selected" or "− Remove Group from Selected" from the
      selection Manage menu. Lists every existing group so the
      operator can simply tick which ones to apply to the current
      product selection instead of typing group names. */}
  {mode && (
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-[460px] max-h-[80vh] bg-white rounded-2xl shadow-2xl flex flex-col text-[#0F172A]">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          <div>
            <h3 className="text-[16px] font-extrabold">
              {mode === "remove"
                ? "Remove Groups from Selected Products"
                : "Add Groups to Selected Products"}
            </h3>
            <p className="text-[11.5px] text-[#94A3B8] mt-0.5">
              {mode === "remove"
                ? `Pick which groups to detach from ${selectedCount} selected product${selectedCount === 1 ? "" : "s"}.`
                : `Pick which groups to attach to ${selectedCount} selected product${selectedCount === 1 ? "" : "s"}.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#0F172A] text-2xl leading-none"
            aria-label="Close bulk group picker"
          >
            ×
          </button>
        </div>
  
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {groups.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-[#94A3B8] space-y-2">
              <p className="font-bold text-[#475569]">No groups exist yet.</p>
              <p>Create a group first from the Groups tab, then come back to bulk-assign it.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-[12px] font-bold text-[#64748B] pb-2 border-b border-[#E2E8F0] mb-2">
                <span>{picked.size} of {groups.length} selected</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setPicked(new Set(groups.map((g) => g.name)))
                    }
                    className="text-[#C2410C] hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setPicked(new Set())}
                    className="text-[#94A3B8] hover:text-[#DC2626]"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                {groups.map((g) => {
                  const checked = picked.has(g.name);
                  return (
                    <label
                      key={g.name}
                      className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer text-[13px] font-bold transition-colors ${
                        checked
                          ? "border-[#FD5302] bg-[#FFF1E8]/40"
                          : "border-[#E2E8F0] hover:bg-[#F8FAFC]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = new Set(picked);
                            if (next.has(g.name)) next.delete(g.name);
                            else next.add(g.name);
                            setPicked(next);
                          }}
                          className="w-4 h-4 accent-[#FD5302] shrink-0"
                        />
                        <span className="truncate text-[#0F172A]">{g.name}</span>
                      </div>
                      <span className="text-[10.5px] font-semibold text-[#64748B] shrink-0 ml-2">
                        {(g.options || []).length} component{(g.options || []).length === 1 ? "" : "s"}
                        {g.dishIds?.size ? ` · on ${g.dishIds.size} product${g.dishIds.size === 1 ? "" : "s"}` : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
  
        <div className="border-t border-[#E2E8F0] px-5 py-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-[40px] px-4 rounded-xl border border-[#E2E8F0] text-[#475569] text-[13px] font-bold hover:bg-[#F8FAFC]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={picked.size === 0 || pending}
            className={`h-[40px] px-5 rounded-xl text-white text-[13px] font-extrabold shadow-md disabled:opacity-50 ${
              mode === "remove"
                ? "bg-[#DC2626] hover:bg-[#B91C1C]"
                : "bg-[#FD5302] hover:bg-[#D64502]"
            }`}
          >
            {pending
              ? "Applying…"
              : mode === "remove"
              ? `Remove ${picked.size || ""} Group${picked.size === 1 ? "" : "s"}`
              : `Add ${picked.size || ""} Group${picked.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  )}
  </>
);

export default BulkGroupPickerModal;
