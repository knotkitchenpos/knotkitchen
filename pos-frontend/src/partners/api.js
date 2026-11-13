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
  menuCatalog: (params) => axiosWrapper.get("/menu-tools/catalog", { params, timeout: 60000 }),
  copyMenu: (body) => axiosWrapper.post("/menu-tools/copy", body, { timeout: 120000 }),
  setMenuPrices: (body) => axiosWrapper.post("/menu-tools/prices", body, { timeout: 60000 }),
  // Publish a store's draft menu to its tills (system) or website, through its own API.
  publishMenu: (storeId, target) => axiosWrapper.post(`/s/${encodeURIComponent(storeId)}/api/menu/publish/${target}`, {}, { timeout: 60000 }),
  staffWatch: (params) => axiosWrapper.get("/staff-watch", { params, timeout: 60000 }),
  // One order, through its store's own API (read only).
  order: (storeId, id) => axiosWrapper.get(`/s/${encodeURIComponent(storeId)}/api/order/${encodeURIComponent(id)}`),
  sessions: () => axiosWrapper.get("/sessions"),
  revokeOtherSessions: () => axiosWrapper.post("/sessions/revoke-others", {}),
  // Accountant exports of one store (GSTR-1 Excel / JSON, Tally XML).
  exportSummary: (storeId, params) => axiosWrapper.get(`/exports/${encodeURIComponent(storeId)}/summary`, { params, timeout: 120000 }),
  exportFile: (storeId, file, params) =>
    axiosWrapper.get(`/exports/${encodeURIComponent(storeId)}/${file}`, { params, responseType: "blob", timeout: 180000 }),
};

/** The message an API error carries, for a snackbar. */
export const errorMessage = (err, fallback = "Something went wrong. Please try again.") =>
  err?.response?.data?.message || (err?.code === "ERR_NETWORK" ? "No connection to KnotKitchen. Check your internet." : fallback);
