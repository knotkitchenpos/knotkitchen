import React from "react";
import { IconX } from "./icons";

/** The category / subcategory slide-over. Form state lives on the page (it is read by handleSaveCategory); this is the markup. */
const CategoryDrawer = ({
  addCategoryMut,
  addSubcatMut,
  catDesc,
  catName,
  catPublished,
  catShowOnPos,
  catShowOnWebsite,
  dispatchAll,
  dispatchCol,
  dispatchDel,
  dispatchTbl,
  editingCategory,
  editingSubcategory,
  handleSaveCategory,
  resetCategoryForm,
  setCatDesc,
  setCatName,
  setCatPublished,
  setCatShowOnPos,
  setCatShowOnWebsite,
  setDispatchAll,
  setDispatchCol,
  setDispatchDel,
  setDispatchTbl,
  setShowCreateCategory,
  setShowCreateSubcategory,
  showCreateCategory,
  showCreateSubcategory,
  updateCategoryMut,
  updateSubcatMut,
}) => (
  <>
  {/* Drawers: Create / Manage Category / Subcategory Slide-Over Drawer */}
  {(showCreateCategory || showCreateSubcategory) && (
    <div className="fixed inset-0 z-[100] bg-black/50 flex justify-end">
      <div className="w-full max-w-[420px] bg-white h-full shadow-2xl flex flex-col p-6 overflow-y-auto text-[#0F172A]">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-4 mb-4">
          <h3 className="text-[18px] font-extrabold">
            {editingCategory
              ? "Manage Category"
              : editingSubcategory
              ? "Manage Subcategory"
              : showCreateSubcategory
              ? "Create Subcategory"
              : "Create Category"}
          </h3>
          <button
            onClick={() => {
              setShowCreateCategory(false);
              setShowCreateSubcategory(false);
              resetCategoryForm();
            }}
            className="text-[#94A3B8] hover:text-[#0F172A]"
          >
            <IconX />
          </button>
        </div>
  
        <div className="space-y-4 flex-1 text-[13px]">
          <div>
            <label className="text-[12px] font-extrabold text-[#334155]">
              {showCreateSubcategory ? "Subcategory Name" : "Category Name"}
            </label>
            <input
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder={showCreateSubcategory ? "e.g. Chicken Burgers" : "e.g. Burgers"}
              className="w-full h-[40px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[13.5px]"
            />
          </div>
  
          <div>
            <label className="text-[12px] font-extrabold text-[#334155]">Description</label>
            <textarea
              maxLength={200}
              rows={3}
              value={catDesc}
              onChange={(e) => setCatDesc(e.target.value)}
              placeholder="Description..."
              className="w-full p-3 mt-1 rounded-xl border border-[#E2E8F0] font-medium text-[13px] resize-none"
            />
          </div>
  
          {/* Display ON/OFF Toggle (Module 3) */}
          <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
            <div>
              <span className="font-extrabold text-[13px] text-[#0F172A] block">Display Status</span>
              <span className="text-[11px] text-[#64748B]">
                {catPublished ? "Display ON — Visible on POS & Website" : "Display OFF — Hidden from POS & Website"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCatPublished((prev) => !prev)}
              className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                catPublished ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  catPublished ? "right-1" : "left-1"
                }`}
              />
            </button>
          </div>
  
          {/* With Display Status OFF the category is hidden everywhere by
              default; these let it back onto one surface only. */}
          {!catPublished && (
            <div className="space-y-2 pl-1">
              {[
                { label: "POS Visibility", hint: "Show on the POS tills only", on: catShowOnPos, set: setCatShowOnPos },
                { label: "Website Visibility", hint: "Show on the customer website only", on: catShowOnWebsite, set: setCatShowOnWebsite },
              ].map(({ label, hint, on, set }) => (
                <div key={label} className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-[12.5px] text-[#334155] block">{label}</span>
                    <span className="text-[11px] text-[#94A3B8]">{hint}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => set((prev) => !prev)}
                    className={`w-10 h-[22px] rounded-full transition-colors relative shrink-0 ${
                      on ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
                    }`}
                  >
                    <span
                      className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-transform ${
                        on ? "right-[3px]" : "left-[3px]"
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          )}
  
          {/* Dispatch Type (Collection, Delivery, Table) */}
          <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-[13px] text-[#0F172A]">Dispatch Type</span>
              <label className="flex items-center gap-2 font-bold text-[12px] text-[#64748B]">
                <span>All</span>
                <input
                  type="checkbox"
                  checked={dispatchAll}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setDispatchAll(val);
                    setDispatchCol(val);
                    setDispatchDel(val);
                    setDispatchTbl(val);
                  }}
                  className="w-5 h-5 accent-[#22C55E]"
                />
              </label>
            </div>
  
            {!dispatchAll && (
              <div className="grid grid-cols-3 gap-2 pt-1 text-[12px]">
                <label className="flex items-center gap-1.5 p-2 rounded-lg bg-[#F8FAFC] border font-bold">
                  <input
                    type="checkbox"
                    checked={dispatchCol}
                    onChange={(e) => setDispatchCol(e.target.checked)}
                    className="accent-[#FD5302]"
                  />
                  <span>Collection</span>
                </label>
  
                <label className="flex items-center gap-1.5 p-2 rounded-lg bg-[#F8FAFC] border font-bold">
                  <input
                    type="checkbox"
                    checked={dispatchDel}
                    onChange={(e) => setDispatchDel(e.target.checked)}
                    className="accent-[#FD5302]"
                  />
                  <span>Delivery</span>
                </label>
  
                <label className="flex items-center gap-1.5 p-2 rounded-lg bg-[#F8FAFC] border font-bold">
                  <input
                    type="checkbox"
                    checked={dispatchTbl}
                    onChange={(e) => setDispatchTbl(e.target.checked)}
                    className="accent-[#FD5302]"
                  />
                  <span>Table</span>
                </label>
              </div>
            )}
          </div>
  
          {/* Background Color and Text Color are both gone from the
              category form. Each is still LOADED from the category and
              sent back unchanged on save, so existing colours survive an
              edit instead of being reset to the defaults. */}
        </div>
  
        <div className="pt-4 border-t border-[#E2E8F0]">
          <button
            onClick={handleSaveCategory}
            disabled={
              addCategoryMut.isPending ||
              updateCategoryMut.isPending ||
              addSubcatMut.isPending ||
              updateSubcatMut.isPending
            }
            className="w-full h-[46px] rounded-xl bg-[#0F172A] text-white text-[14px] font-extrabold shadow-lg hover:bg-[#1E293B] disabled:opacity-50"
          >
            {addCategoryMut.isPending ||
            updateCategoryMut.isPending ||
            addSubcatMut.isPending ||
            updateSubcatMut.isPending
              ? "Saving…"
              : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  )}
  </>
);

export default CategoryDrawer;
