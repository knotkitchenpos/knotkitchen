import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getKDSOrders, updateKDSItemStatus, updateKDSOrderStatus } from "../https/newModules";
import { useState } from "react";
import { orderDisplayId } from "../utils/orderLabels";

const C = {
  queued: "bg-accent-amber/10 border-accent-amber/40 text-accent-amber",
  pending: "bg-accent-amber/10 border-accent-amber/40 text-accent-amber",
  preparing: "bg-accent-blue/10 border-accent-blue/40 text-accent-blue",
  ready: "bg-accent-green/10 border-accent-green/40 text-accent-green",
  completed: "bg-accent-green/10 border-accent-green/40 text-accent-green",
  served: "bg-violet-100 border-violet-300 text-violet-700",
  cancelled: "bg-accent-red/10 border-accent-red/40 text-accent-red",
};

export default function KDS() {
  const qc = useQueryClient();
  const [station, setStation] = useState("all");
  const { data, isLoading } = useQuery({
    queryKey: ["kds-orders", station],
    queryFn: () => getKDSOrders(station !== "all" ? { station } : {}),
  });
  const itemMut = useMutation({
    mutationFn: ({ orderId, itemId, status }) => updateKDSItemStatus(orderId, itemId, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kds-orders"] }),
  });
  const orderMut = useMutation({
    mutationFn: ({ orderId, status }) => updateKDSOrderStatus(orderId, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kds-orders"] }),
  });
  const orders = data?.data?.data || [];

  const badge = (status) => {
    const cls = C[status] || "bg-surface border-border text-content-secondary";
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-xs font-bold ${cls}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
        {status || "—"}
      </span>
    );
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-content">Kitchen Display System</h1>
          <p className="text-content-muted text-sm mt-1">Real-time production queue</p>
        </div>
        <div className="flex gap-2">
          {["all", "grill", "fryer", "cold", "beverage"].map((s) => (
            <button key={s}
              onClick={() => setStation(s)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${station === s ? "bg-accent text-white" : "bg-surface-secondary border border-border text-content-secondary hover:bg-surface-tertiary"}`}>
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-content-muted">Loading kitchen orders...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 bg-surface-secondary rounded-xl border border-dashed border-border">
          <p className="text-content-muted font-medium">No orders in the queue</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {orders.map((o) => (
            <div key={o._id} className="bg-surface-secondary rounded-xl border border-border shadow-card overflow-hidden">
              <div className={`px-4 py-3 border-b border-border ${C[o.status] || "bg-surface border-border"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-content">#{orderDisplayId(o)}</span>
                  {badge(o.status)}
                </div>
                <div className="text-xs text-content-muted mt-1">
                  {o.tableNumber ? `Table ${o.tableNumber}` : "Takeaway"} • {o.station || "Main"} •{" "}
                  {o.createdAt ? new Date(o.createdAt).toLocaleTimeString() : ""}
                </div>
              </div>
              <div className="p-4 space-y-2">
                {(o.items || []).map((i) => (
                  <div key={i._id} className="flex items-center justify-between p-2 rounded-lg bg-surface-tertiary">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-content">{i.quantity}× {i.name}</span>
                        {badge(i.status)}
                      </div>
                      {(i.modifiers || []).length > 0 && (
                        <div className="text-xs text-content-muted">
                          {/* Stored as { name, price }; older tickets may hold bare
                              strings, and join() on the objects printed [object Object]. */}
                          {i.modifiers
                            .map((m) => (typeof m === "string" ? m : m?.name))
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {i.status === "queued" && (
                        <button onClick={() => itemMut.mutate({ orderId: o._id, itemId: i._id, status: "preparing" })}
                          className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Start</button>
                      )}
                      {i.status === "preparing" && (
                        <button onClick={() => itemMut.mutate({ orderId: o._id, itemId: i._id, status: "completed" })}
                          className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">Done</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 bg-surface-tertiary border-t flex justify-between items-center">
                <span className="text-xs text-content-muted">
                  Prep: {o.prepTimeSeconds ? `${Math.round(o.prepTimeSeconds / 60)}m` : "—"}
                </span>
                {o.status === "preparing" && (
                  <button onClick={() => orderMut.mutate({ orderId: o._id, status: "ready" })}
                    className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">Mark Ready</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}