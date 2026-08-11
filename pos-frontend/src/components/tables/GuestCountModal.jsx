import React, { useState } from "react";
import { enqueueSnackbar } from "notistack";

const GuestCountModal = ({ table, onClose, onConfirm }) => {
  const capacity = Number(table?.capacity) || 4;
  const [guests, setGuests] = useState(1);

  const handleConfirm = () => {
    const count = Number(guests);
    if (!count || count < 1) {
      enqueueSnackbar("Please enter a valid customer count.", { variant: "warning" });
      return;
    }
    if (count > capacity) {
      enqueueSnackbar(`Table ${table.name} has a maximum capacity of ${capacity} customers.`, { variant: "error" });
      return;
    }
    onConfirm(count);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-secondary p-6 rounded-2xl shadow-2xl w-full max-w-sm border border-border">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-content text-xl font-semibold font-display">Table {table.name}</h2>
          <button onClick={onClose} className="text-content-muted hover:text-accent-red text-2xl leading-none p-1">&times;</button>
        </div>
        <p className="text-sm text-content-muted mb-4">Capacity: {capacity} customers | Current occupancy: {table.currentOccupancy || 0}</p>
        <label className="block text-content-muted mb-2 text-sm font-medium">Customer Count</label>
        <input
          type="number"
          min="1"
          max={capacity}
          value={guests}
          onChange={(e) => setGuests(e.target.value)}
          className="w-full bg-surface-input border border-border rounded-xl p-3.5 text-content focus:outline-none focus:border-accent"
        />
        <button onClick={handleConfirm} className="btn-primary w-full !py-3 mt-5">Select Table & Continue</button>
      </div>
    </div>
  );
};

export default GuestCountModal;