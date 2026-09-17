import React from "react";
import { enqueueSnackbar } from "notistack";
import { importMenuCsv } from "../../../https";

/** "Replace the whole menu with this CSV?" -- `data` is the preview the server returned. */
const CsvPreviewModal = ({ data, pendingText, invalidate, onClose }) => (
  <>
  {/* Modal: CSV Import Preview (Module 5 §6) */}
  {data && (
    <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-[500px] bg-white rounded-2xl p-6 shadow-2xl space-y-4 text-[#0F172A]">
        <h3 className="text-[18px] font-extrabold">CSV Import Preview</h3>
  
        <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-[#B91C1C] text-[12.5px] font-bold">
          ⚠️ Warning: {data.warning || "This import will replace the existing menu completely."}
        </div>
  
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          <div className="p-3 rounded-xl bg-[#F8FAFC] border">
            <span className="text-[#64748B] text-[11px] font-bold">Categories</span>
            <p className="text-lg font-extrabold">{data.categoriesCount}</p>
          </div>
          <div className="p-3 rounded-xl bg-[#F8FAFC] border">
            <span className="text-[#64748B] text-[11px] font-bold">Subcategories</span>
            <p className="text-lg font-extrabold">{data.subcategoriesCount}</p>
          </div>
          <div className="p-3 rounded-xl bg-[#F8FAFC] border">
            <span className="text-[#64748B] text-[11px] font-bold">Products</span>
            <p className="text-lg font-extrabold">{data.productsCount}</p>
          </div>
          <div className="p-3 rounded-xl bg-[#F8FAFC] border">
            <span className="text-[#64748B] text-[11px] font-bold">Groups & Extras</span>
            <p className="text-lg font-extrabold">{data.groupsCount} Groups ({data.extrasCount} Extras)</p>
          </div>
        </div>
  
        <div className="text-[12px] text-[#64748B] font-semibold">
          Total Records: {data.totalRows}. The import lands in Manage Menu as a draft. Click{" "}
          <span className="font-extrabold text-[#0F172A]">Publish</span> when you want the tills and the
          website to pick it up.
        </div>
  
        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 h-[42px] rounded-xl border border-[#CBD5E1] text-[#475569] font-extrabold hover:bg-[#F8FAFC]"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              try {
                const res = await importMenuCsv(pendingText);
                enqueueSnackbar(res.data.message || "Menu completely replaced!", { variant: "success" });
                invalidate();
                onClose();
              } catch (err) {
                enqueueSnackbar(err.response?.data?.message || "Failed to replace menu", { variant: "error" });
              }
            }}
            className="flex-1 h-[42px] rounded-xl bg-[#DC2626] text-white font-extrabold shadow-md hover:bg-[#B91C1C]"
          >
            Replace Menu Completely
          </button>
        </div>
      </div>
    </div>
  )}
  </>
);

export default CsvPreviewModal;
