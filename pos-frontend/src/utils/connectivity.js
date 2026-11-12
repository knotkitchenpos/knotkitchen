/**
 * Can this till reach the server right now?
 *
 * navigator.onLine only says a network cable or Wi-Fi is up: on a router with
 * no internet it stays true, and the till showed "Online" while every order
 * went to the offline queue. So the answer comes from what actually happened:
 * any reply from the server (even an error) means reachable, a request that
 * got no reply at all means not, and the realtime socket connecting means
 * reachable again. The browser going offline is believed at once.
 *
 * Changes are announced as a "kk:connectivity" window event ({ online }).
 */
let reachable = typeof navigator === "undefined" ? true : navigator.onLine !== false;

export const isReachable = () => reachable;

export const markReachable = (online) => {
  const next = Boolean(online);
  if (next === reachable) return;
  reachable = next;
  try {
    window.dispatchEvent(new CustomEvent("kk:connectivity", { detail: { online: next } }));
  } catch {
    /* not in a browser */
  }
};

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => markReachable(false));
  // "online" only means the network is up; the next request or the socket
  // proves the server is reachable. useOfflineQueue syncs on it straight away.
}
