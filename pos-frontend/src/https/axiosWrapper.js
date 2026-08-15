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
    const isAuthEndpoint =
      url.includes("/api/user/login") ||
      url.includes("/api/user/register") ||
      url.includes("/api/user/refresh") ||
      url === "/api/user" ||
      url.endsWith("/api/user");

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
