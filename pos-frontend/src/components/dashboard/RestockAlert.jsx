import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { getRestockAlerts } from "../../https";
import { acquireSocket, releaseSocket } from "../../socket";
import { qty, unitLabel } from "../../utils/inventory";

/**
 * "Pizza Dough needs restocking: 2 Piece left."
 *
 * When a sale takes an inventory item to its minimum stock (or to nothing),
 * the server sends `inventory:restock` (pos-backend/services/inventory.js) and
 * this card appears on every till of the restaurant. What already needs
 * restocking is shown when the POS opens. Dismissed items stay hidden until
 * the next alert for them, or the next time the POS is opened.
 */
const RestockAlert = () => {
  const restaurantId = useSelector((s) => s.user?.restaurantId);
  const navigate = useNavigate();
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!restaurantId) return undefined;
    const socket = acquireSocket(restaurantId);
    // The newest word on an item replaces the old one (low, then out).
    const merge = (list) =>
      setItems((prev) => {
        const next = prev.filter((p) => !list.some((i) => i.ingredientId === p.ingredientId));
        return [...next, ...list.filter((i) => i?.ingredientId)];
      });
    const onRestock = (payload) => merge(payload?.items || []);
    socket.on("inventory:restock", onRestock);
    getRestockAlerts()
      .then(({ data }) => merge(data?.data || []))
      .catch(() => {
        /* the live alert still works without this */
      });
    return () => {
      socket.off("inventory:restock", onRestock);
      releaseSocket();
    };
  }, [restaurantId]);

  if (!items.length) return null;

  const out = items.filter((i) => i.status === "out");
  return (
    <div className="fixed top-3 right-3 z-[65] w-[330px] max-w-[calc(100vw-1.5rem)]">
      <div role="alert" className={`rounded-2xl border-2 ${out.length ? "border-[#DC2626]" : "border-[#F59E0B]"} bg-white shadow-2xl p-4`}>
        <p className={`text-[11px] font-bold uppercase tracking-wide ${out.length ? "text-[#B91C1C]" : "text-[#B45309]"}`}>
          Restock needed
        </p>
        <ul className="mt-1 space-y-1 max-h-[180px] overflow-y-auto">
          {items.map((i) => (
            <li key={i.ingredientId} className="text-[13px] text-[#0F172A]">
              <span className="font-extrabold">{i.name}</span>{" "}
              <span className={i.status === "out" ? "font-bold text-[#B91C1C]" : "text-[#64748B]"}>
                {i.status === "out" ? "is out of stock" : `${qty(i.stockQuantity)} ${unitLabel(i.unit)} left (minimum ${qty(i.reorderLevel)})`}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setItems([])}
            className="flex-1 py-2 rounded-xl border border-[#E2E8F0] text-[#334155] text-sm font-bold hover:bg-[#F8FAFC]"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => {
              setItems([]);
              navigate("/settings?view=inventory");
            }}
            className="flex-1 py-2 rounded-xl bg-[#FD5302] text-white text-sm font-bold hover:bg-[#D64502]"
          >
            View inventory
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestockAlert;
