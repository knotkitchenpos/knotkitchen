import axios from "axios";

/**
 * CSD API client.
 *
 * Auth is a httpOnly cookie issued by /api/csd/auth/verify-otp, so nothing
 * here ever touches a token — `withCredentials` is what carries the session,
 * and JS cannot read or exfiltrate it.
 */
const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_BASE_URL || "/api"}/csd`,
  withCredentials: true,
  timeout: 20000,
});

/**
 * Turn an axios failure into a plain message for the UI.
 * The server deliberately returns generic text on auth failures; surface it
 * verbatim rather than inventing detail the server chose not to disclose.
 */
export const errorMessage = (err, fallback = "Something went wrong.") =>
  err?.response?.data?.message || err?.message || fallback;

/**
 * 401 means the session is gone — expired, or the account was disabled
 * mid-session (the server re-checks status on every request). Broadcast it so
 * AuthProvider can drop to the sign-in screen from anywhere, instead of each
 * caller having to handle it.
 */
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      window.dispatchEvent(new CustomEvent("csd:unauthorized"));
    }
    return Promise.reject(err);
  }
);

export const auth = {
  sendOtp: (phone) => api.post("/auth/send-otp", { phone }).then((r) => r.data.data),
  verifyOtp: (phone, otp) => api.post("/auth/verify-otp", { phone, otp }).then((r) => r.data.data),
  me: () => api.get("/auth/me").then((r) => r.data.data),
  logout: () => api.post("/auth/logout").then((r) => r.data),
};

/** Per-field messages from a 400, for highlighting form inputs. */
export const fieldErrors = (err) => err?.response?.data?.fieldErrors || {};

export const stores = {
  search: (params) => api.get("/stores/search", { params }).then((r) => r.data.data),
  get: (storeId) => api.get(`/stores/${storeId}`).then((r) => r.data.data),
  updateStatus: (storeId, payload) =>
    api.patch(`/stores/${storeId}/status`, payload).then((r) => r.data.data),
};

export const agreements = {
  list: () => api.get("/agreements").then((r) => r.data.data),
  get: (id) => api.get(`/agreements/${encodeURIComponent(id)}`).then((r) => r.data.data),
  createStore: (id, payload) =>
    api.post(`/agreements/${encodeURIComponent(id)}/create-store`, payload).then((r) => r.data.data),
  retryNotify: (id) =>
    api.post(`/agreements/${encodeURIComponent(id)}/retry-notify`).then((r) => r.data.data),
};

export const restaurants = {
  get: (storeId) => api.get(`/restaurants/${storeId}`).then((r) => r.data.data),
  customers: (storeId, params) =>
    api.get(`/restaurants/${storeId}/customers`, { params }).then((r) => r.data.data),
  orderSummary: (storeId, period) =>
    api.get(`/restaurants/${storeId}/order-summary`, { params: { period } }).then((r) => r.data.data),
  staff: (storeId) => api.get(`/restaurants/${storeId}/staff`).then((r) => r.data.data),
  activity: (storeId) => api.get(`/restaurants/${storeId}/activity`).then((r) => r.data.data),
  posSessions: (storeId) => api.get(`/restaurants/${storeId}/pos-sessions`).then((r) => r.data.data),
  openPos: (storeId, reason) =>
    api.post(`/restaurants/${storeId}/pos-session`, { reason }).then((r) => r.data.data),
  updateCharges: (storeId, payload) =>
    api.patch(`/restaurants/${storeId}/charges`, payload).then((r) => r.data.data),
  updateGoogleBusiness: (storeId, googleBusinessUrl) =>
    api.patch(`/restaurants/${storeId}/google-business`, { googleBusinessUrl }).then((r) => r.data.data),

  documents: (storeId) => api.get(`/restaurants/${storeId}/documents`).then((r) => r.data.data),

  // Documents are never reachable by URL — they stream through an
  // authenticated route, so the browser needs the cookie on the request and
  // the bytes become a short-lived object URL.
  documentBlobUrl: async (storeId, docId) => {
    const res = await api.get(`/restaurants/${storeId}/documents/${docId}/file`, {
      responseType: "blob",
    });
    return URL.createObjectURL(res.data);
  },

  uploadDocument: (storeId, { file, name, category }) =>
    api
      .post(`/restaurants/${storeId}/documents`, file, {
        params: { name, category },
        headers: { "content-type": file.type || "application/octet-stream" },
      })
      .then((r) => r.data.data),

  replaceDocument: (storeId, docId, { file, name, category }) =>
    api
      .put(`/restaurants/${storeId}/documents/${docId}`, file, {
        params: { name, category },
        headers: { "content-type": file.type || "application/octet-stream" },
      })
      .then((r) => r.data.data),

  deleteDocument: (storeId, docId) =>
    api.delete(`/restaurants/${storeId}/documents/${docId}`).then((r) => r.data.data),
};

export const dashboard = {
  get: () => api.get("/dashboard").then((r) => r.data.data),
};

export const onboarding = {
  options: () => api.get("/onboarding/options").then((r) => r.data.data),
  createStore: (payload) => api.post("/onboarding/stores", payload).then((r) => r.data.data),
};

export const orders = {
  search: (params) => api.get("/orders/search", { params }).then((r) => r.data.data),
  get: (id) => api.get(`/orders/${id}`).then((r) => r.data.data),
};

export const staffAdmin = {
  list: (params) => api.get("/staff", { params }).then((r) => r.data.data),
  get: (id) => api.get(`/staff/${id}`).then((r) => r.data.data),
  create: (payload) => api.post("/staff", payload).then((r) => r.data.data),
  update: (id, payload) => api.patch(`/staff/${id}`, payload).then((r) => r.data.data),
};

export const chat = {
  conversations: (params) => api.get("/chat/conversations", { params }).then((r) => r.data.data),
  createConversation: (payload) => api.post("/chat/conversations", payload).then((r) => r.data.data),
  messages: (id, params) =>
    api.get(`/chat/conversations/${id}/messages`, { params }).then((r) => r.data.data),
  send: (id, body) =>
    api.post(`/chat/conversations/${id}/messages`, { body }).then((r) => r.data.data),
  search: (q) => api.get("/chat/search", { params: { q } }).then((r) => r.data.data),
};

export const reports = {
  get: (params) => api.get("/reports", { params }).then((r) => r.data.data),
  audit: (params) => api.get("/reports/audit", { params }).then((r) => r.data.data),
};

export const settings = {
  get: () => api.get("/settings").then((r) => r.data.data),
};

export const jobs = {
  list: (params) => api.get("/jobs", { params }).then((r) => r.data.data),
  get: (id) => api.get(`/jobs/${id}`).then((r) => r.data.data),
  create: (payload) => api.post("/jobs", payload).then((r) => r.data.data),
  update: (id, payload) => api.patch(`/jobs/${id}`, payload).then((r) => r.data.data),
  setStatus: (id, status) => api.patch(`/jobs/${id}/status`, { status }).then((r) => r.data.data),
  comment: (id, body) => api.post(`/jobs/${id}/comments`, { body }).then((r) => r.data.data),
  assignees: () => api.get("/jobs/meta/assignees").then((r) => r.data.data),
};

export default api;
