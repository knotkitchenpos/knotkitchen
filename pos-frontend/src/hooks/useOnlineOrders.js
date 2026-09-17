import { useCallback, useEffect, useRef, useState } from "react";
import { listOnlineOrders } from "../https/storefrontApi";
import { acquireSocket, releaseSocket } from "../socket";


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

    const socket = acquireSocket(restaurantId);

    const join = () => {
      setConnected(true);
      // Catch up on anything missed while we were away.
      fetchOrders({ since: lastSyncRef.current });
    };
    const onDisconnect = () => setConnected(false);

    const onCreated = (payload) => {
      if (payload?.source !== "WEBSITE") return;
      // The socket payload is a summary; refetch to get the full record.
      fetchOrders({ since: lastSyncRef.current });
      setNewOrderAlert({ ...payload, receivedAt: Date.now() });
    };

    const onStatus = () => fetchOrders();

    socket.on("connect", join);
    socket.on("disconnect", onDisconnect);
    socket.on("onlineOrder:created", onCreated);
    socket.on("onlineOrder:status", onStatus);
    if (socket.connected) join();

    return () => {
      socket.off("connect", join);
      socket.off("disconnect", onDisconnect);
      socket.off("onlineOrder:created", onCreated);
      socket.off("onlineOrder:status", onStatus);
      releaseSocket();
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
