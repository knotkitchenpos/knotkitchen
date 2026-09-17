import React from "react";
import { IconX } from "./icons";
import { enqueueSnackbar } from "notistack";

/** The modifier-group slide-over: name, rule, components, assigned products. Form state lives on the page. */
const GroupDrawer = ({
  askConfirm,
  assignedDishIds,
  deleteGroupMut,
  editingCompIndex,
  editingGroup,
  extraNameInput,
  extraPriceInput,
  extrasList,
  groupMax,
  groupMaxEnabled,
  groupName,
  groupRequired,
  handleDeleteGroup,
  menus,
  saveGroupMut,
  selectionType,
  setAssignedDishIds,
  setCustomCreatedGroups,
  setEditingCompIndex,
  setEditingGroup,
  setExtraNameInput,
  setExtraPriceInput,
  setExtrasList,
  setGroupMax,
  setGroupMaxEnabled,
  setGroupName,
  setGroupRequired,
  setSelectionType,
  setShowManageGroup,
  showManageGroup,
}) => (
  <>
  {/* Drawer: Manage / Create Group Drawer */}
  {showManageGroup && (
    <div className="fixed inset-0 z-[100] bg-black/50 flex justify-end">
      <div className="w-full max-w-[440px] bg-white h-full shadow-2xl flex flex-col p-6 overflow-y-auto text-[#0F172A]">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-4 mb-4">
          <h3 className="text-[18px] font-extrabold">
            {editingGroup ? `Manage Group: ${editingGroup.name}` : "Create Group"}
          </h3>
          <button
            onClick={() => {
              setShowManageGroup(false);
              setEditingGroup(null);
              setEditingCompIndex(null);
            }}
            className="text-[#94A3B8] hover:text-[#0F172A]"
          >
            <IconX />
          </button>
        </div>
  
        <div className="space-y-5 flex-1 text-[13px]">
          <div>
            <label className="text-[12px] font-extrabold text-[#334155]">Group Name</label>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Extra Toppings"
              className="w-full h-[40px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[13.5px]"
            />
          </div>
  
          <div className="flex items-center justify-between border-t border-[#E2E8F0] py-3">
            <span className="font-extrabold text-[#0F172A]">Required Selection</span>
            <input
              type="checkbox"
              checked={groupRequired}
              onChange={(e) => setGroupRequired(e.target.checked)}
              className="w-5 h-5 accent-[#22C55E]"
            />
          </div>
  
          {/* Selection Type: Single vs Multiple */}
          <div className="space-y-2 border-b border-[#E2E8F0] pb-3">
            <div>
              <span className="font-extrabold text-[#0F172A] block">Selection Type</span>
              <span className="text-[11.5px] font-semibold text-[#64748B]">
                Single = customer can pick 1 item. Multiple = customer can pick multiple items.
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setSelectionType("single");
                  setGroupMax("1");
                }}
                className={`h-[40px] px-3 rounded-xl border text-[13px] font-extrabold flex items-center justify-center gap-2 transition-all ${
                  selectionType === "single"
                    ? "bg-[#FD5302] text-white border-[#FD5302] shadow-xs"
                    : "bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${selectionType === "single" ? "bg-white" : "bg-[#94A3B8]"}`} />
                Single (Choose 1)
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectionType("multiple");
                  if (Number(groupMax) <= 1) setGroupMax("5");
                }}
                className={`h-[40px] px-3 rounded-xl border text-[13px] font-extrabold flex items-center justify-center gap-2 transition-all ${
                  selectionType === "multiple"
                    ? "bg-[#FD5302] text-white border-[#FD5302] shadow-xs"
                    : "bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${selectionType === "multiple" ? "bg-white" : "bg-[#94A3B8]"}`} />
                Multiple (Choose Many)
              </button>
            </div>
  
            {selectionType === "multiple" && (
              <div className="pt-2.5 mt-1 border-t border-dashed border-[#E2E8F0] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[12px] font-extrabold text-[#334155] block">Maximum Selection</span>
                    <span className="text-[11px] font-semibold text-[#64748B]">
                      {groupMaxEnabled ? "Cap how many the customer may pick" : "Off — customer may pick any number"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !groupMaxEnabled;
                      setGroupMaxEnabled(next);
                      if (next && Number(groupMax) < 2) setGroupMax("2");
                    }}
                    className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                      groupMaxEnabled ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
                    }`}
                  >
                    <span
                      className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                        groupMaxEnabled ? "right-1" : "left-1"
                      }`}
                    />
                  </button>
                </div>
  
                {groupMaxEnabled && (
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold text-[#64748B]">Max selections allowed</span>
                    <input
                      type="number"
                      min={2}
                      step={1}
                      value={groupMax}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") { setGroupMax(""); return; }
                        const n = Math.max(2, Math.floor(Number(v) || 2));
                        setGroupMax(String(n));
                      }}
                      onBlur={() => {
                        if (!groupMax || Number(groupMax) < 2) setGroupMax("2");
                      }}
                      className="w-[80px] h-[36px] px-2 text-center rounded-xl border border-[#E2E8F0] font-extrabold text-[13.5px]"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
  
          {/* Add Components Section (Module 6: Groups -> Components) */}
          <div className="p-4 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-3">
            <h4 className="font-extrabold text-[13.5px] text-[#0F172A]">Components</h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-[#64748B] block mb-1">Component Name *</label>
                <input
                  value={extraNameInput}
                  onChange={(e) => setExtraNameInput(e.target.value)}
                  placeholder="e.g. Meat"
                  className="w-full h-[36px] px-3 rounded-xl border border-[#E2E8F0] font-bold text-[12.5px]"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-[#64748B] block mb-1">Price ₹ *</label>
                <input
                  type="number"
                  min={0}
                  value={extraPriceInput}
                  onChange={(e) => setExtraPriceInput(e.target.value)}
                  placeholder="e.g. 100"
                  className="w-full h-[36px] px-3 rounded-xl border border-[#E2E8F0] font-bold text-[12.5px]"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!extraNameInput || !extraNameInput.trim()) {
                  enqueueSnackbar("Component Name is required.", { variant: "warning" });
                  return;
                }
                const numPrice = Number(extraPriceInput);
                if (!Number.isFinite(numPrice) || numPrice < 0) {
                  enqueueSnackbar("Component Price must be a valid non-negative number.", { variant: "warning" });
                  return;
                }
                if (editingCompIndex !== null) {
                  const copy = [...extrasList];
                  copy[editingCompIndex] = { name: extraNameInput.trim(), price: String(numPrice) };
                  setExtrasList(copy);
                  setEditingCompIndex(null);
                  enqueueSnackbar("Component updated!", { variant: "success" });
                } else {
                  setExtrasList([...extrasList, { name: extraNameInput.trim(), price: String(numPrice) }]);
                }
                setExtraNameInput("");
                // Carry the price forward: the next component defaults to
                // whatever was just entered, so a run of same-priced
                // components is typed once.
                setExtraPriceInput(String(numPrice));
              }}
              className="w-full h-[36px] rounded-xl bg-[#FD5302] text-white text-[12.5px] font-bold hover:bg-[#D64502]"
            >
              {editingCompIndex !== null ? "Update Component" : "+ Add Component"}
            </button>
  
            {extrasList.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-[#E2E8F0]">
                {extrasList.map((extra, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-white border border-[#E2E8F0] text-[12.5px]">
                    <span className="font-bold text-[#0F172A]">{extra.name} — ₹{extra.price}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setExtraNameInput(extra.name);
                          setExtraPriceInput(String(extra.price));
                          setEditingCompIndex(idx);
                        }}
                        className="text-[#C2410C] font-bold hover:underline text-[11.5px]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          askConfirm({
                            title: "Delete component?",
                            message: `Delete component "${extra.name}" from this group?`,
                            confirmLabel: "Delete Component",
                            tone: "danger",
                            onConfirm: () => {
                              setExtrasList(extrasList.filter((_, i) => i !== idx));
                              if (editingCompIndex === idx) {
                                setEditingCompIndex(null);
                                setExtraNameInput("");
                              }
                            },
                          });
                        }}
                        className="text-[#DC2626] font-bold hover:underline text-[11.5px]"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
  
          {/* Product Association */}
          <div className="pt-2 border-t border-[#E2E8F0] space-y-2">
            <h4 className="font-extrabold text-[13px] text-[#0F172A]">Assign to Products</h4>
            <div className="max-h-[160px] overflow-y-auto space-y-1.5 p-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
              {(Array.isArray(menus) ? menus : [])
                .flatMap((m) => (Array.isArray(m?.items) ? m.items : []))
                .map((item) => {
                  if (!item || !item._id) return null;
                  const assigned = assignedDishIds.has(String(item._id));
                  return (
                    <label key={item._id} className="flex items-center gap-2 p-1.5 hover:bg-white rounded-lg cursor-pointer text-[12.5px] font-bold text-[#334155]">
                      <input
                        type="checkbox"
                        checked={assigned}
                        onChange={() => {
                          const next = new Set(assignedDishIds);
                          if (next.has(String(item._id))) next.delete(String(item._id));
                          else next.add(String(item._id));
                          setAssignedDishIds(next);
                        }}
                        className="w-4 h-4 accent-[#FD5302]"
                      />
                      <span>{item.name}</span>
                    </label>
                  );
                })}
            </div>
          </div>
        </div>
  
        <div className="pt-4 border-t border-[#E2E8F0] space-y-2">
          <button
            onClick={() => {
              if (!groupName || !groupName.trim()) {
                enqueueSnackbar("Group Name is required.", { variant: "warning" });
                return;
              }
              for (const comp of extrasList) {
                if (!comp.name || !comp.name.trim()) {
                  enqueueSnackbar("All components must have a valid name.", { variant: "warning" });
                  return;
                }
                const p = Number(comp.price);
                if (!Number.isFinite(p) || p < 0) {
                  enqueueSnackbar(`Price for component "${comp.name}" must be numeric and cannot be negative.`, { variant: "warning" });
                  return;
                }
              }
              // §Groups: a group may now be created / edited WITHOUT
              // being attached to any product. Standalone groups live
              // in the local `customCreatedGroups` registry so they
              // still appear in the Groups list and in the "Bulk Add
              // Group" picker — the operator can attach them later
              // from Products → Select → Manage → Add Group.
              const trimmedName = groupName.trim();
              // "Single" is a cap of one by definition. "Multiple" only
              // carries a cap when Maximum Selection is switched on;
              // otherwise the customer may pick any number.
              const capOn = selectionType === "single" || groupMaxEnabled;
              const normalizedMax =
                selectionType === "single" ? 1 : Math.max(1, Number(groupMax) || 1);
              const normalizedOptions = extrasList.map((e) => ({
                name: e.name.trim(),
                price: Number(e.price) || 0,
              }));
  
              if (!assignedDishIds || assignedDishIds.size === 0) {
                // Register (or update) the group locally — no server
                // call needed since it isn't attached to any product
                // yet. If the operator was renaming an existing
                // standalone group we also drop the old key so the
                // list doesn't show duplicates.
                setCustomCreatedGroups((prev) => {
                  const next = { ...prev };
                  if (editingGroup && editingGroup.name && editingGroup.name !== trimmedName) {
                    delete next[editingGroup.name];
                  }
                  next[trimmedName] = {
                    name: trimmedName,
                    required: Boolean(groupRequired),
                    maxSelectionEnabled: capOn,
                    maxSelections: normalizedMax,
                    options: normalizedOptions,
                  };
                  return next;
                });
                enqueueSnackbar(
                  editingGroup
                    ? `Group "${trimmedName}" updated. Attach it to products from the Products tab when you're ready.`
                    : `Group "${trimmedName}" created. Attach it to products from the Products tab when you're ready.`,
                  { variant: "success" },
                );
                setShowManageGroup(false);
                setEditingGroup(null);
                return;
              }
  
              saveGroupMut.mutate({
                groupName: trimmedName,
                oldGroupName: editingGroup ? editingGroup.name : undefined,
                required: groupRequired,
                maxSelectionEnabled: capOn,
                maxSelections: normalizedMax,
                options: normalizedOptions,
                dishIds: Array.from(assignedDishIds),
              });
            }}
            disabled={saveGroupMut.isPending}
            className="w-full h-[46px] rounded-xl bg-[#0F172A] text-white text-[14px] font-extrabold shadow-lg hover:bg-[#1E293B] disabled:opacity-50"
          >
            {saveGroupMut.isPending ? "Saving Group…" : "Save Changes"}
          </button>
  
          {editingGroup && (
            <button
              type="button"
              onClick={() => handleDeleteGroup(editingGroup)}
              disabled={deleteGroupMut.isPending}
              className="w-full h-[40px] rounded-xl border border-[#FECACA] text-[#DC2626] text-[13px] font-extrabold hover:bg-[#FEF2F2] disabled:opacity-50"
            >
              {deleteGroupMut.isPending ? "Deleting…" : "Delete Group"}
            </button>
          )}
        </div>
      </div>
    </div>
  )}
  </>
);

export default GroupDrawer;
