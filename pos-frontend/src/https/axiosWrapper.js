import axios from "axios";
import { BACKEND_URL } from "../config";
import { isPublicPath } from "../utils/publicRoutes";
import { getActiveStoreId } from "../utils/storeSession";
import { requestPin } from "../utils/pinPrompt";

const defaultHeader = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

export const axiosWrapper = axios.create({
  baseURL: BACKEND_URL || "/",
  withCredentials: true,
  headers: { ...defaultHeader },
});

// Attach short-lived Staff Security PIN authorization token if active
axiosWrapper.interceptors.request.use(
  (config) => {
    // Tell the API which takeaway this tab is acting as, so it reads that
    // store's session cookie and not another one signed in from the same
    // browser. Without this every takeaway shares one session.
    const storeId = getActiveStoreId();
    if (storeId) config.headers["x-store-id"] = storeId;

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
    // Every endpoint that either BOOTSTRAPS a fresh session or exists to
    // hand one out is exempt from the refresh loop — otherwise a wrong
    // password on any of these gets swallowed by /api/user/refresh's own
    // 401 ("No refresh token provided!") and the caller never sees the
    // real 'Invalid credentials.' message.
    const isAuthEndpoint =
      url.includes("/api/user/login") ||
      url.includes("/api/user/register") ||
      url.includes("/api/user/refresh") ||
      url.includes("/api/user/store/login") ||
      url.includes("/api/user/store/setup-password") ||
      url.includes("/api/user/store/status") ||
      url.includes("/api/user/store/account-status") ||
      url.includes("/api/user/store/set-password") ||
      url.includes("/api/user/impersonate");

    // The account was locked for non-payment. The POS moves to Billing; see
    // components/shared/AccountLock.jsx.
    if (error.response?.status === 402 && error.response?.data?.code === "ACCOUNT_LOCKED") {
      window.dispatchEvent(new Event("kk:account-locked"));
    }

    // A protected action without a fresh Security PIN: ask for it once, then
    // retry (the request interceptor attaches the new PIN token). Closing the
    // popup hands the original error back to the screen.
    if (error.response?.status === 403 && error.response?.data?.code === "PIN_REQUIRED" && originalRequest && !originalRequest._pinRetry) {
      originalRequest._pinRetry = true;
      try {
        await requestPin();
      } catch {
        return Promise.reject(error);
      }
      return axiosWrapper(originalRequest);
    }
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
        // Only staff pages get bounced to the sign-in screen. On a guest page
        // (a scanned table QR, a payment link) a failed refresh just means
        // "no session", which is the normal state — redirecting there would
        // replace the customer's menu with the POS login.
        if (!isPublicPath()) {
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
