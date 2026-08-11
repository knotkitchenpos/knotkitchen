import { axiosWrapper } from "./axiosWrapper";

// Restaurant / Multi-tenant
export const onboardRestaurant = (data) => axiosWrapper.post("/api/restaurant/onboard", data);
export const getMyRestaurant = () => axiosWrapper.get("/api/restaurant/me");
export const getFranchiseOverview = () => axiosWrapper.get("/api/restaurant/franchise");
export const addOutlet = (data) => axiosWrapper.post("/api/restaurant/outlets", data);
export const getOutlets = (restaurantId) => axiosWrapper.get(`/api/restaurant/${restaurantId}/outlets`);

// Team / RBAC
export const createTeam = (data) => axiosWrapper.post("/api/team/", data);
export const getTeams = (restaurantId) => axiosWrapper.get(`/api/team/${restaurantId}`);
export const addStaff = (data) => axiosWrapper.post("/api/team/staff", data);
export const getStaff = (restaurantId) => axiosWrapper.get(`/api/team/staff/${restaurantId}`);
export const updateStaff = (userId, data) => axiosWrapper.put(`/api/team/staff/${userId}`, data);
export const getAuditLogs = (restaurantId) => axiosWrapper.get(`/api/team/audit/${restaurantId}`);
export const getRolePermissions = () => axiosWrapper.get("/api/team/roles/permissions");

// KDS
export const createKDSOrder = (data) => axiosWrapper.post("/api/kds/", data);
export const getKDSOrders = (params) => axiosWrapper.get("/api/kds/", { params });
export const updateKDSItemStatus = (kdsOrderId, itemId, data) => axiosWrapper.patch(`/api/kds/${kdsOrderId}/items/${itemId}`, data);
export const updateKDSOrderStatus = (kdsOrderId, data) => axiosWrapper.patch(`/api/kds/${kdsOrderId}/status`, data);
export const getKDSAnalytics = (params) => axiosWrapper.get("/api/kds/analytics", { params });

// Inventory
export const addIngredient = (data) => axiosWrapper.post("/api/inventory/ingredients", data);
export const getIngredients = (restaurantId, lowStock) => axiosWrapper.get(`/api/inventory/ingredients/${restaurantId}`, { params: { lowStock } });
export const updateIngredient = (ingredientId, data) => axiosWrapper.put(`/api/inventory/ingredients/${ingredientId}`, data);
export const deleteIngredient = (ingredientId) => axiosWrapper.delete(`/api/inventory/ingredients/${ingredientId}`);
export const addStockMovement = (data) => axiosWrapper.post("/api/inventory/movements", data);
export const getStockMovements = (restaurantId) => axiosWrapper.get(`/api/inventory/movements/${restaurantId}`);
export const addVendor = (data) => axiosWrapper.post("/api/inventory/vendors", data);
export const getVendors = (restaurantId) => axiosWrapper.get(`/api/inventory/vendors/${restaurantId}`);
export const createPurchaseOrder = (data) => axiosWrapper.post("/api/inventory/purchase-orders", data);
export const getPurchaseOrders = (restaurantId) => axiosWrapper.get(`/api/inventory/purchase-orders/${restaurantId}`);
export const getInventoryAnalytics = (restaurantId) => axiosWrapper.get(`/api/inventory/analytics/${restaurantId}`);

// Loyalty
export const addCustomer = (data) => axiosWrapper.post("/api/loyalty/customers", data);
export const getCustomers = (restaurantId) => axiosWrapper.get(`/api/loyalty/customers/${restaurantId}`);
export const addRewardPoints = (customerId, data) => axiosWrapper.post(`/api/loyalty/customers/${customerId}/points`, data);
export const addWalletTransaction = (data) => axiosWrapper.post("/api/loyalty/wallet/transactions", data);
export const getWalletHistory = (customerId) => axiosWrapper.get(`/api/loyalty/wallet/history/${customerId}`);
export const createCoupon = (data) => axiosWrapper.post("/api/loyalty/coupons", data);
export const getCoupons = (restaurantId) => axiosWrapper.get(`/api/loyalty/coupons/${restaurantId}`);
export const validateCoupon = (code) => axiosWrapper.get(`/api/loyalty/coupons/validate/${code}`);
export const createGiftCard = (data) => axiosWrapper.post("/api/loyalty/gift-cards", data);
export const getGiftCards = (restaurantId) => axiosWrapper.get(`/api/loyalty/gift-cards/${restaurantId}`);

// Billing
export const subscribe = (data) => axiosWrapper.post("/api/billing/subscribe", data);
export const getSubscription = (restaurantId) => axiosWrapper.get(`/api/billing/${restaurantId}`);
export const cancelSubscription = (subId) => axiosWrapper.post(`/api/billing/${subId}/cancel`);
export const changePlan = (subId, data) => axiosWrapper.patch(`/api/billing/${subId}/change-plan`, data);
export const generateInvoice = (data) => axiosWrapper.post("/api/billing/invoices/generate", data);
export const recordPayment = (data) => axiosWrapper.post("/api/billing/payments", data);

// QR Ordering
export const generateTableQR = (tableId) => axiosWrapper.post(`/api/qr/tables/${tableId}/generate`);
export const getTableByQR = (token) => axiosWrapper.get(`/api/qr/table/${token}`);
export const placeQROrder = (data) => axiosWrapper.post("/api/qr/order", data);
export const callWaiter = (token) => axiosWrapper.post(`/api/qr/waiter-call/${token}`);
export const requestBill = (token) => axiosWrapper.post(`/api/qr/pay-request/${token}`);
export const dismissWaiterCall = (tableId) => axiosWrapper.post(`/api/qr/waiter-call/${tableId}/dismiss`);

// Analytics
export const getSalesAnalytics = (restaurantId, params) => axiosWrapper.get(`/api/analytics/sales/${restaurantId}`, { params });
export const getRealtimeMetrics = (restaurantId) => axiosWrapper.get(`/api/analytics/realtime/${restaurantId}`);
export const getKitchenAnalytics = (restaurantId) => axiosWrapper.get(`/api/analytics/kitchen/${restaurantId}`);
export const getCustomerAnalytics = (restaurantId) => axiosWrapper.get(`/api/analytics/customers/${restaurantId}`);
export const getProfitabilityReport = (restaurantId) => axiosWrapper.get(`/api/analytics/profitability/${restaurantId}`);

// Notifications
export const getInAppNotifications = (params) => axiosWrapper.get("/api/notification/in-app", { params });
export const createNotification = (data) => axiosWrapper.post("/api/notification/", data);
export const markNotificationRead = (id) => axiosWrapper.patch(`/api/notification/${id}/read`);
export const markAllNotificationsRead = () => axiosWrapper.patch("/api/notification/read-all");
export const deleteNotification = (id) => axiosWrapper.delete(`/api/notification/${id}`);

// Offline Sync
export const syncOfflineOrders = (data) => axiosWrapper.post("/api/offline/orders/sync", data);
export const getPendingSyncOrders = () => axiosWrapper.get("/api/offline/orders/pending");
export const resolveOrderConflict = (data) => axiosWrapper.post("/api/offline/orders/conflict", data);

// Plugins
export const getPluginCatalog = () => axiosWrapper.get("/api/plugin/catalog");
export const connectPlugin = (data) => axiosWrapper.post("/api/plugin/connect", data);
export const getPlugins = (restaurantId) => axiosWrapper.get(`/api/plugin/${restaurantId}`);
export const updatePlugin = (pluginId, data) => axiosWrapper.patch(`/api/plugin/${pluginId}`, data);
export const disconnectPlugin = (pluginId) => axiosWrapper.post(`/api/plugin/${pluginId}/disconnect`);
export const syncPlugin = (pluginId) => axiosWrapper.post(`/api/plugin/${pluginId}/sync`);