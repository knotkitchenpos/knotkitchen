import axios from "axios";

// Bare axios for public (no-cookie) endpoints: QR table view,
// public session ordering, and payment link resolution/capture.
export const publicApi = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL || "",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  withCredentials: false,
});

// --- QR table / public ordering ---
// All QR endpoints are token-scoped: the backend resolves the tenant and
// table exclusively from the secure QR token (`?table=<token>`). The client
// can never supply restaurantId/outletId/tableId/sessionId in the URL or
// body to access another table's session.
export const qrGetTable = (token) => publicApi.get(`/api/qr/table/${token}`);
export const qrGetSession = (token) => publicApi.get(`/api/qr/session/${token}`);
export const qrPlaceOrder = (token, data) =>
  publicApi.post(`/api/qr/session/items/${token}`, data); // tenant-scoped via table token
export const qrRequestBill = (token) =>
  publicApi.post(`/api/qr/request-bill/${token}`); // token-scoped; no client sessionId
export const qrCallWaiter = (token) => publicApi.post(`/api/qr/waiter-call/${token}`);
export const qrGetPaymentIntent = (token) =>
  publicApi.post(`/api/qr/payment-intent/${token}`); // payment UI prep (no capture yet)

// --- Payment links (customer side) ---
export const paymentLinkGet = (token) => publicApi.get(`/api/payment-link/${token}`);
export const paymentLinkVerify = (token, data) =>
  publicApi.post(`/api/payment-link/${token}/verify`, data);