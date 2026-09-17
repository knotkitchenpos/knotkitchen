import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { io } from "socket.io-client";
import { enqueueSnackbar } from "notistack";
import { listPrepDueOrders, startPreparingOrder } from "../../https/storefrontApi";
import useAlertBeep from "../../hooks/useAlertBeep";
import { getActiveStoreId } from "../../utils/storeSession";
import { SOCKET_URL } from "../../config";


const clock = (d) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "";

/**
 * "Order for 7:00 PM — time to start preparing."
 *
 * A collection order for a later pickup is accepted into the queue without
 * being started. When its start time comes (pickup time minus Auto Ready) the
 * server sends `order:prepDue`; this rings until someone presses Start
 * Preparing. Outstanding alerts are restored on every (re)connect, and one
 * till starting an order silences the others.
 */
const PrepDuePopup = () => {
  const restaurantId = useSelector((s) => s.user?.restaurantId);
  const [due, setDue] = useState([]);
  const [busyId, setBusyId] = useState("");

  useAlertBeep(due.length > 0);

  useEffect(() => {
    if (!restaurantId) return undefined;
    const socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      query: { restaurantId, storeId: getActiveStoreId() },
    });

    const add = (list) =>
      setDue((prev) => [...prev, ...list.filter((o) => o?.orderId && !prev.some((p) => p.orderId === o.orderId))]);

    const onConnect = async () => {
      socket.emit("joinRestaurant", { restaurantId });
      try {
        const { data } = await listPrepDueOrders();
        add(data?.data || []);
      } catch {
        /* the live event still works without this */
      }
    };
    const onDue = (payload) => add([payload]);
    const onStarted = ({ orderId } = {}) => setDue((prev) => prev.filter((o) => o.orderId !== orderId));

    socket.on("connect", onConnect);
    socket.on("order:prepDue", onDue);
    socket.on("order:prepStarted", onStarted);
    return () => {
      socket.off("connect", onConnect);
      socket.off("order:prepDue", onDue);
      socket.off("order:prepStarted", onStarted);
      socket.disconnect();
    };
  }, [restaurantId]);

  if (!due.length) return null;

  const start = async (order) => {
    setBusyId(order.orderId);
    try {
      await startPreparingOrder(order.orderId);
      setDue((prev) => prev.filter((o) => o.orderId !== order.orderId));
      enqueueSnackbar(`Order ${order.orderNumber || ""} is being prepared.`, { variant: "success" });
    } catch (e) {
      enqueueSnackbar(e?.response?.data?.message || "Could not start this order.", { variant: "error" });
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] lg:bottom-4 left-4 z-[70] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2rem)]">
      {due.map((o) => (
        <div key={o.orderId} role="alert" className="rounded-2xl border-2 border-[#7C3AED] bg-white shadow-2xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#6D28D9]">Time to start preparing</p>
          <p className="text-[18px] leading-tight font-black text-[#0F172A]">
            Order pending for {clock(o.scheduledFor)}
          </p>
          <p className="text-sm text-[#0F172A] mt-1 truncate">
            {o.orderNumber ? `#${o.orderNumber} · ` : ""}
            {o.customer?.name || "Customer"}
            {o.customer?.phone ? ` · ${o.customer.phone}` : ""}
          </p>
          {o.items?.length ? (
            <p className="text-xs text-[#64748B] mt-1 line-clamp-2">
              {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => start(o)}
            disabled={busyId === o.orderId}
            className="mt-3 w-full py-2 rounded-xl bg-[#7C3AED] text-white text-sm font-bold hover:bg-[#6D28D9] disabled:opacity-50"
          >
            {busyId === o.orderId ? "Starting…" : "Start Preparing"}
          </button>
        </div>
      ))}
    </div>
  );
};

export default PrepDuePopup;
