import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  withCredentials: true,
});

// The admin backend wraps every successful response as { success: true, data: ... }.
// Unwrap it so all consumers get `res.data` directly (arrays, stats, admin object, etc.).
api.interceptors.response.use(
  (response) => {
    if (
      response.data &&
      typeof response.data === "object" &&
      "data" in response.data
    ) {
      response.data = response.data.data;
    }
    return response;
  },
  (error) => Promise.reject(error)
);

// Auth
export const loginApi = (email, password) => api.post("/admin/login", { email, password });
export const logoutApi = () => api.post("/admin/logout");
export const getMeApi = () => api.get("/admin/me");

// Stats
export const getStatsApi = () => api.get("/admin/stats");

// Stores
export const sendStoreOtpApi = (data) => api.post("/admin/stores/send-otp", data);
export const createStoreApi = (data) => api.post("/admin/stores", data);
export const getStoresApi = () => api.get("/admin/stores");
export const updateStoreStatusApi = (id, data) => api.patch(`/admin/stores/${id}/status`, data);
export const deleteStoreApi = (id) => api.delete(`/admin/stores/${id}`);

// Restaurants
export const getRestaurantsApi = () => api.get("/admin/restaurants");
export const getRestaurantApi = (id) => api.get(`/admin/restaurants/${id}`);
export const toggleRestaurantStatusApi = (id) => api.patch(`/admin/restaurants/${id}/status`);
export const updateRestaurantApi = (id, data) => api.put(`/admin/restaurants/${id}`, data);

// Users
export const getUsersApi = (restaurantId) => api.get("/admin/users", { params: { restaurantId } });
export const updateUserApi = (id, data) => api.patch(`/admin/users/${id}`, data);

// Menus
export const getMenusApi = (restaurantId) => api.get("/admin/menus", { params: { restaurantId } });
export const updateDishApi = (menuId, itemId, data) => api.patch(`/admin/menus/${menuId}/items/${itemId}`, data);
export const toggleMenuPublishApi = (id) => api.patch(`/admin/menus/${id}/publish`);

// Orders
export const getOrdersApi = (restaurantId, status) => api.get("/admin/orders", { params: { restaurantId, status } });
export const updateOrderStatusApi = (id, orderStatus) => api.patch(`/admin/orders/${id}`, { orderStatus });

// Tables
export const getTablesApi = (restaurantId) => api.get("/admin/tables", { params: { restaurantId } });
export const updateTableApi = (id, data) => api.patch(`/admin/tables/${id}`, data);

export default api;