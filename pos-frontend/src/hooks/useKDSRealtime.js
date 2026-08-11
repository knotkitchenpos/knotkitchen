import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "") || "";

export function useKDSRealtime(restaurantId) {
  const [newOrder, setNewOrder] = useState(null);
  const [waiterCall, setWaiterCall] = useState(null);

  useEffect(() => {
    if (!restaurantId) return undefined;
    const socket = io(BACKEND_URL, { withCredentials: false, transports: ["websocket", "polling"] });

    const onNewOrder = (data) => setNewOrder({ ...data, _at: Date.now() });
    const onWaiterCall = (data) => setWaiterCall({ ...data, _at: Date.now() });

    socket.on("connect", () => socket.emit("joinRestaurant", { restaurantId }));
    socket.on("newOrder", onNewOrder);
    socket.on("waiterCall", onWaiterCall);

    const t1 = setTimeout(() => setNewOrder(null), 15000);
    const t2 = setTimeout(() => setWaiterCall(null), 15000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      socket.off("newOrder", onNewOrder);
      socket.off("waiterCall", onWaiterCall);
      socket.disconnect();
    };
  }, [restaurantId]);

  return { newOrder, waiterCall };
}