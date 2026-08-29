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

export const dashboard = {
  get: () => api.get("/dashboard").then((r) => r.data.data),
};

export const onboarding = {
  options: () => api.get("/onboarding/options").then((r) => r.data.data),
  createStore: (payload) => api.post("/onboarding/stores", payload).then((r) => r.data.data),
};

export default api;
