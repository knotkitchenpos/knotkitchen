import { axiosWrapper } from "./axiosWrapper";

// API Endpoints

// Auth Endpoints
export const login = (data) => axiosWrapper.post("/api/user/login", data);
export const register = (data) => axiosWrapper.post("/api/user/register", data);
export const getUserData = () => axiosWrapper.get("/api/user");
export const logout = () => axiosWrapper.post("/api/user/logout");
export const changePassword = (data) => axiosWrapper.post("/api/user/change-password", data);

// Store Auth Endpoints — password-based, 2026-08-31 migration off Fast2SMS.
// The old sendStoreOtp/verifyStoreOtp/completeStoreSignup/sendLoginOtp
// endpoints were removed together with the entire phone+OTP flow.
export const validateStoreId = (data) => axiosWrapper.post("/api/user/store/validate-id", data);
export const validateStoreOwner = (data) => axiosWrapper.post("/api/user/store/validate-owner", data);
export const checkStoreStatus = (data) => axiosWrapper.post("/api/user/store/status", data);
export const setupStorePassword = (data) => axiosWrapper.post("/api/user/store/setup-password", data);
export const storeLogin = (data) => axiosWrapper.post("/api/user/store/login", data);

// Staff first sign-in: does this phone already have a password on this store,
// and the one-shot endpoint that creates it if not.
export const checkStoreAccountStatus = (data) =>
  axiosWrapper.post("/api/user/store/account-status", data);
export const setStoreAccountPassword = (data) =>
  axiosWrapper.post("/api/user/store/set-password", data);
export const impersonateWithSupportToken = (token) =>
  axiosWrapper.post("/api/user/impersonate", { token });

// Table Endpoints
export const addTable = (data) => axiosWrapper.post("/api/table/", data);
export const getTables = () => axiosWrapper.get("/api/table");
export const updateTable = ({ tableId, ...tableData }) =>
  axiosWrapper.put(`/api/table/${tableId}`, tableData);
export const deleteTable = (tableId) =>
  axiosWrapper.delete(`/api/table/${tableId}`);
export const regenerateQr = (tableId) =>
  axiosWrapper.put(`/api/table/${tableId}/qr/regenerate`);

// Payment Endpoints

// Order Endpoints
export const addOrder = (data) => axiosWrapper.post("/api/order/", data);
// Module 4 §6 — Orders list accepts an optional filter object.
// The backend defaults to today when no date/from/to is provided so calling
// getOrders() with no args still returns "today only", matching the
// spec-mandated default.
//
//   getOrders()                                → today's orders
//   getOrders({ date: "2026-08-19" })          → single-day filter
//   getOrders({ from: "2026-08-01", to: … })   → inclusive date range
export const getOrders = (params) =>
  axiosWrapper.get("/api/order", params ? { params } : undefined);
export const updateOrderStatus = ({ orderId, orderStatus }) =>
  axiosWrapper.put(`/api/order/${orderId}`, { orderStatus });
/**
 * Module 4 §2 — dedicated "Mark Ready" action.
 *
 * Kept separate from updateOrderStatus so the intent is explicit at the
 * call-site (the button semantically means "customer's order is ready to
 * collect") and so the backend can fire the customer notification without
 * having to sniff the payload of a generic status change.
 */
export const markOrderReady = (orderId) =>
  axiosWrapper.put(`/api/order/${orderId}/ready`);

// Store-specific popular products (POS redesign). Backend computes this from
// real order history and falls back to the store's own featured/default
// products when the store doesn't have enough order history yet.
export const getPopularItems = (params = {}) =>
  axiosWrapper.get("/api/order/popular-items", { params });

/**
 * Module 5 — Reports payload.
 *
 * The backend returns a fully-computed summary object (with mutually-
 * exclusive Source / Type / Payment buckets so nothing double-counts) plus
 * the raw orders for the selected window. Passing no params defaults to
 * TODAY on the server, matching Module 5 §4.
 *
 *   getOrdersReport()                              → today's report
 *   getOrdersReport({ date: "2026-08-19" })        → single day
 *   getOrdersReport({ from: "…", to: "…" })        → inclusive range
 */
export const getOrdersReport = (params) =>
  axiosWrapper.get("/api/order/report", params ? { params } : undefined);



// Table Session Endpoints (EPOS table ordering)
export const createTableSession = (data) =>
  axiosWrapper.post("/api/table-session/", data);
export const getTableSessions = () => axiosWrapper.get("/api/table-session");
export const getTableSessionById = (id) =>
  axiosWrapper.get(`/api/table-session/${id}`);
export const addItemsToTableSession = ({ sessionId, ...data }) =>
  axiosWrapper.post(`/api/table-session/${sessionId}/items`, data);
export const getTableById = (tableId) => axiosWrapper.get(`/api/table/${tableId}`);

// Secure QR entity endpoints — return the 64-hex token stored in the
// TableQR collection (the ONLY tokens `resolveTableScope` accepts).
// The legacy Table.qrToken (32-hex from crypto.randomBytes(16)) is not
// valid for scanning; opening the QR modal should always fetch/mint a
// modern secure token via this endpoint.
// Manage Table settings. Separate from Store Properties, which is PIN-gated:
// how long a table rests after payment is an everyday floor setting.
export const getTableSettings = () => axiosWrapper.get("/api/table/settings");
export const updateTableSettings = (data) => axiosWrapper.put("/api/table/settings", data);

export const getOrCreateTableQr = (tableId) =>
  axiosWrapper.get(`/api/table-qr/table/${tableId}`);
export const regenerateTableQr = (tableId) =>
  axiosWrapper.post(`/api/table-qr/table/${tableId}/regenerate`);

export const requestBillForSession = (sessionId) =>
  axiosWrapper.post(`/api/table-session/${sessionId}/request-bill`);
// Settle a table session at the counter. There was no wrapper for this at
// all, which is why the POS had no way to complete a table order: the
// session never reached PAID/CLOSED, so the table never entered its
// cooldown and the QR kept serving the previous customer their old order.
export const recordTableSessionPayment = (sessionId, data) =>
  axiosWrapper.post(`/api/table-session/${sessionId}/payment`, data);

export const closeTableSessionWithoutPayment = (sessionId, data) =>
  axiosWrapper.post(`/api/table-session/${sessionId}/close`, data);

// Pull one dish off a live table order — the kitchen ran out, or it went
// back. The diner's QR page reads the same session, so they see it too.
export const cancelTableSessionItem = (sessionId, itemId, data) =>
  axiosWrapper.post(`/api/table-session/${sessionId}/items/${itemId}/cancel`, data);

// Menu Endpoints
export const getMenus = (params) => axiosWrapper.get("/api/menu", params ? { params } : undefined);

export const addCategory = (data) => axiosWrapper.post("/api/menu/category", data);
export const updateCategory = (data) => axiosWrapper.put("/api/menu/category", data);
export const addSubcategory = (data) => axiosWrapper.post("/api/menu/subcategory", data);
export const updateSubcategory = (data) => axiosWrapper.put("/api/menu/subcategory", data);
export const deleteCategory = (menuId) => axiosWrapper.delete(`/api/menu/${menuId}`);
export const addDish = (data) => axiosWrapper.post("/api/menu/dish", data);
export const updateDish = ({ menuId, itemId, ...data }) =>
  axiosWrapper.put(`/api/menu/${menuId}/dish/${itemId}`, data);
/**
 * Bulk delete in ONE request. Looping deleteDish over a selection made every
 * call load and save the same Menu document, so all but the first failed
 * Mongoose's version check and returned 500.
 */
export const deleteDishes = ({ menuId, itemIds }) =>
  axiosWrapper.delete(`/api/menu/${menuId}/dishes`, { data: { itemIds } });

export const deleteDish = ({ menuId, itemId }) =>
  axiosWrapper.delete(`/api/menu/${menuId}/dish/${itemId}`);
export const updateDishStatus = ({ menuId, itemId }) =>
  axiosWrapper.put(`/api/menu/${menuId}/dish/${itemId}/availability`);
// Assign / clear a subcategory on a dish (POS redesign - optional grouping)
export const updateDishSubcategory = ({ menuId, itemId, subcategory }) =>
  axiosWrapper.put(`/api/menu/${menuId}/dish/${itemId}/subcategory`, { subcategory });
export const reorderDishes = ({ menuId, itemIds }) =>
  axiosWrapper.put(`/api/menu/${menuId}/reorder`, { itemIds });
// Drag-and-drop reorder for the top-level category rows in Manage Menu.
export const reorderMenus = ({ menuIds }) =>
  axiosWrapper.put(`/api/menu/reorder-categories`, { menuIds });


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
export const saveGroupToDishes = (data) =>
  axiosWrapper.post("/api/menu/group", data);
export const deleteGroupFromDishes = (data) =>
  axiosWrapper.post("/api/menu/group/delete", data);
export const renameGroupInDishes = (data) =>
  axiosWrapper.put("/api/menu/group/rename", data);
export const toggleGroupActive = (data) =>
  axiosWrapper.post("/api/menu/group/toggle-active", data);
export const reorderGroups = (data) =>
  axiosWrapper.put("/api/menu/group/reorder", data);
export const bulkAddGroup = (data) =>
  axiosWrapper.post("/api/menu/group/bulk-add", data);
export const bulkRemoveGroup = (data) =>
  axiosWrapper.post("/api/menu/group/bulk-remove", data);
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

/**
 * Module 6 §4 — Manage Cache.
 *
 * Bulk-publish every menu in this tenant to the requested target so the
 * new prices / items appear in the POS ("system") or the customer
 * website. Backend increments each menu's version and stamps
 * lastPublishedToSystemAt / lastPublishedToWebsiteAt.
 */
export const publishSystemCache = () =>
  axiosWrapper.post("/api/menu/publish/system");
export const publishWebsiteCache = () =>
  axiosWrapper.post("/api/menu/publish/website");

// Module 7 — Store Properties, Protection PIN, POS Settings & Staff
export const getStoreProperties = () => axiosWrapper.get("/api/restaurant/properties");
export const updateStoreProperties = (data) => axiosWrapper.put("/api/restaurant/properties", data);
export const verifyPin = (pin) => axiosWrapper.post("/api/restaurant/verify-pin", { pin });
export const changePin = (data) => axiosWrapper.put("/api/restaurant/change-pin", data);
export const updatePosSettings = (data) => axiosWrapper.put("/api/restaurant/pos-settings", data);
export const updateOrderToggles = (data) => axiosWrapper.put("/api/restaurant/order-toggles", data);
export const updateChannelTimings = (data) => axiosWrapper.put("/api/restaurant/timings", data);
export const updateHolidays = (data) => axiosWrapper.put("/api/restaurant/holidays", data);
export const toggleClosedForToday = (data) => axiosWrapper.put("/api/restaurant/closed-for-today", data);

export const addStaffMember = (data) => axiosWrapper.post("/api/restaurant/staff", data);
export const getStaffMembers = () => axiosWrapper.get("/api/restaurant/staff");
export const deleteStaffMember = (staffId) => axiosWrapper.delete(`/api/restaurant/staff/${staffId}`);
export const getActivityLogs = (params) => axiosWrapper.get("/api/restaurant/activity-logs", params ? { params } : undefined);



// Structured Text (Notepad) Menu Import Endpoints
export const getMenuImportFormat = () => axiosWrapper.get("/api/menu/import/format");
export const previewMenuImport = (text) => axiosWrapper.post("/api/menu/import/preview", { text });
export const importMenuText = ({ text, mode }) =>
  axiosWrapper.post("/api/menu/import", { text, mode });

// CSV Import / Export (Module 5)
export const downloadMenuCsvTemplate = () => axiosWrapper.get("/api/menu/csv/template", { responseType: "blob" });
export const exportMenuCsv = () => axiosWrapper.get("/api/menu/csv/export", { responseType: "blob" });
export const previewMenuCsv = (csvText) => axiosWrapper.post("/api/menu/csv/preview", { csvText });
export const importMenuCsv = (csvText) => axiosWrapper.post("/api/menu/csv/import", { csvText });

// Media Upload (Module 7)
export const uploadMediaAsset = (formData) =>
  axiosWrapper.post("/api/media", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });

// Payment Link Endpoints (POS "Pay via Link" flow — Module 2 §5)
// The backend controller (paymentLinkController.createPaymentLink) generates
// a secure hex token, opens a gateway order, records a
// Bill + PaymentLink and — critically — leaves the underlying Order in
// "Pending" until the customer actually pays via /pay/:token. We NEVER mark
// the order as paid at creation time.
export const createPaymentLink = (data) => axiosWrapper.post("/api/payment-link", data);

// Receipt & E-Bill endpoints (Module 3 §5, §7)
// The backend (receiptController) builds a structured receipt from the
// order + bill + restaurant, and the E-Bill endpoint delivers it via the
// tenant's configured SMS provider. The frontend E-Bill button is only
// enabled when a customer phone exists — but this endpoint also refuses
// to send if the phone is missing (defence in depth).
export const getReceiptForOrder = (orderId) =>
  axiosWrapper.get(`/api/receipts/order/${orderId}`);
export const sendEBill = (data) => axiosWrapper.post("/api/receipts/send-ebill", data);





/**
 * KnotKitchen Business Balance and subscription.
 *
 * Money crosses this boundary in RUPEES. The server converts to paise and is
 * the only converter — arithmetic on money here would be a second place for a
 * hundredfold error to appear.
 */
export const getBusinessBalance = () => axiosWrapper.get("/api/business-balance");
export const getBalanceTransactions = (params) =>
  axiosWrapper.get("/api/business-balance/transactions", { params });
export const createRecharge = (data) => axiosWrapper.post("/api/business-balance/recharge", data);
export const verifyRecharge = (data) =>
  axiosWrapper.post("/api/business-balance/recharge/verify", data);

export const getSubscriptionStatus = () => axiosWrapper.get("/api/subscription");
export const getSubscriptionPlans = () => axiosWrapper.get("/api/subscription/plans");
export const getSubscriptionQuote = (planCode) =>
  axiosWrapper.get(`/api/subscription/quote/${planCode}`);
export const purchasePlan = (data) => axiosWrapper.post("/api/subscription/purchase", data);
export const getPlatformInvoices = () => axiosWrapper.get("/api/subscription/invoices");
