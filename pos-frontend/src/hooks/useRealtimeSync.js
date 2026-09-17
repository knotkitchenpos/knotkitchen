import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { acquireSocket, releaseSocket } from "../socket";

/**
 * Keep the whole POS current without anyone pressing refresh.
 *
 * The screens were built on TanStack queries with a 30-second `staleTime` and
 * no polling, and nothing subscribed them to the socket the server was already
 * broadcasting on. A till sits focused all day, so a query that goes stale is
 * never re-fetched: a new order, a status change or a republished menu simply
 * did not appear until somebody reloaded the page.
 *
 * This subscribes once, for the whole app, and turns each event into a cache
 * invalidation. It deliberately does NOT try to merge payloads into the cache
 * by hand -- a socket payload is a summary, and reconciling it with whatever
 * shape each screen expects is how two screens end up disagreeing. Invalidate,
 * let the query refetch, and there is one source of truth.
 */


/**
 * Which cached queries each event invalidates.
 *
 * Broad on purpose. Refetching a list that did not need it costs one request;
 * missing one leaves an operator looking at a stale order, and the whole point
 * of this file is that they should never have to wonder.
 */
const INVALIDATE_ON = {
  newOrder: ["orders", "tables", "kds-orders", "dashboard", "popular-items"],
  "onlineOrder:created": ["orders", "online-orders", "kds-orders", "dashboard"],
  "onlineOrder:status": ["orders", "online-orders", "kds-orders", "tables", "dashboard"],
  "menu:updated": ["menus", "popular-items", "store-properties"],
  tableSessionUpdated: ["tables", "orders"],
  waiterCall: ["tables"],
  "tableBooking:created": ["table-bookings"],
  "tableBooking:updated": ["tables", "table-bookings"],
  "order:prepDue": ["orders", "online-orders", "kds-orders"],
  "order:prepStarted": ["orders", "online-orders", "kds-orders"],
};

const useRealtimeSync = () => {
  const queryClient = useQueryClient();
  const restaurantId = useSelector((s) => s.user?.restaurantId);

  useEffect(() => {
    if (!restaurantId) return undefined;

    const socket = acquireSocket(restaurantId);

    const invalidate = (keys) => {
      keys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    };

    const handlers = Object.entries(INVALIDATE_ON).map(([event, keys]) => {
      const handler = () => invalidate(keys);
      socket.on(event, handler);
      return [event, handler];
    });

    // Catch up on whatever was missed while disconnected (the shared socket
    // re-joins its room on every connect).
    const onConnect = () => {
      invalidate(["orders", "tables", "kds-orders", "menus", "dashboard"]);
    };
    socket.on("connect", onConnect);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      handlers.forEach(([event, handler]) => socket.off(event, handler));
      releaseSocket();
    };
  }, [restaurantId, queryClient]);
};

export default useRealtimeSync;
