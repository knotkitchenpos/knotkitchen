import React, { useMemo, useState } from "react";
import { ModalShell } from "./ModalShell";

const isOccupied = (t) => {
  const s = String(t.status || "").toLowerCase();
  if (["occupied", "booked", "reserved", "processing", "cleaning"].includes(s)) return true;
  if (t.session) return true;
  const cap = Number(t.capacity) || 0;
  const occ = Number(t.currentOccupancy) || 0;
  return cap > 0 && occ >= cap;
};

/** Finish Order → Table: pick an available table for this store. */
const TableModal = ({ tables = [], busy, onClose, onConfirm }) => {
  const [picked, setPicked] = useState(null);
  const [guests, setGuests] = useState(1);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [area, setArea] = useState("all");

  const areaOf = (t) => t.area || t.floor || t.zone || "";

  // Floors and areas actually in use, so the biller can jump to a section
  // instead of hunting through every table in the building.
  const areas = useMemo(() => {
    const seen = new Map();
    tables.forEach((t) => {
      const name = areaOf(t);
      if (!name) return;
      seen.set(name, (seen.get(name) || 0) + 1);
    });
    return Array.from(seen.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [tables]);

  const list = useMemo(() => {
    const s = q.trim();
    let arr = [...tables].sort((a, b) => (a.tableNumber || 0) - (b.tableNumber || 0));
    if (area !== "all") arr = arr.filter((t) => areaOf(t) === area);
    return s ? arr.filter((t) => String(t.tableNumber).includes(s)) : arr;
  }, [tables, q, area]);

  const available = list.filter((t) => !isOccupied(t)).length;

  const confirm = () => {
    if (!picked) return setErr("Select an available table to continue.");
    const cap = Number(picked.capacity) || 4;
    const g = Math.max(1, Number(guests) || 1);
    if (g > cap) return setErr(`Table ${picked.tableNumber} seats a maximum of ${cap} customers.`);
    setErr("");
    onConfirm({
      table: {
        tableId: picked._id,
        tableNo: picked.tableNumber,
        capacity: picked.capacity,
        occupancy: picked.currentOccupancy || 0,
      },
      guests: g,
    });
  };

  return (
    <ModalShell
      title="Select Table"
      subtitle={`${available} of ${tables.length} tables available in this store.`}
      onClose={onClose}
      width={560}
    >
      <div className="space-y-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search table number…"
          className="w-full h-[44px] px-3.5 rounded-xl border border-[#E2E8F0] text-[14px] focus:border-[#5B42F3]"
        />

        {areas.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            <AreaChip active={area === "all"} onClick={() => setArea("all")}>
              All Tables ({tables.length})
            </AreaChip>
            {areas.map(([name, count]) => (
              <AreaChip key={name} active={area === name} onClick={() => setArea(name)}>
                {name} ({count})
              </AreaChip>
            ))}
          </div>
        )}

        {tables.length === 0 ? (
          <p className="text-center text-[13.5px] text-[#94A3B8] py-10">
            No tables configured for this store yet.
          </p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 max-h-[280px] overflow-y-auto pr-1">
            {list.length === 0 && (
              <p className="col-span-full text-center text-[13px] text-[#94A3B8] py-6">
                No tables in {area === "all" ? "this store" : `"${area}"`}.
              </p>
            )}
            {list.map((t) => {
              const off = isOccupied(t);
              const on = picked?._id === t._id;
              return (
                <button
                  key={t._id}
                  disabled={off}
                  onClick={() => {
                    setPicked(t);
                    setErr("");
                  }}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    off
                      ? "bg-[#FEF2F2] border-[#FECACA] cursor-not-allowed opacity-70"
                      : on
                      ? "bg-[#5B42F3] border-[#5B42F3] text-white shadow-md"
                      : "bg-white border-[#E2E8F0] hover:border-[#5B42F3]"
                  }`}
                  title={off ? "Table is occupied" : `Seats ${t.capacity}`}
                >
                  <p className={`text-[15px] font-extrabold ${on ? "text-white" : "text-[#0F172A]"}`}>
                    Table {t.tableNumber}
                  </p>
                  <p className={`text-[11px] mt-0.5 truncate ${on ? "text-white/80" : "text-[#94A3B8]"}`}>
                    Seats {t.capacity}
                    {area === "all" && areaOf(t) ? ` · ${areaOf(t)}` : ""}
                  </p>
                  <span
                    className={`inline-block mt-1.5 px-1.5 py-[2px] rounded text-[10px] font-bold ${
                      off
                        ? "bg-[#FEE2E2] text-[#DC2626]"
                        : on
                        ? "bg-white/20 text-white"
                        : "bg-[#DCFCE7] text-[#15803D]"
                    }`}
                  >
                    {String(t.status || "").toLowerCase() === "cleaning"
                      ? "Cleaning"
                      : off
                      ? "Occupied"
                      : "Available"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {picked && (
          <div>
            <label className="block text-[12px] font-bold text-[#475569] mb-1.5 uppercase tracking-wide">
              Number of Customers
            </label>
            <input
              type="number"
              min={1}
              max={picked.capacity || 4}
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
              className="w-full h-[46px] px-3.5 rounded-xl border border-[#E2E8F0] text-[14px] focus:border-[#5B42F3]"
            />
            <p className="text-[11.5px] text-[#94A3B8] mt-1">
              Table {picked.tableNumber} seats up to {picked.capacity} customers.
            </p>
          </div>
        )}

        {err && <p className="text-[12.5px] font-semibold text-[#EF4444]">{err}</p>}

        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={onClose}
            disabled={busy}
            className="h-[48px] rounded-xl border border-[#E2E8F0] text-[#334155] text-[14px] font-bold hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={busy || !picked}
            className="h-[48px] rounded-xl bg-[#5B42F3] text-white text-[14px] font-bold hover:bg-[#4A32E0] disabled:opacity-50"
          >
            {busy ? "Completing…" : "Complete Order"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

const AreaChip = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`shrink-0 px-3.5 py-1.5 rounded-full text-[12.5px] font-extrabold transition-colors ${
      active
        ? "bg-[#5B42F3] text-white"
        : "bg-[#F8FAFC] border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]"
    }`}
  >
    {children}
  </button>
);

export default TableModal;
