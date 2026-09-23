import { axiosWrapper } from "./axiosWrapper";

/**
 * Website and online-order API calls. All authenticated (cookie session via
 * axiosWrapper); the customer-facing storefront lives in customer-web.
 */

// ---------- Website settings ----------
export const getWebsiteSettings = () => axiosWrapper.get("/api/website/settings");
export const updateWebsiteSettings = (data) => axiosWrapper.put("/api/website/settings", data);
export const validateGatewayCredentials = (data) => axiosWrapper.post("/api/website/validate-gateway", data);

// ---------- Authenticated: media library ----------
export const listMedia = (params) => axiosWrapper.get("/api/media", { params });
export const deleteMedia = (id) => axiosWrapper.delete(`/api/media/${id}`);

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
export const updateOnlineOrderStatus = (id, action, reason) =>
  axiosWrapper.put(`/api/online-orders/${id}/status`, { action, reason });
// Scheduled pickups whose kitchen start time has come.
export const listPrepDueOrders = () => axiosWrapper.get("/api/online-orders/prep-due");
// Customer orders nobody has accepted or cancelled yet, for the "New order" card.
export const listAwaitingOrders = () => axiosWrapper.get("/api/online-orders/awaiting");
export const startPreparingOrder = (id) => axiosWrapper.post(`/api/online-orders/${id}/start-preparing`);

// Accept or reject the items a diner added to a table already mid-meal. These
// live on the table's EXISTING order, so this never creates a second order.
// `itemIds` declines part of a batch and leaves the rest cooking; omitting it
// means the whole batch. `cancel_order` voids the table's ticket outright.
export const resolveAddedItems = (id, action, itemIds) =>
  axiosWrapper.put(`/api/online-orders/${id}/items`, {
    action,
    ...(Array.isArray(itemIds) && itemIds.length ? { itemIds } : {}),
  });
