import { axiosWrapper } from "./axiosWrapper";

// Auth Endpoints
export const getUserData = () => axiosWrapper.get("/api/user");
export const logout = () => axiosWrapper.post("/api/user/logout");

// Store Auth Endpoints — password-based, 2026-08-31 migration off Fast2SMS.
// The old sendStoreOtp/verifyStoreOtp/completeStoreSignup/sendLoginOtp
// endpoints were removed together with the entire phone+OTP flow.
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

// Table bookings from the restaurant website
export const getTableBookings = () => axiosWrapper.get("/api/table-bookings");
export const getBookingTables = (bookingId) => axiosWrapper.get(`/api/table-bookings/${bookingId}/tables`);
export const acceptTableBooking = (bookingId, tableId) =>
  axiosWrapper.post(`/api/table-bookings/${bookingId}/accept`, { tableId });
export const cancelTableBooking = (bookingId) => axiosWrapper.post(`/api/table-bookings/${bookingId}/cancel`);
export const seatTableBooking = (bookingId) => axiosWrapper.post(`/api/table-bookings/${bookingId}/seat`);
export const updateTable = ({ tableId, ...tableData }) =>
  axiosWrapper.put(`/api/table/${tableId}`, tableData);
export const deleteTable = (tableId) =>
  axiosWrapper.delete(`/api/table/${tableId}`);

// Order Endpoints
export const addOrder = (data) => axiosWrapper.post("/api/order/", data);
export const getOrderById = (id) => axiosWrapper.get(`/api/order/${id}`);
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
/* ---------- Offline ---------- */
export const syncOfflineOrders = (orders) => axiosWrapper.post("/api/offline/orders/sync", { orders });

/* ---------- Inventory ---------- */
export const getIngredients = () => axiosWrapper.get("/api/inventory/ingredients");
export const createIngredient = (d) => axiosWrapper.post("/api/inventory/ingredients", d);
export const updateIngredient = (id, d) => axiosWrapper.put(`/api/inventory/ingredients/${id}`, d);
export const deleteIngredient = (id) => axiosWrapper.delete(`/api/inventory/ingredients/${id}`);
export const recordStockMovement = (d) => axiosWrapper.post("/api/inventory/movements", d);
export const getStockMovements = (params) => axiosWrapper.get("/api/inventory/movements", { params });
export const getRecipes = () => axiosWrapper.get("/api/inventory/recipes");
export const upsertRecipe = (menuItemId, d) => axiosWrapper.put(`/api/inventory/recipes/${menuItemId}`, d);
export const deleteRecipe = (menuItemId) => axiosWrapper.delete(`/api/inventory/recipes/${menuItemId}`);

/* ---------- Shifts & day-end ---------- */
export const getCurrentShift = () => axiosWrapper.get("/api/shift/current");
export const getShifts = (limit = 30) => axiosWrapper.get("/api/shift", { params: { limit } });
export const openShift = ({ openingCash }) => axiosWrapper.post("/api/shift/open", { openingCash });
export const closeShift = ({ closingCash, note }) => axiosWrapper.post("/api/shift/close", { closingCash, note });

/** Void an order with a reason on record. Staff need the Security PIN. */
export const cancelOrder = ({ orderId, reason }) => axiosWrapper.put(`/api/order/${orderId}/cancel`, { reason });
/**
 * Refund a CANCELLED order that was paid through Cashfree. The backend works
 * out the amount from the payment record and talks to Cashfree; the till
 * sends only why.
 */
// The amount is optional: left out, everything left is refunded. The backend caps it.
export const refundOrder = ({ orderId, amount }) => axiosWrapper.post(`/api/order/${orderId}/refund`, { amount });
/** Ask Cashfree where a pending (or unconfirmed) refund stands. */
export const syncRefund = (orderId) => axiosWrapper.post(`/api/order/${orderId}/refund/sync`);

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
/** The party moves to a free table; their order and bill follow. */
export const moveTableSession = (sessionId, tableId) => axiosWrapper.post(`/api/table-session/${sessionId}/move`, { tableId });
/** Another table's tab joins this one; one bill at the end. */
export const mergeTableSessions = (sessionId, fromSessionId) =>
  axiosWrapper.post(`/api/table-session/${sessionId}/merge`, { fromSessionId });
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

export const getOrCreateTableQr = (tableId) =>
  axiosWrapper.get(`/api/table-qr/table/${tableId}`);
export const regenerateTableQr = (tableId) =>
  axiosWrapper.post(`/api/table-qr/table/${tableId}/regenerate`);

// Settle a table session at the counter. There was no wrapper for this at
// all, which is why the POS had no way to complete a table order: the
// session never reached PAID/CLOSED, so the table never entered its
// cooldown and the QR kept serving the previous customer their old order.
export const recordTableSessionPayment = (sessionId, data) =>
  axiosWrapper.post(`/api/table-session/${sessionId}/payment`, data);

// Put a stranded table back into service. Every automatic path already frees
// a table when its order is cancelled or settled, but a table left occupied
// by an order that predates those paths had nothing that could clear it:
// "Complete Order & Take Payment" is disabled at a zero total, and there was
// no other control anywhere. Refused while a live order is still on the table.
export const releaseTable = (tableId) =>
  axiosWrapper.put(`/api/table/${tableId}/release`);

// Pull one dish off a live table order — the kitchen ran out, or it went
// back. The diner's QR page reads the same session, so they see it too.
export const cancelTableSessionItem = (sessionId, itemId, data) =>
  axiosWrapper.post(`/api/table-session/${sessionId}/items/${itemId}/cancel`, data);

// Take the service charge off a table's bill (waived: true) or put it back.
export const setTableServiceCharge = (sessionId, waived) =>
  axiosWrapper.post(`/api/table-session/${sessionId}/service-charge`, { waived });

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
export const reorderDishes = ({ menuId, itemIds }) =>
  axiosWrapper.put(`/api/menu/${menuId}/reorder`, { itemIds });
// Drag-and-drop reorder for the top-level category rows in Manage Menu.
export const reorderMenus = ({ menuIds }) =>
  axiosWrapper.put(`/api/menu/reorder-categories`, { menuIds });

// Modifier Group Endpoints
export const saveGroupToDishes = (data) =>
  axiosWrapper.post("/api/menu/group", data);
export const deleteGroupFromDishes = (data) =>
  axiosWrapper.post("/api/menu/group/delete", data);
export const toggleGroupActive = (data) =>
  axiosWrapper.post("/api/menu/group/toggle-active", data);
export const reorderGroups = (data) =>
  axiosWrapper.put("/api/menu/group/reorder", data);
export const bulkAddGroup = (data) =>
  axiosWrapper.post("/api/menu/group/bulk-add", data);
export const bulkRemoveGroup = (data) =>
  axiosWrapper.post("/api/menu/group/bulk-remove", data);

// Menu Versioning & Publishing Endpoints
export const publishMenu = (menuId) => axiosWrapper.put(`/api/menu/${menuId}/publish`);
export const unpublishMenu = (menuId) => axiosWrapper.put(`/api/menu/${menuId}/unpublish`);

/**
 * Module 6 §4 — Manage Cache.
 *
 * Bulk-publish every menu in this tenant to the tills, so new prices and
 * items reach the POS. There is no website equivalent: the customer site
 * reads the live menu (see services/menuCache.js).
 */
export const publishSystemCache = () =>
  axiosWrapper.post("/api/menu/publish/system");

/** The same for the customer website: its menu, and the Manage Website draft. */
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
export const updateStaffRole = (staffId, role) => axiosWrapper.put(`/api/restaurant/staff/${staffId}`, { role });

// CSV Import / Export (Module 5)
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

// Receipt & E-Bill endpoints (Module 3 §5, §7)
// The backend (receiptController) builds a structured receipt from the
// order + bill + restaurant, and the E-Bill endpoint delivers it via the
// tenant's configured SMS provider. The frontend E-Bill button is only
// enabled when a customer phone exists — but this endpoint also refuses
// to send if the phone is missing (defence in depth).
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

// The POS plan, add-ons, tablets and printers, all paid from the wallet.
// Purchases need { accepted: true } (the order summary was accepted); a Staff
// member is asked for the PIN by the global popup (utils/pinPrompt).
export const getSubscriptionStatus = () => axiosWrapper.get("/api/subscription");
// What buying `item` charges now: "ADDON:<code>", "TABLET" or "PRINTER:<code>".
export const getSubscriptionQuote = (item) => axiosWrapper.get("/api/subscription/quote", { params: { item } });
export const addSubscriptionAddon = (data) => axiosWrapper.post("/api/subscription/addons", data);
// Stops at renewal; it keeps working until then.
export const stopSubscriptionAddon = (code) =>
  axiosWrapper.delete(`/api/subscription/addons/${encodeURIComponent(code)}`);
export const rentSubscriptionTablet = (data) => axiosWrapper.post("/api/subscription/tablets", data);
export const buySubscriptionPrinter = (data) => axiosWrapper.post("/api/subscription/printers", data);
// Printers and tablets on their way: KnotKitchen delivers what was paid for.
export const getHardwareRequests = () => axiosWrapper.get("/api/subscription/hardware-requests");
// Only while KnotKitchen has not started on it; the money goes back to the wallet.
export const cancelHardwareRequest = (id) => axiosWrapper.post(`/api/subscription/hardware-requests/${encodeURIComponent(id)}/cancel`);
export const renewSubscription = () => axiosWrapper.post("/api/subscription/renew");
export const getPlatformInvoices = () => axiosWrapper.get("/api/subscription/invoices");

/* ---------- Restaurant, KDS, waiter calls ---------- */
export const getMyRestaurant = () => axiosWrapper.get("/api/restaurant/me");
export const getKDSOrders = (params) => axiosWrapper.get("/api/kds/", { params });
export const updateKDSItemStatus = (kdsOrderId, itemId, data) => axiosWrapper.patch(`/api/kds/${kdsOrderId}/items/${itemId}`, data);
export const updateKDSOrderStatus = (kdsOrderId, data) => axiosWrapper.patch(`/api/kds/${kdsOrderId}/status`, data);
export const dismissWaiterCall = (tableId) => axiosWrapper.post(`/api/qr/waiter-call/${tableId}/dismiss`);
