import { useCallback, useEffect, useRef, useState } from "react";
import { enqueueSnackbar } from "notistack";
import { useQueryClient } from "@tanstack/react-query";
import { syncOfflineOrders } from "../https";
import { readQueue, removeFromQueue } from "../utils/offlineQueue";

/**
 * Keeps the till honest about the network: how many orders are waiting,
 * and pushes them to the server the moment the connection is back
 * (and every minute while any are waiting, in case "online" fired early).
 */
const useOfflineQueue = (enabled = true) => {
  const qc = useQueryClient();
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [queued, setQueued] = useState(() => readQueue().length);
  const busy = useRef(false);

  const flush = useCallback(async () => {
    if (busy.current || !enabled) return;
    const q = readQueue();
    if (!q.length) return;
    busy.current = true;
    try {
      const res = await syncOfflineOrders(q.map(({ localId, placedAt, order }) => ({ localId, placedAt, order })));
      const { syncedOrders = [], failedOrders = [] } = res.data?.data || {};
      if (syncedOrders.length) removeFromQueue(syncedOrders.map((s) => s.localId));
      // A rejected order (bad payload) must not block the rest forever.
      const rejected = failedOrders.filter((f) => !/network|timeout/i.test(String(f.error)));
      if (rejected.length) {
        removeFromQueue(rejected.map((f) => f.localId));
        enqueueSnackbar(`${rejected.length} offline order(s) could not be saved: ${rejected[0].error}`, { variant: "error", autoHideDuration: 8000 });
      }
      if (syncedOrders.length) {
        enqueueSnackbar(`${syncedOrders.length} offline order(s) synced.`, { variant: "success" });
        qc.invalidateQueries({ queryKey: ["orders"] });
      }
    } catch {
      /* still offline; try again on the next tick */
    } finally {
      busy.current = false;
      setQueued(readQueue().length);
    }
  }, [enabled, qc]);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      flush();
    };
    const down = () => setOnline(false);
    const changed = () => setQueued(readQueue().length);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    window.addEventListener("kk:offline-queue", changed);
    const timer = setInterval(() => {
      if (navigator.onLine && readQueue().length) flush();
    }, 60_000);
    if (navigator.onLine) flush();
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.removeEventListener("kk:offline-queue", changed);
      clearInterval(timer);
    };
  }, [flush]);

  return { online, queued, flush };
};

export default useOfflineQueue;
