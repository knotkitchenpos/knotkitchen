import React from "react";
import { getAvatarName } from "../../utils";
import { FaLongArrowAltRight } from "react-icons/fa";

const TableCard = ({ id, name, status, initials, seats, occupancy = 0, availableAt, activeSessionId, session, onSelect, onClick }) => {
  const capacity = Number(seats) || 4;
  const currentOccupancy = Number(occupancy) || 0;
  // A settled table rests for the restaurant's configured cleaning time
  // before the next party is seated. It used to fall through to "available"
  // here, so the card invited staff to seat a table nobody had cleared and
  // gave no sign that a timer was running at all.
  const isCleaning = status === "cleaning";
  const isBooked =
    !isCleaning &&
    (["Booked", "occupied", "OCCUPIED"].includes(status) ||
      (currentOccupancy > 0 && currentOccupancy >= capacity));

  // Whole minutes remaining, rounded up: "free in 1 min" while any of that
  // minute is left is what an operator glancing at the floor expects.
  const minutesLeft = (() => {
    if (!isCleaning || !availableAt) return 0;
    const ms = new Date(availableAt).getTime() - Date.now();
    return ms > 0 ? Math.ceil(ms / 60000) : 0;
  })();

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
    <div onClick={handleClick} className={`card p-4 text-center cursor-pointer transition-all ${isBooked || isCleaning ? "opacity-80 hover:!translate-y-0 hover:border-accent" : "hover:!translate-y-[-2px] hover:border-accent"}`}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm font-bold text-content flex items-center gap-2">
          {name}
          {!isBooked && !isCleaning && <FaLongArrowAltRight className="text-accent" size={12} />}
        </p>
        <span
          className={`badge ${
            isCleaning ? "badge-booked" : isBooked ? "badge-booked" : "badge-available"
          }`}
        >
          {isCleaning
            ? minutesLeft > 0
              ? `Cleaning · ${minutesLeft} min`
              : "Cleaning"
            : isBooked
            ? "Booked"
            : status}
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