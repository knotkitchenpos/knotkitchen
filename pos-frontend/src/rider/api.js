import axios from "axios";

/**
 * The Rider API (/rider/api -> /api/rider), same-origin with the rider's
 * cookie. A signed-out answer anywhere sends the app back to sign-in.
 */
const BASE = `${(import.meta.env.BASE_URL || "/rider/").replace(/\/$/, "")}/api`;

const http = axios.create({ baseURL: BASE, withCredentials: true, timeout: 20000, headers: { "Content-Type": "application/json" } });

http.interceptors.response.use(
  (res) => res,
  (err) => {
    const code = err?.response?.data?.code;
    if (err?.response?.status === 401 && (code === "RIDER_SIGNED_OUT" || !code) && !String(err.config?.url || "").startsWith("/auth/")) {
      window.dispatchEvent(new CustomEvent("rider:signed-out"));
    }
    return Promise.reject(err);
  },
);

const data = (p) => p.then((r) => r.data?.data);

export const riderApi = {
  me: () => data(http.get("/me")),
  signup: (body) => data(http.post("/auth/signup", body)),
  login: (body) => data(http.post("/auth/login", body)),
  logout: (endpoint) => data(http.post("/auth/logout", { endpoint })),
  resetPin: (body) => data(http.post("/auth/reset-pin", body)),
  updateMe: (body) => data(http.patch("/me", body)),
  changePin: (body) => data(http.post("/me/pin", body)),
  setOnline: (online) => data(http.post("/availability", { online })),
  active: () => data(http.get("/deliveries", { params: { scope: "active" } })),
  history: (range, q) => data(http.get("/deliveries", { params: { scope: "history", range, q: q || undefined } })),
  delivery: (id) => data(http.get(`/deliveries/${encodeURIComponent(id)}`)),
  act: (id, step, body = {}) => data(http.post(`/deliveries/${encodeURIComponent(id)}/${step}`, body)),
  push: (endpoint) => data(http.get("/push", { params: endpoint ? { endpoint } : {} })),
  pushSubscribe: (subscription) => data(http.post("/push/subscribe", { subscription })),
  pushUnsubscribe: (endpoint) => data(http.post("/push/unsubscribe", { endpoint })),
  pushTest: () => data(http.post("/push/test", {})),
};

/** A message for a toast: the server's own, or what went wrong with the connection. */
export const errorMessage = (err, fallback = "Something went wrong. Please try again.") => {
  if (err?.response?.data?.message) return err.response.data.message;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "You're offline. Check your internet and try again.";
  if (err?.code === "ERR_NETWORK" || err?.code === "ECONNABORTED") return "Can't reach KnotKitchen right now. Try again in a moment.";
  if (err?.response?.status >= 500) return "KnotKitchen is having trouble right now. Try again in a moment.";
  return fallback;
};

export const errorCode = (err) => err?.response?.data?.code || "";
