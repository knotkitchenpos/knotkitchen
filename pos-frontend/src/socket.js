import { io } from "socket.io-client";
import { getActiveStoreId } from "./utils/storeSession";
import { SOCKET_URL } from "./config";

/**
 * The one socket.io connection for the signed-in POS.
 *
 * Every realtime consumer (the query invalidator, auto print, the alert
 * popups, the Online Orders page) used to open its own connection: seven
 * sockets to one origin, all joined to the same room. They now share this
 * one. A consumer calls `acquireSocket(restaurantId)` in its effect and
 * `releaseSocket()` in the cleanup; the connection closes when the last
 * consumer lets go (sign-out unmounts the shell, so nothing leaks).
 *
 * Joining the tenant room happens here, on every `connect`, because a
 * reconnect that does not re-join is a socket that looks healthy and hears
 * nothing. Consumers keep their own `connect` handlers for catch-up work,
 * and must run that work immediately when the socket is already connected
 * (`if (socket.connected) onConnect();`), since a late subscriber missed
 * the original event.
 */
let socket = null;
let scope = "";
let holders = 0;

export const acquireSocket = (restaurantId) => {
  const nextScope = `${restaurantId}:${getActiveStoreId() || ""}`;
  if (socket && scope !== nextScope) {
    socket.disconnect();
    socket = null;
  }
  if (!socket) {
    socket = io(SOCKET_URL, {
      // The server authenticates from the same HTTP-only cookie axiosWrapper
      // uses; without credentials the socket cannot join a tenant room.
      withCredentials: true,
      transports: ["websocket", "polling"],
      query: { restaurantId, storeId: getActiveStoreId() },
    });
    socket.on("connect", () => socket.emit("joinRestaurant", { restaurantId }));
    scope = nextScope;
  }
  holders += 1;
  return socket;
};

export const releaseSocket = () => {
  holders = Math.max(0, holders - 1);
  if (holders === 0 && socket) {
    socket.disconnect();
    socket = null;
    scope = "";
  }
};
