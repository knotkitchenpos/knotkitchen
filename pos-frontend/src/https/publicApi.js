import axios from "axios";
import { BACKEND_URL } from "../config";

// Bare axios for public (no-cookie) endpoints: QR table view,
// public session ordering, and payment link resolution/capture.
export const publicApi = axios.create({
  baseURL: BACKEND_URL,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  withCredentials: false,
});

// --- QR table / public ordering ---
// All QR endpoints are token-scoped: the backend resolves the tenant and
// table exclusively from the secure QR token (`?table=<token>`). The client
// can never supply restaurantId/outletId/tableId/sessionId in the URL or
// body to access another table's session.
// `claim` is the session accessToken the page is holding (see OrderOnline).
// The QR token identifies the TABLE and never changes; the claim identifies
// the one SESSION this browser is ordering in, and dies when that session is
// settled. Sent on every call so a link saved by an earlier diner cannot
// reach the party sitting at that table now.
const withClaim = (path, claim) => (claim ? `${path}?s=${encodeURIComponent(claim)}` : path);

export const qrGetTable = (token, claim) =>
  publicApi.get(withClaim(`/api/qr/table/${token}`, claim));
export const qrPlaceOrder = (token, data, claim) =>
  publicApi.post(`/api/qr/session/items/${token}`, { ...data, sessionToken: claim || "" }); // tenant-scoped via table token
export const qrRequestBill = (token, claim) =>
  publicApi.post(`/api/qr/request-bill/${token}`, { sessionToken: claim || "" }); // token-scoped; no client sessionId
export const qrCallWaiter = (token) => publicApi.post(`/api/qr/waiter-call/${token}`);
export const qrGetPaymentIntent = (token, claim, phone) =>
  publicApi.post(`/api/qr/payment-intent/${token}`, { sessionToken: claim || "", ...(phone ? { phone } : {}) }); // opens a gateway order for the table's bill
// The browser reports back from the gateway. The server re-computes the
// signature before it believes any of it, then settles the table.
export const qrVerifyPayment = (token, data, claim) =>
  publicApi.post(`/api/qr/payment-verify/${token}`, { ...data, sessionToken: claim || "" });

// --- Payment links (customer side) ---
export const paymentLinkGet = (token) => publicApi.get(`/api/payment-link/${token}`);
export const paymentLinkVerify = (token, data) =>
  publicApi.post(`/api/payment-link/${token}/verify`, data);