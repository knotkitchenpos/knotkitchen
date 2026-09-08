import axios from "axios";
import { axiosWrapper } from "./axiosWrapper";

/**
 * Storefront API clients.
 *
 * `publicStorefront` is a bare axios instance with NO credentials: the customer
 * website must never send POS session cookies. `axiosWrapper` (cookie-based)
 * is used only for the authenticated POS/admin endpoints below.
 */
export const publicStorefront = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL || "",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  withCredentials: false,
});

// ---------- Public (customer website) ----------
export const getStorefront = (slug) => publicStorefront.get(`/api/storefront/${slug}`);
export const getStorefrontMenu = (slug) => publicStorefront.get(`/api/storefront/${slug}/menu`);
export const getStorefrontProduct = (slug, id) =>
  publicStorefront.get(`/api/storefront/${slug}/products/${id}`);
export const placeStorefrontOrder = (slug, data) =>
  publicStorefront.post(`/api/storefront/${slug}/orders`, data);
export const trackStorefrontOrder = (slug, orderId, phone) =>
  publicStorefront.get(`/api/storefront/${slug}/orders/${orderId}`, { params: { phone } });

// ---------- Authenticated: website settings ----------
export const getWebsiteSettings = () => axiosWrapper.get("/api/website/settings");
export const updateWebsiteSettings = (data) => axiosWrapper.put("/api/website/settings", data);
export const previewWebsite = () => axiosWrapper.get("/api/website/preview");
export const validateGatewayCredentials = (data) => axiosWrapper.post("/api/website/validate-gateway", data);

// ---------- Authenticated: media library ----------
export const listMedia = (params) => axiosWrapper.get("/api/media", { params });
export const deleteMedia = (id) => axiosWrapper.delete(`/api/media/${id}`);
export const updateMedia = (id, data) => axiosWrapper.patch(`/api/media/${id}`, data);

/**
 * Upload an image. Sent as multipart/form-data so the browser streams the file
 * instead of inflating it ~33% as base64.
 * NOTE: the Content-Type header must be deleted so the browser can generate the
 * multipart boundary itself.
 */
export const uploadMedia = (file, { folder = "general", altText = "" } = {}) => {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  if (altText) form.append("altText", altText);

  return axiosWrapper.post("/api/media", form, {
    headers: { "Content-Type": undefined },
  });
};

// ---------- Authenticated: POS online orders ----------
export const listOnlineOrders = (params) => axiosWrapper.get("/api/online-orders", { params });
export const getOnlineOrder = (id) => axiosWrapper.get(`/api/online-orders/${id}`);
export const updateOnlineOrderStatus = (id, action, reason) =>
  axiosWrapper.put(`/api/online-orders/${id}/status`, { action, reason });
export const getOnlineOrderStats = () => axiosWrapper.get("/api/online-orders/stats/summary");

// Accept or reject the items a diner added to a table already mid-meal. These
// live on the table's EXISTING order, so this never creates a second order.
// `itemIds` declines part of a batch and leaves the rest cooking; omitting it
// means the whole batch. `cancel_order` voids the table's ticket outright.
export const resolveAddedItems = (id, action, itemIds) =>
  axiosWrapper.put(`/api/online-orders/${id}/items`, {
    action,
    ...(Array.isArray(itemIds) && itemIds.length ? { itemIds } : {}),
  });
