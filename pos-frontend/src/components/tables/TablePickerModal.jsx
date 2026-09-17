import React from "react";
import { tableLabel } from "../../utils/orderLabels";

/**
 * Pick a table: the free ones (to move a party) or the occupied ones (to
 * merge another party's tab into this one).
 */
const label = (t) => tableLabel(t, "Table ?");

const TablePickerModal = ({ title, hint, tables, busy, onPick, onClose }) => (
  <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
    <div
      className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={title}
    >
      <h3 className="text-[16px] font-extrabold text-[#0F172A]">{title}</h3>
      {hint && <p className="mt-0.5 text-[12.5px] text-[#64748B]">{hint}</p>}
      {tables.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-[#94A3B8]">No table to choose.</p>
      ) : (
        <div className="mt-3 grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
          {tables.map((t) => (
            <button
              key={t._id}
              type="button"
              disabled={busy}
              onClick={() => onPick(t)}
              className="rounded-xl border border-[#E2E8F0] p-3 text-left hover:border-[#FD5302] hover:bg-[#FFF1E8] disabled:opacity-50"
            >
              <span className="block text-[14px] font-extrabold text-[#0F172A]">{label(t)}</span>
              <span className="block text-[11.5px] text-[#64748B]">
                {t.session
                  ? `${t.session.customerCount || 1} guests · ₹${Number(t.session.bills?.totalWithTax || 0).toFixed(0)}`
                  : `Seats ${t.capacity || 4}${t.zone ? ` · ${t.zone}` : ""}`}
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onClose}
        className="mt-4 h-[44px] w-full rounded-xl border border-[#E2E8F0] text-[13px] font-bold text-[#334155] hover:bg-[#F8FAFC]"
      >
        Back
      </button>
    </div>
  </div>
);

export default TablePickerModal;
