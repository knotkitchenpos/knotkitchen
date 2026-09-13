import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { io } from "socket.io-client";
import { enqueueSnackbar } from "notistack";
import { dismissWaiterCall } from "../../https/newModules";
import { getTables } from "../../https";
import useAlertBeep from "../../hooks/useAlertBeep";
import { getActiveStoreId } from "../../utils/storeSession";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "") || "";

/**
 * "Waiter is called by Table N" — the POS side of the table QR's Call Waiter.
 *
 * The customer's tap used to set a flag on the Table row and nothing else, so
 * a cashier only found out by happening to reload the Tables screen. The
 * backend now emits `waiter:called`; this listens for it, holds the alert on
 * screen and beeps until someone acknowledges.
 *
 * Acknowledging clears the call server-side, which emits `waiter:cleared` —
 * so a second till showing the same alert silences itself too, rather than
 * two people walking to the same table.
 */
const WaiterCallPopup = () => {
  const restaurantId = useSelector((s) => s.user?.restaurantId);
  const [calls, setCalls] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const socketRef = useRef(null);

  // Beeps while anything is outstanding, and stops the moment the list empties.
  useAlertBeep(calls.length > 0);

  useEffect(() => {
    if (!restaurantId) return undefined;

    const socket = io(BACKEND_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      query: { restaurantId, storeId: getActiveStoreId() },
    });
    socketRef.current = socket;

    // A call only arrives as a socket event, so a till that reloads, or whose
    // socket dropped when the diner tapped, would never hear it. The Table
    // row keeps the flag until someone acknowledges, so pick those up on
    // every (re)connect.
    const restore = async () => {
      try {
        const { data } = await getTables();
        const open = (data?.data || [])
          .filter((t) => t?.waiterCallActive)
          .map((t) => ({
            tableId: String(t._id),
            tableNumber: t.tableNumber,
            displayId: t.displayId || t.tableName || "",
            area: t.area || t.floor || "",
            requestedAt: t.waiterCallRequestedAt,
          }));
        if (!open.length) return;
        setCalls((prev) => [...prev, ...open.filter((c) => !prev.some((p) => p.tableId === c.tableId))]);
      } catch {
        /* the live event still works without this */
      }
    };

    const join = () => {
      socket.emit("joinRestaurant", { restaurantId });
      restore();
    };

    const onCalled = (payload) => {
      if (!payload?.tableId) return;
      setCalls((prev) => {
        // A customer tapping twice is one call, not two alerts.
        if (prev.some((c) => c.tableId === payload.tableId)) return prev;
        return [...prev, payload];
      });
      try {
        enqueueSnackbar(`Waiter is called by Table ${payload.displayId || payload.tableNumber}`, {
          variant: "warning",
        });
      } catch {
        /* a failed toast must not break the alert */
      }
    };

    // Cleared from another till — drop it here too so the beep stops everywhere.
    const onCleared = (payload) => {
      if (!payload?.tableId) return;
      setCalls((prev) => prev.filter((c) => c.tableId !== payload.tableId));
    };

    socket.on("connect", join);
    socket.on("waiter:called", onCalled);
    socket.on("waiter:cleared", onCleared);

    return () => {
      socket.off("connect", join);
      socket.off("waiter:called", onCalled);
      socket.off("waiter:cleared", onCleared);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [restaurantId]);

  if (calls.length === 0) return null;

  const acknowledge = async (call) => {
    setBusyId(call.tableId);
    try {
      await dismissWaiterCall(call.tableId);
      // The socket echo will also remove it; doing it here too keeps the beep
      // from continuing if the echo is slow or the socket has dropped.
      setCalls((prev) => prev.filter((c) => c.tableId !== call.tableId));
    } catch (e) {
      enqueueSnackbar(e?.response?.data?.message || "Could not acknowledge the call.", {
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed top-4 right-4 z-[70] flex flex-col gap-2 w-[330px] max-w-[calc(100vw-2rem)]">
      {calls.map((call) => {
        const label = call.displayId || `Table ${call.tableNumber}`;
        // "GF1" reads as a table on the floor; a bare "4" does not.
        const heading = /^table\b/i.test(label) || !/^\d+$/.test(label) ? label : `Table ${label}`;
        return (
          <div
            key={call.tableId}
            role="alert"
            className="rounded-2xl border-2 border-[#F59E0B] bg-white shadow-2xl p-4 flex items-start gap-3 animate-fade-in"
          >
            <span className="text-2xl leading-none shrink-0" aria-hidden="true">
              🔔
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#B45309]">
                Waiter called
              </p>
              <p className="text-[22px] leading-tight font-black text-[#0F172A] truncate">{heading}</p>
              {call.area ? (
                <p className="text-[11.5px] font-semibold text-[#64748B] truncate">{call.area}</p>
              ) : null}
              <p className="text-[11px] text-[#94A3B8] mt-0.5">
                {call.requestedAt
                  ? new Date(call.requestedAt).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => acknowledge(call)}
              disabled={busyId === call.tableId}
              title="Acknowledge — stops the alert"
              aria-label={`Acknowledge waiter call from ${label}`}
              className="shrink-0 w-10 h-10 rounded-xl bg-[#22C55E] text-white text-lg font-black hover:bg-[#16A34A] disabled:opacity-60 flex items-center justify-center"
            >
              ✓
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default WaiterCallPopup;
