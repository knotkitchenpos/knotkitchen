import { io } from "socket.io-client";

/**
 * The rider's live connection: same-origin at /rider/socket.io (Caddy and the
 * dev server forward it), signed in by the rider cookie. The server puts it
 * in this rider's own room only.
 */
let socket = null;

export const connectRiderSocket = () => {
  if (socket) return socket;
  socket = io(window.location.origin, {
    path: "/rider/socket.io",
    transports: ["websocket"],
    query: { app: "rider" },
    withCredentials: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 15000,
  });
  // A refused handshake (an API restart, say) is not retried by socket.io
  // itself: try again a little later.
  socket.on("connect_error", () => {
    setTimeout(() => {
      if (socket && !socket.connected) socket.connect();
    }, 10000);
  });
  return socket;
};

export const disconnectRiderSocket = () => {
  socket?.disconnect();
  socket = null;
};
