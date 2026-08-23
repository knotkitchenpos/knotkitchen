import axios from "axios";

const defaultHeader = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

export const axiosWrapper = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL || "/",
  withCredentials: true,
  headers: { ...defaultHeader },
});

// Attach short-lived Staff Security PIN authorization token if active
axiosWrapper.interceptors.request.use(
  (config) => {
    const pinToken = sessionStorage.getItem("staffPinToken");
    const pinExpiry = sessionStorage.getItem("staffPinTokenExpiry");
    if (pinToken && pinExpiry && Number(pinExpiry) > Date.now()) {
      config.headers["x-staff-pin-token"] = pinToken;
    } else {
      sessionStorage.removeItem("staffPinToken");
      sessionStorage.removeItem("staffPinTokenExpiry");
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ===== Auto Token Refresh =====
let isRefreshing = false;
let pendingQueue = [];

const flushQueue = (error = null) => {
  pendingQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve();
  });
  pendingQueue = [];
};

axiosWrapper.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error?.config;
    const url = originalRequest?.url || "";
    // NOTE: only the endpoints that BOOTSTRAP a new session (login/register)
    // or the refresh endpoint itself are considered "auth endpoints" for the
    // purpose of skipping the 401 → refresh → retry loop. GET /api/user
    // (getUserData) is a normal protected endpoint — treating it as an auth
    // endpoint caused users to be silently logged out any time their 15-minute
    // access token had expired but a valid refresh token was still in the
    // cookie jar (e.g. after leaving the browser tab open for a while and
    // coming back). We now let the interceptor call POST /api/user/refresh
    // and transparently retry the original /api/user request instead.
    const isAuthEndpoint =
      url.includes("/api/user/login") ||
      url.includes("/api/user/register") ||
      url.includes("/api/user/refresh");

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          pendingQueue.push({ resolve, reject });
        }).then(() => axiosWrapper(originalRequest));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        await axiosWrapper.post("/api/user/refresh", {});
        flushQueue();
        return axiosWrapper(originalRequest);
      } catch (refreshError) {
        flushQueue(refreshError);
        if (window.location.pathname !== "/auth") {
          window.location.href = "/auth";
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
