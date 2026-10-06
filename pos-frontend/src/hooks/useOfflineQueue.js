import { useCallback, useEffect, useRef, useState } from "react";
import { enqueueSnackbar } from "notistack";
import { useQueryClient } from "@tanstack/react-query";
import { syncOfflineOrders } from "../https";
import { markRejected, readQueue, removeFromQueue } from "../utils/offlineQueue";
import { money } from "../utils";

/**
 * Keeps the till honest about the network: how many orders are waiting,
 * and pushes them to the server the moment the connection is back
 * (and every minute while any are waiting, in case "online" fired early).
 */
const useOfflineQueue = (enabled = true) => {
  const qc = useQueryClient();
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [queue, setQueue] = useState(readQueue);
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
      // A refused order is a sale already rung up: it stays on the device with
      // the reason and keeps retrying on the same key, so a passing error heals
      // itself. Only staff can discard it, from the banner. Warn once per order,
      // not on every minute's retry.
      const fresh = failedOrders.length ? markRejected(failedOrders) : [];
      if (fresh.length) {
        enqueueSnackbar(`${fresh.length} offline order(s) were refused: ${fresh[0].error}`, { variant: "error", autoHideDuration: 8000 });
      }
      if (syncedOrders.length) {
        enqueueSnackbar(`${syncedOrders.length} offline order(s) synced.`, { variant: "success" });
        qc.invalidateQueries({ queryKey: ["orders"] });
      }
    } catch {
      /* still offline; try again on the next tick */
    } finally {
      busy.current = false;
      setQueue(readQueue());
    }
  }, [enabled, qc]);

  /** Drop one refused order for good, after staff confirm which sale it is. */
  const discard = useCallback((localId) => {
    const e = readQueue().find((x) => x.localId === localId);
    if (!e) return;
    const total = e.order?.bills?.totalWithTax;
    const label = `${e.localNumber}${total != null ? ` (${money(total)})` : ""}`;
    if (!window.confirm(`Discard offline order ${label}? It will not reach your sales records.`)) return;
    removeFromQueue([localId]);
  }, []);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      flush();
    };
    const down = () => setOnline(false);
    const changed = () => setQueue(readQueue());
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

  return { online, queued: queue.length, rejected: queue.filter((e) => e.error), flush, discard };
};

export default useOfflineQueue;
