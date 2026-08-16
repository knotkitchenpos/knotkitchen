import { axiosWrapper } from "./axiosWrapper";

// API Endpoints

// Auth Endpoints
export const sendLoginOtp = (data) => axiosWrapper.post("/api/user/login/send-otp", data);
export const login = (data) => axiosWrapper.post("/api/user/login", data);
export const register = (data) => axiosWrapper.post("/api/user/register", data);
export const getUserData = () => axiosWrapper.get("/api/user");
export const logout = () => axiosWrapper.post("/api/user/logout");

// Store Auth Endpoints
export const validateStoreId = (data) => axiosWrapper.post("/api/auth/validate-store", data);
export const validateStoreOwner = (data) => axiosWrapper.post("/api/user/store/validate-owner", data);
export const sendStoreOtp = (data) => axiosWrapper.post("/api/auth/request-otp", data);
export const verifyStoreOtp = (data) => axiosWrapper.post("/api/auth/verify-otp", data);
export const completeStoreSignup = (data) => axiosWrapper.post("/api/user/store/complete-signup", data);

// Table Endpoints
export const addTable = (data) => axiosWrapper.post("/api/table/", data);
export const getTables = () => axiosWrapper.get("/api/table");
export const updateTable = ({ tableId, ...tableData }) =>
  axiosWrapper.put(`/api/table/${tableId}`, tableData);
export const deleteTable = (tableId) =>
  axiosWrapper.delete(`/api/table/${tableId}`);

// Payment Endpoints
export const createOrderRazorpay = (data) =>
  axiosWrapper.post("/api/payment/create-order", data);
export const verifyPaymentRazorpay = (data) =>
  axiosWrapper.post("/api/payment/verify-payment", data);

// Order Endpoints
export const addOrder = (data) => axiosWrapper.post("/api/order/", data);
export const getOrders = () => axiosWrapper.get("/api/order");
export const updateOrderStatus = ({ orderId, orderStatus }) =>
  axiosWrapper.put(`/api/order/${orderId}`, { orderStatus });
// Store-specific popular products (POS redesign). Backend computes this from
// real order history and falls back to the store's own featured/default
// products when the store doesn't have enough order history yet.
export const getPopularItems = (params = {}) =>
  axiosWrapper.get("/api/order/popular-items", { params });


// Table Session Endpoints (EPOS table ordering)
export const createTableSession = (data) =>
  axiosWrapper.post("/api/table-session/", data);
export const getTableSessions = () => axiosWrapper.get("/api/table-session");
export const getTableSessionById = (id) =>
  axiosWrapper.get(`/api/table-session/${id}`);
export const addItemsToTableSession = ({ sessionId, ...data }) =>
  axiosWrapper.post(`/api/table-session/${sessionId}/items`, data);
export const getTableById = (tableId) => axiosWrapper.get(`/api/table/${tableId}`);
export const requestBillForSession = (sessionId) =>
  axiosWrapper.post(`/api/table-session/${sessionId}/request-bill`);

// Menu Endpoints
export const getMenus = () => axiosWrapper.get("/api/menu");
export const addCategory = (data) => axiosWrapper.post("/api/menu/category", data);
export const deleteCategory = (menuId) => axiosWrapper.delete(`/api/menu/${menuId}`);
export const addDish = (data) => axiosWrapper.post("/api/menu/dish", data);
export const deleteDish = ({ menuId, itemId }) =>
  axiosWrapper.delete(`/api/menu/${menuId}/dish/${itemId}`);
export const updateDishStatus = ({ menuId, itemId }) =>
  axiosWrapper.put(`/api/menu/${menuId}/dish/${itemId}/availability`);
// Assign / clear a subcategory on a dish (POS redesign - optional grouping)
export const updateDishSubcategory = ({ menuId, itemId, subcategory }) =>
  axiosWrapper.put(`/api/menu/${menuId}/dish/${itemId}/subcategory`, { subcategory });


// Variant Endpoints
export const addVariant = (data) =>
  axiosWrapper.post(`/api/menu/${data.menuId}/dish/${data.itemId}/variant`, data);
export const deleteVariant = ({ menuId, itemId, variantId }) =>
  axiosWrapper.delete(`/api/menu/${menuId}/dish/${itemId}/variant/${variantId}`);

// Add-on Endpoints
export const addAddon = (data) =>
  axiosWrapper.post(`/api/menu/${data.menuId}/dish/${data.itemId}/addon`, data);
export const deleteAddon = ({ menuId, itemId, addonId }) =>
  axiosWrapper.delete(`/api/menu/${menuId}/dish/${itemId}/addon/${addonId}`);

// Modifier Group Endpoints
export const addModifierGroup = (data) =>
  axiosWrapper.post(`/api/menu/${data.menuId}/dish/${data.itemId}/modifier-group`, data);
export const deleteModifierGroup = ({ menuId, itemId, groupId }) =>
  axiosWrapper.delete(`/api/menu/${menuId}/dish/${itemId}/modifier-group/${groupId}`);

// Combo Meal Endpoints
export const toggleCombo = ({ menuId, itemId, ...data }) =>
  axiosWrapper.put(`/api/menu/${menuId}/dish/${itemId}/combo`, data);

// Pricing Rule Endpoints
export const addPriceRule = (data) =>
  axiosWrapper.post(`/api/menu/${data.menuId}/dish/${data.itemId}/price-rule`, data);
export const deletePriceRule = ({ menuId, itemId, ruleId }) =>
  axiosWrapper.delete(`/api/menu/${menuId}/dish/${itemId}/price-rule/${ruleId}`);

// Availability Scheduling Endpoints (item level)
export const updateItemSchedule = ({ menuId, itemId, ...data }) =>
  axiosWrapper.put(`/api/menu/${menuId}/dish/${itemId}/schedule`, data);

// Time-based Menu Endpoints (category level)
export const updateMenuSchedule = ({ menuId, ...data }) =>
  axiosWrapper.put(`/api/menu/${menuId}/schedule`, data);

// Menu Versioning & Publishing Endpoints
export const publishMenu = (menuId) => axiosWrapper.put(`/api/menu/${menuId}/publish`);
export const unpublishMenu = (menuId) => axiosWrapper.put(`/api/menu/${menuId}/unpublish`);
export const getMenuVersions = (menuId) => axiosWrapper.get(`/api/menu/${menuId}/versions`);
export const rollbackMenu = ({ menuId, version }) =>
  axiosWrapper.put(`/api/menu/${menuId}/rollback/${version}`);

// Structured Text (Notepad) Menu Import Endpoints
export const getMenuImportFormat = () => axiosWrapper.get("/api/menu/import/format");
export const previewMenuImport = (text) => axiosWrapper.post("/api/menu/import/preview", { text });
export const importMenuText = ({ text, mode }) =>
  axiosWrapper.post("/api/menu/import", { text, mode });


