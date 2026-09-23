import axios from "axios";

/**
 * Public API client for the customer website.
 *
 * withCredentials is deliberately FALSE — the customer website must never send
 * POS/admin session cookies to the backend. Every endpoint it hits is a
 * public unauthenticated one under /api/storefront/* or /api/public/*.
 */
const client = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL || "",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  withCredentials: false,
  timeout: 15_000,
});

// -----------------------------------------------------------------------------
// Bootstrap (hostname → store metadata)
// -----------------------------------------------------------------------------

/**
 * Look up the store from either a slug OR a raw browser hostname (used for
 * custom domains). The backend re-validates the resolved slug/host — we never
 * trust the client's opinion for permissions, only for routing.
 */
export const bootstrapStore = ({ slug, host }) => {
  const identifier = slug || host || "";
  const params = host ? { host } : undefined;
  return client.get(`/api/public/store/by-domain/${encodeURIComponent(identifier)}`, { params });
};

// -----------------------------------------------------------------------------
// Storefront (full site payload)
// -----------------------------------------------------------------------------

export const getStorefront = (slug) =>
  client.get(`/api/storefront/${encodeURIComponent(slug)}`);

// -----------------------------------------------------------------------------
// Orders
// -----------------------------------------------------------------------------

/**
 * Place an order. The body MUST only contain identifiers + quantities +
 * customer details. Prices, taxes, discounts, delivery fees and totals are all
 * computed server-side in services/orderPricingService.js — anything the
 * browser sends for a monetary field is ignored (§10 of the spec).
 */
export const getBookingSlots = (slug, date) =>
  client.get(`/api/storefront/${encodeURIComponent(slug)}/table-bookings/slots`, { params: { date } });

export const requestTableBooking = (slug, payload) =>
  client.post(`/api/storefront/${encodeURIComponent(slug)}/table-bookings`, payload);

export const startCheckout = (slug, payload) =>
  client.post(`/api/storefront/${encodeURIComponent(slug)}/checkout`, payload);

export const verifyCheckout = (slug, checkoutId) =>
  client.post(`/api/storefront/${encodeURIComponent(slug)}/checkout/${checkoutId}/verify`);
