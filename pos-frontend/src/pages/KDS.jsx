import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { getOrders, markOrderReady } from "../https";
import { listAwaitingOrders } from "../https/storefrontApi";
import { orderDisplayId, tableLabel } from "../utils/orderLabels";
import { billableItems, itemDisplayName, itemExtras } from "../utils/orderItems";
import { time12 } from "../utils";
import { isSettled } from "../constants/orderStatus";

/**
 * Kitchen display: today's orders that are cooking, oldest first.
 *
 * It reads the orders the tills, QR tables and website already write. It used
 * to read a separate KDS store that no order path ever filled, so it was always
 * empty. The ["orders", ...] key is refetched by useRealtimeSync on every
 * order event, so a new order appears without a reload.
 *
 * Skipped: per-dish Start/Done and stations. Add them when a kitchen asks;
 * they need a per-line status endpoint on the order.
 */

// Every stored spelling of "cooking". Website "Pending" is still waiting for
// someone to accept it, so it is not the kitchen's yet. "Completed" brings in
// takeaways paid at the till, which are created Completed but still cooked.
const COOKING = "Preparing,preparing,In Progress,in progress,Completed";

// A till takeaway paid at the counter: Completed as a sale, in the kitchen
// until someone taps Ready (which stamps readyAt and keeps it Completed).
const paidTakeaway = (o) =>
  isSettled(o.orderStatus) &&
  o.source === "POS" &&
  !["dine-in", "delivery"].includes(String(o.orderType || "").toLowerCase()) &&
  !o.readyAt;

const typeLabel = (o) => {
  const t = String(o.orderType || "").toLowerCase();
  if (t === "dine-in") return o.table ? tableLabel(o.table, "Table") : "Table";
  if (t === "delivery") return "Delivery";
  return "Collection";
};

export default function KDS() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["orders", "kds"],
    queryFn: () => getOrders({ status: COOKING }),
  });
  // A QR order is created cooking but still waits for a till to accept it.
  const { data: awaitingRes } = useQuery({
    queryKey: ["orders", "kds", "awaiting"],
    queryFn: listAwaitingOrders,
  });
  const awaiting = new Set((awaitingRes?.data?.data || []).map((a) => String(a.orderId)));

  const ready = useMutation({
    mutationFn: (orderId) => markOrderReady(orderId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orders"] }),
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not mark it ready.", { variant: "error" }),
  });

  const orders = [...(data?.data?.data || [])]
    .reverse()
    .filter((o) => (!isSettled(o.orderStatus) || paidTakeaway(o)) && !awaiting.has(String(o._id)) && billableItems(o.items).length > 0);

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-content">Kitchen</h1>
        <p className="text-content-muted text-sm mt-1">Orders being prepared, oldest first</p>
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
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-content">#{orderDisplayId(o)}</span>
                  <span className="text-xs text-content-muted">{time12(o.createdAt)}</span>
                </div>
                <div className="text-xs text-content-muted mt-1">{typeLabel(o)}</div>
              </div>
              <div className="p-4 space-y-2">
                {billableItems(o.items).map((i, idx) => (
                  <div key={i._id || idx} className="p-2 rounded-lg bg-surface-tertiary">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-content">{i.quantity}× {itemDisplayName(i)}</span>
                      {/* Added by the diner and not yet approved by staff: do not cook yet.
                          Only a table's order has that step; a till line is
                          stored "pending" too and is the kitchen's at once. */}
                      {i.status === "pending" && o.tableSessionId && (
                        <span className="px-2 py-0.5 rounded-full border text-xs font-bold bg-accent-amber/10 border-accent-amber/40 text-accent-amber">
                          awaiting approval
                        </span>
                      )}
                    </div>
                    {itemExtras(i).length > 0 && (
                      <div className="text-xs text-content-muted">
                        {itemExtras(i).map((x) => (x.quantity > 1 ? `${x.quantity}× ${x.name}` : x.name)).join(", ")}
                      </div>
                    )}
                    {i.note && <div className="text-xs text-accent-amber">Note: {i.note}</div>}
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 bg-surface-tertiary border-t flex justify-end">
                <button
                  disabled={ready.isPending}
                  onClick={() => ready.mutate(o._id)}
                  className="px-3 py-1.5 text-sm font-bold bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-40"
                >
                  Ready
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
