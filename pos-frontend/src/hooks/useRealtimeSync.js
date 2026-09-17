import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { useSelector } from "react-redux";
import { getActiveStoreId } from "../utils/storeSession";
import { SOCKET_URL } from "../config";

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
 *
 * A sixth socket, not a consolidation: the five existing ones (KDS, online
 * orders, and three popups) each do feature-specific work beyond refreshing,
 * and folding them together is a bigger change than the bug being fixed here.
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

    const socket = io(SOCKET_URL, {
      // The server authenticates from the same HTTP-only cookie axiosWrapper
      // uses; without credentials the socket cannot join a tenant room.
      withCredentials: true,
      transports: ["websocket", "polling"],
      query: { restaurantId, storeId: getActiveStoreId() },
    });

    const invalidate = (keys) => {
      keys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
    };

    const handlers = Object.entries(INVALIDATE_ON).map(([event, keys]) => {
      const handler = () => invalidate(keys);
      socket.on(event, handler);
      return [event, handler];
    });

    // Re-join on every connect, not just the first. A dropped connection is
    // normal on a tablet that sleeps, and a reconnect that does not re-join
    // its room is a socket that looks healthy and receives nothing.
    const onConnect = () => {
      socket.emit("joinRestaurant", { restaurantId });
      // Catch up on whatever was missed while disconnected.
      invalidate(["orders", "tables", "kds-orders", "menus", "dashboard"]);
    };
    socket.on("connect", onConnect);

    return () => {
      socket.off("connect", onConnect);
      handlers.forEach(([event, handler]) => socket.off(event, handler));
      socket.disconnect();
    };
  }, [restaurantId, queryClient]);
};

export default useRealtimeSync;
