import { io } from "socket.io-client";
import { getActiveStoreId } from "./utils/storeSession";
import { SOCKET_URL } from "./config";
import { axiosWrapper } from "./https/axiosWrapper";

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
let retryTimer = 0;
let retryDelay = 2000;

/**
 * Come back after the server REFUSED the handshake.
 *
 * socket.io retries a dropped connection by itself, but not one the server's
 * auth middleware turned away, and it has good reason to turn a till away:
 * the socket signs in with the 15-minute access cookie, which a quiet till
 * lets lapse. One API restart (every deploy) then drops the socket, the
 * reconnect is refused once, and the till hears nothing more: no new-order
 * card, no waiter call, no ringtone, until somebody reloads the page.
 *
 * So: renew the session the way every REST call does, then connect again.
 * Backs off to 30s and stops the moment the last consumer lets go.
 */
const reviveAfterRefusal = (s) => {
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(async () => {
    if (s !== socket) return;
    try {
      await axiosWrapper.post("/api/user/refresh", {});
    } catch {
      /* signed out, or offline: the next attempt, or the login screen, deals with it */
    }
    if (s === socket && !s.connected) s.connect();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30000);
};

// A till left in the background, or a laptop woken from sleep, checks its
// connection the moment somebody looks at it again.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && socket && !socket.connected && !socket.active) {
      retryDelay = 2000;
      reviveAfterRefusal(socket);
    }
  });
}

export const acquireSocket = (restaurantId) => {
  const nextScope = `${restaurantId}:${getActiveStoreId() || ""}`;
  if (socket && scope !== nextScope) {
    window.clearTimeout(retryTimer);
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
    const current = socket;
    socket.on("connect", () => {
      retryDelay = 2000;
      current.emit("joinRestaurant", { restaurantId });
    });
    socket.on("connect_error", () => {
      // `active` is true while socket.io is still retrying on its own.
      if (!current.active) reviveAfterRefusal(current);
    });
    scope = nextScope;
  }
  holders += 1;
  return socket;
};

export const releaseSocket = () => {
  holders = Math.max(0, holders - 1);
  if (holders === 0 && socket) {
    window.clearTimeout(retryTimer);
    socket.disconnect();
    socket = null;
    scope = "";
  }
};
