import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { enqueueSnackbar } from "notistack";
import { updateOnlineOrderStatus } from "../../https/storefrontApi";
import useAlertBeep from "../../hooks/useAlertBeep";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "") || "";

/**
 * Realtime popup for QR customer orders.
 *
 * When a customer scans a Table QR, orders from the menu and submits,
 * `pos-backend/routes/qrRoute.js` creates a kitchen Order tagged
 * `source: "QR"` and calls `emitOrderCreated`. This component listens
 * to the same `onlineOrder:created` socket event `useOnlineOrders`
 * already uses, but ONLY fires for `source === "QR"` orders — so
 * marketplace / website / walk-in POS notifications stay handled by
 * their own popups.
 *
 * The popup surfaces:
 *   - The table number the order came from (via order.table populated
 *     name/number, or a fallback like "T{id-suffix}")
 *   - Customer name / phone / guests
 *   - The line items + total
 *   - A "View in Orders" button that navigates to the Orders page
 *
 * If a burst of QR orders lands together, the popup queues them so the
 * biller can dismiss one, see the next, etc. — never dropping any.
 */
const QRTableOrderPopup = () => {
  const navigate = useNavigate();
  const restaurantId = useSelector((s) => s.user?.restaurantId);
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const socketRef = useRef(null);

  // A QR order is a customer waiting at a table — the alert holds until the
  // biller actually decides, rather than being a toast that scrolls away.
  useAlertBeep(queue.length > 0);

  useEffect(() => {
    if (!restaurantId) return undefined;
    const socket = io(BACKEND_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      query: { restaurantId },
    });
    socketRef.current = socket;

    const join = () => socket.emit("joinRestaurant", { restaurantId });

    const onCreated = (payload) => {
      // Only handle QR-origin orders. WEBSITE / MARKETPLACE / POS have
      // their own popups (or intentionally none for walk-in POS).
      if (String(payload?.source || "").toUpperCase() !== "QR") return;
      setQueue((prev) => [payload, ...prev]);
      try {
        enqueueSnackbar(
          `New Table Order · Table ${payload.tableNumber || payload.table || "?"}`,
          { variant: "info" },
        );
      } catch {
        /* snackbar failure is not fatal */
      }
    };

    socket.on("connect", join);
    socket.on("onlineOrder:created", onCreated);

    return () => {
      socket.off("connect", join);
      socket.off("onlineOrder:created", onCreated);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [restaurantId]);

  if (queue.length === 0) return null;
  const current = queue[0];
  const dismiss = () => setQueue((prev) => prev.slice(1));

  /**
   * Accept sends the order to the kitchen; Cancel rejects it. Both go through
   * the existing online-order status endpoint, so a QR order follows exactly
   * the same lifecycle (and the same auto-ready sweep) as any other channel.
   */
  const decide = async (action) => {
    const orderId = current?._id || current?.id;
    if (!orderId) {
      // Nothing to act on — don't strand the operator with a beeping popup.
      dismiss();
      return;
    }
    setBusy(true);
    try {
      await updateOnlineOrderStatus(orderId, action);
      enqueueSnackbar(action === "accept" ? "Order accepted." : "Order cancelled.", {
        variant: action === "accept" ? "success" : "info",
      });
      dismiss();
    } catch (e) {
      enqueueSnackbar(e?.response?.data?.message || "Could not update the order.", {
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  // The socket payload from emitOrderCreated carries the full Order doc
  // (see services/socket.js). The `table` field is a populated ObjectId
  // or the referenced document, depending on the emitter. We surface the
  // most human-friendly identifier we can find.
  const tableLabel =
    current.table?.displayId ||
    current.table?.tableName ||
    (current.table?.tableNumber != null ? `Table ${current.table.tableNumber}` : null) ||
    (current.tableNumber != null ? `Table ${current.tableNumber}` : null) ||
    (typeof current.table === "string" ? `Table ${current.table.slice(-4)}` : "Table —");

  const items = Array.isArray(current.items) ? current.items : [];
  const total = Number(current.bills?.totalWithTax || current.bills?.total || 0);
  const customer = current.customerDetails || {};

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden border border-[#E2E8F0]">
        <div className="px-6 py-5 bg-gradient-to-r from-[#5B42F3] to-[#7C3AED] text-white flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/80">
              New Table Order · Scanned QR
            </p>
            <h2 className="text-[22px] font-extrabold mt-1 leading-tight">{tableLabel}</h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 text-white text-[20px] leading-none flex items-center justify-center"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Customer / total header row */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-[#94A3B8] uppercase tracking-wide">Customer</p>
              <p className="text-[15px] font-extrabold text-[#0F172A] truncate">
                {customer.name || "Guest"}
              </p>
              {customer.phone && (
                <p className="text-[12px] text-[#64748B] truncate">{customer.phone}</p>
              )}
              {customer.guests > 0 && (
                <p className="text-[11px] text-[#94A3B8]">{customer.guests} guest(s)</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-[11px] font-bold text-[#94A3B8] uppercase tracking-wide">Total</p>
              <p className="text-[22px] font-extrabold text-[#5B42F3]">
                ₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {/* Item list */}
          <div className="max-h-[240px] overflow-y-auto rounded-xl border border-[#E2E8F0] divide-y divide-[#E2E8F0]">
            {items.length === 0 ? (
              <div className="px-3 py-4 text-[12.5px] text-[#94A3B8] text-center">No line items.</div>
            ) : (
              items.map((it, i) => (
                <div key={i} className="px-3 py-2 flex items-start justify-between gap-3 text-[13px]">
                  <div className="min-w-0">
                    <p className="font-bold text-[#0F172A] truncate">
                      {it.quantity || 1}× {it.name || "Item"}
                    </p>
                    {Array.isArray(it.modifiers) && it.modifiers.length > 0 && (
                      <p className="text-[11.5px] text-[#64748B] truncate">
                        + {it.modifiers.map((m) => m.name).filter(Boolean).join(", ")}
                      </p>
                    )}
                    {it.note && (
                      <p className="text-[11px] text-[#5B42F3] font-semibold truncate">Note: {it.note}</p>
                    )}
                  </div>
                  <span className="shrink-0 font-extrabold text-[#0F172A]">
                    ₹{Number((it.total ?? it.price * (it.quantity || 1)) || 0).toFixed(2)}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Action row — the alert keeps sounding until one of these is used. */}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => decide("cancel")}
              disabled={busy}
              className="h-[44px] rounded-xl border border-[#FECACA] bg-[#FEF2F2] text-[#DC2626] text-[13.5px] font-bold hover:bg-[#FEE2E2] disabled:opacity-60"
            >
              Cancel Order
            </button>
            <button
              type="button"
              onClick={() => decide("accept")}
              disabled={busy}
              className="h-[44px] rounded-xl bg-[#22C55E] text-white text-[13.5px] font-extrabold hover:bg-[#16A34A] disabled:opacity-60"
            >
              {busy ? "Working…" : "Accept Order"}
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              dismiss();
              navigate("/orders");
            }}
            className="w-full text-[12px] font-bold text-[#64748B] hover:text-[#5B42F3]"
          >
            View in Orders
          </button>

          {queue.length > 1 && (
            <p className="text-[11px] font-bold text-[#94A3B8] text-center">
              {queue.length - 1} more pending…
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default QRTableOrderPopup;
