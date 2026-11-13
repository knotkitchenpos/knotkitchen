import { axiosWrapper } from "../https/axiosWrapper";

/**
 * The Partners API (/partners/api -> /api/partners). axiosWrapper already
 * points at it in this build (src/partners/mode.js); paths that do not start
 * with /api/ are the Partners' own, never a store's.
 */
export const partnersApi = {
  me: () => axiosWrapper.get("/me"),
  login: (body) => axiosWrapper.post("/auth/login", body),
  logout: () => axiosWrapper.post("/auth/logout", {}),
  stores: () => axiosWrapper.get("/stores"),
  linkStore: (body) => axiosWrapper.post("/stores", body),
  unlinkStore: (storeId) => axiosWrapper.delete(`/stores/${encodeURIComponent(storeId)}`),
  dashboard: (params) => axiosWrapper.get("/dashboard", { params, timeout: 60000 }),
  orders: (params) => axiosWrapper.get("/orders", { params, timeout: 60000 }),
  // One order, through its store's own API (read only).
  order: (storeId, id) => axiosWrapper.get(`/s/${encodeURIComponent(storeId)}/api/order/${encodeURIComponent(id)}`),
  sessions: () => axiosWrapper.get("/sessions"),
  revokeOtherSessions: () => axiosWrapper.post("/sessions/revoke-others", {}),
};

/** The message an API error carries, for a snackbar. */
export const errorMessage = (err, fallback = "Something went wrong. Please try again.") =>
  err?.response?.data?.message || (err?.code === "ERR_NETWORK" ? "No connection to KnotKitchen. Check your internet." : fallback);
