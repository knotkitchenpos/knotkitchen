import { useCallback, useEffect, useRef, useState } from "react";
import { enqueueSnackbar } from "../utils/notify";
import { useQueryClient } from "@tanstack/react-query";
import { getUserData, syncOfflineOrders } from "../https";
import { markRejected, readQueue, removeFromQueue } from "../utils/offlineQueue";
import { isReachable } from "../utils/connectivity";
import { money } from "../utils";

/** Orders per sync request: each finishes well inside the request's time limit. */
const BATCH = 25;
/** How often a till with orders waiting tries again when nothing told it the internet is back. */
const RETRY_MS = 15_000;
/**
 * A refused order goes back to the server on its own only this often: the
 * reason is usually a setting staff must change, and resending it every 15
 * seconds just repeats the refusal. "Retry" on the banner sends it at once.
 */
const REFUSED_RETRY_MS = 5 * 60_000;

const due = (e, force) => force || !e.error || !e.failedAt || Date.now() - new Date(e.failedAt).getTime() >= REFUSED_RETRY_MS;

/**
 * Keeps the till honest about the network: whether the server can be reached
 * (utils/connectivity, not just navigator.onLine), how many orders are
 * waiting, and pushes them to the server the moment the connection is back:
 * on the browser's "online", on the first reply or socket connect after an
 * outage, when the till is brought back to the front, and every 15 seconds
 * while any are waiting (a router whose internet returns fires no event).
 */
const useOfflineQueue = (enabled = true) => {
  const qc = useQueryClient();
  const [online, setOnline] = useState(isReachable);
  const [queue, setQueue] = useState(readQueue);
  const busy = useRef(false);

  const flush = useCallback(async (force) => {
    if (busy.current || !enabled) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const forced = force === true; // an event object (a click) is not a force
    if (!readQueue().some((e) => due(e, forced))) return;
    busy.current = true;
    let synced = 0;
    const refused = [];
    try {
      // Oldest first, a batch at a time: a long outage's queue never rides on
      // one huge request, and what synced is off the device before the next.
      const all = readQueue().filter((e) => due(e, forced));
      for (let i = 0; i < all.length; i += BATCH) {
        const batch = all.slice(i, i + BATCH);
        const res = await syncOfflineOrders(batch.map(({ localId, placedAt, order }) => ({ localId, placedAt, order })));
        const { syncedOrders = [], failedOrders = [] } = res.data?.data || {};
        if (syncedOrders.length) removeFromQueue(syncedOrders.map((s) => s.localId));
        synced += syncedOrders.length;
        // A refused order is a sale already rung up: it stays on the device with
        // the reason and keeps retrying on the same key, so a passing error heals
        // itself. Only staff can discard it, from the banner. Warn once per order,
        // not on every retry.
        if (failedOrders.length) refused.push(...markRejected(failedOrders));
      }
    } catch {
      /* still no connection (or the session needs signing in again): the rest wait for the next try */
    } finally {
      busy.current = false;
      setQueue(readQueue());
      if (refused.length) {
        enqueueSnackbar(`${refused.length} offline order(s) were refused: ${refused[0].error}`, { variant: "error", autoHideDuration: 8000 });
      }
      if (synced) {
        enqueueSnackbar(`${synced} offline order(s) synced.`, { variant: "success", important: true });
        qc.invalidateQueries({ queryKey: ["orders"] });
        qc.invalidateQueries({ queryKey: ["popular-items"] });
        qc.invalidateQueries({ queryKey: ["inventory"] });
      }
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
    const up = () => flush();
    const reach = (e) => {
      setOnline(Boolean(e.detail?.online));
      if (e.detail?.online) flush();
    };
    const changed = () => setQueue(readQueue());
    const visible = () => {
      if (document.visibilityState === "visible") flush();
    };
    window.addEventListener("online", up);
    window.addEventListener("kk:connectivity", reach);
    window.addEventListener("kk:offline-queue", changed);
    document.addEventListener("visibilitychange", visible);
    const timer = setInterval(() => {
      if (readQueue().some((e) => due(e, false))) flush();
      // Nothing to send now, but the till believes it is offline: ask the server
      // once, so the badge and banner clear even without the socket.
      else if (enabled && !isReachable() && navigator.onLine !== false) getUserData().catch(() => {});
    }, RETRY_MS);
    setOnline(isReachable());
    flush();
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("kk:connectivity", reach);
      window.removeEventListener("kk:offline-queue", changed);
      document.removeEventListener("visibilitychange", visible);
      clearInterval(timer);
    };
  }, [flush, enabled]);

  return { online, queued: queue.length, rejected: queue.filter((e) => e.error), flush: () => flush(true), discard };
};

export default useOfflineQueue;
