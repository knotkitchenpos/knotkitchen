import { client } from "../lib/api";

// Knot Eats (eats.<base>). Here, not in lib/api.js, so store websites never
// download them (contract §10.8: the main chunk grows at most 2 KB gzip).
//
// The marketplace's own public endpoints: the menu (getEatsStorefront, the same
// payload as the website's, so a store without the website still sells here), the
// listing, fee, distance, offers and reviews. Same rule as an order: identifiers
// in, every price, fee, distance and total is the server's.

const eats = (path) => `/api/eats${path}`;
const id = (v) => encodeURIComponent(v);
// A browse point leaves the device at ~110 m, the precision the server keys
// distances by anyway (§3.1); the exact point is only sent with a delivery order.
const round3 = (n) => Math.round(n * 1000) / 1000;

export const getEatsConfig = () => client.get(eats("/config"));

export const listEatsStores = (params, { signal } = {}) => client.get(eats("/stores"), { params, signal });

export const getEatsStore = (storeId, loc) =>
  client.get(eats(`/stores/${id(storeId)}`), {
    params: Number.isFinite(loc?.lat) && Number.isFinite(loc?.lng) ? { lat: round3(loc.lat), lng: round3(loc.lng) } : undefined,
  });

export const getEatsStorefront = (storeId) => client.get(eats(`/stores/${id(storeId)}/storefront`));

export const getStoreReviews = (storeId, page = 1) => client.get(eats(`/stores/${id(storeId)}/reviews`), { params: { page } });

export const startEatsCheckout = (storeId, payload) => client.post(eats(`/stores/${id(storeId)}/checkout`), payload);

export const verifyEatsCheckout = (token) => client.post(eats(`/checkout/${id(token)}/verify`));

export const getEatsOrder = (token) => client.get(eats(`/orders/${id(token)}`));

export const submitReview = (token, { rating, text }) => client.post(eats(`/orders/${id(token)}/review`), { rating, text });
