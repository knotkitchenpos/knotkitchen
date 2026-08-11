import React, { useState } from "react";
import { enqueueSnackbar } from "notistack";

const TableSelectModal = ({ tables = [], onClose, onSelect }) => {
  const [search, setSearch] = useState("");

  const availableTables = tables.filter((t) => {
    const booked =
      ["Booked", "occupied", "OCCUPIED", "Processing"].includes(t.status) ||
      (Number(t.currentOccupancy) > 0 && Number(t.currentOccupancy) >= Number(t.capacity));
    return !booked;
  });

  const filtered = search.trim()
    ? availableTables.filter((t) =>
        String(t.tableNumber).includes(search.trim())
      )
    : availableTables;

  const handleSelect = (table) => {
    if (Number(table.currentOccupancy) >= Number(table.capacity)) {
      enqueueSnackbar(
        `Table ${table.tableNumber} is full (${table.capacity}/${table.capacity}).`,
        { variant: "error" }
      );
      return;
    }
    onSelect({
      tableId: table._id,
      tableNo: table.tableNumber,
      capacity: table.capacity,
      occupancy: table.currentOccupancy,
      status: table.status,
      activeSessionId: table.activeSessionId,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-secondary p-6 rounded-2xl shadow-2xl w-full max-w-md border border-border">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-content text-xl font-semibold font-display">Select Table</h2>
          <button
            onClick={onClose}
            className="text-content-muted hover:text-accent-red text-2xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search table number..."
          className="w-full bg-surface-input border border-border rounded-xl p-3 text-content focus:outline-none focus:border-accent mb-4"
        />

        <div className="max-h-[320px] overflow-y-auto space-y-2 no-scrollbar">
          {filtered.length > 0 ? (
            filtered.map((table) => (
              <button
                key={table._id}
                onClick={() => handleSelect(table)}
                className="w-full flex items-center justify-between p-3.5 rounded-xl border border-border bg-surface-input hover:border-accent hover:bg-accent/5 transition-colors text-left"
              >
                <div>
                  <p className="text-sm font-semibold text-content">Table {table.tableNumber}</p>
                  <p className="text-xs text-content-muted">
                    Capacity {table.capacity} | Occupancy {table.currentOccupancy || 0}
                  </p>
                </div>
                <span className="text-xs font-semibold text-accent">Select</span>
              </button>
            ))
          ) : (
            <p className="text-center text-content-muted text-sm py-6">
              No available tables found.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default TableSelectModal;