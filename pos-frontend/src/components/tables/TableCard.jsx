import React from "react";
import { getAvatarName } from "../../utils";
import { FaLongArrowAltRight } from "react-icons/fa";

const TableCard = ({ id, name, status, initials, seats, occupancy = 0, activeSessionId, session, onSelect, onClick }) => {
  const capacity = Number(seats) || 4;
  const currentOccupancy = Number(occupancy) || 0;
  const isBooked = ["Booked", "occupied", "OCCUPIED"].includes(status) || (currentOccupancy > 0 && currentOccupancy >= capacity);

  const handleClick = () => {
    const payload = {
      _id: id,
      id,
      tableNumber: name,
      name,
      status,
      capacity,
      currentOccupancy,
      activeSessionId,
      session,
    };
    if (onClick) {
      onClick(payload);
      return;
    }
    onSelect?.(payload);
  };

  return (
    <div onClick={handleClick} className={`card p-4 text-center cursor-pointer transition-all ${isBooked ? "opacity-80 hover:!translate-y-0 hover:border-accent" : "hover:!translate-y-[-2px] hover:border-accent"}`}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm font-bold text-content flex items-center gap-2">
          Table {name}
          {!isBooked && <FaLongArrowAltRight className="text-accent" size={12} />}
        </p>
        <span className={`badge ${isBooked ? "badge-booked" : "badge-available"}`}>
          {isBooked ? "Booked" : status}
        </span>
      </div>

      <div className="flex items-center justify-center my-4">
        <div className={isBooked ? "w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg bg-gradient-brand" : "w-14 h-14 rounded-full flex items-center justify-center text-content-muted font-bold text-lg bg-surface-tertiary border border-border"}>
          {isBooked ? getAvatarName(initials) || "B" : "+"}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-content-muted">
        <span>{initials || (isBooked ? "Occupied" : "Available")}</span>
        <span>Capacity: <span className="font-semibold text-content">{capacity}</span></span>
      </div>

      <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-border/60">
        <span>Occupancy</span>
        <span className={`font-semibold ${currentOccupancy >= capacity ? "text-accent-red" : currentOccupancy > 0 ? "text-accent-amber" : "text-accent-green"}`}>
          {currentOccupancy} / {capacity}
        </span>
      </div>
    </div>
  );
};

export default TableCard;