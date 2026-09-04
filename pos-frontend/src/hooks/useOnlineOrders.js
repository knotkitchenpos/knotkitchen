import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { listOnlineOrders } from "../https/storefrontApi";
import { getActiveStoreId } from "../utils/storeSession";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "") || "";

/**
 * Realtime online-order feed for the POS (§13, §32).
 *
 * Resilience model:
 *  1. Initial REST fetch populates the list.
 *  2. Socket.IO pushes new orders instantly (room = restaurant:<id>).
 *  3. On reconnect we re-fetch anything created since the last order we hold,
 *     so orders placed during an outage are never missed.
 *  4. A slow (60s) safety poll runs ONLY while the socket is disconnected.
 */
export function useOnlineOrders(restaurantId) {
  const [orders, setOrders] = useState([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newOrderAlert, setNewOrderAlert] = useState(null);

  const socketRef = useRef(null);
  const lastSyncRef = useRef(null);

  const mergeOrders = useCallback((incoming) => {
    setOrders((prev) => {
      const byId = new Map(prev.map((o) => [String(o._id), o]));
      incoming.forEach((o) => byId.set(String(o._id), { ...byId.get(String(o._id)), ...o }));
      return [...byId.values()].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
    });
  }, []);

  const fetchOrders = useCallback(
    async ({ since } = {}) => {
      try {
        const res = await listOnlineOrders({
          status: "Pending,In Progress,Ready",
          ...(since ? { since } : {}),
          limit: 100,
        });
        const data = res.data.data || [];
        mergeOrders(data);
        lastSyncRef.current = new Date().toISOString();
        return data;
      } catch (err) {
        return [];
      } finally {
        setLoading(false);
      }
    },
    [mergeOrders]
  );

  // Initial load
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Socket subscription — scoped to this restaurant's room only.
  useEffect(() => {
    if (!restaurantId) return undefined;

    const socket = io(BACKEND_URL, {
      // The backend authenticates Socket.IO from the same HTTP-only access
      // cookie used by axiosWrapper. Without credentials the socket cannot
      // join a tenant room.
      withCredentials: true,
      transports: ["websocket", "polling"],
      query: { restaurantId, storeId: getActiveStoreId() },
    });
    socketRef.current = socket;

    const join = () => {
      setConnected(true);
      socket.emit("joinRestaurant", { restaurantId });
      // Catch up on anything missed while we were away.
      fetchOrders({ since: lastSyncRef.current });
    };

    const onCreated = (payload) => {
      if (payload?.source !== "WEBSITE") return;
      // The socket payload is a summary; refetch to get the full record.
      fetchOrders({ since: lastSyncRef.current });
      setNewOrderAlert({ ...payload, receivedAt: Date.now() });
    };

    const onStatus = () => fetchOrders();

    socket.on("connect", join);
    socket.on("disconnect", () => setConnected(false));
    socket.on("onlineOrder:created", onCreated);
    socket.on("onlineOrder:status", onStatus);

    return () => {
      socket.off("connect", join);
      socket.off("onlineOrder:created", onCreated);
      socket.off("onlineOrder:status", onStatus);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [restaurantId, fetchOrders]);

  // Fallback poll every 12 seconds when disconnected or idle to detect missed website orders (§15s polling window)
  useEffect(() => {
    const pollInterval = connected ? 15000 : 12000;
    const id = setInterval(() => fetchOrders({ since: lastSyncRef.current }), pollInterval);
    return () => clearInterval(id);
  }, [connected, fetchOrders]);

  return {
    orders,
    loading,
    connected,
    newOrderAlert,
    dismissAlert: () => setNewOrderAlert(null),
    refresh: fetchOrders,
  };
}
