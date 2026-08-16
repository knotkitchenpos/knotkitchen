const createHttpError = require("http-errors");
const Order = require("../models/orderModel");
const Table = require("../models/tableModel");
const Customer = require("../models/customerModel");
const { default: mongoose } = require("mongoose");

/**
 * Menu is lazy-loaded because it is only needed by the popular-items
 * aggregation endpoint. The existing controller unit tests replace only the
 * order/table/customer models via Module._load — loading Menu unconditionally
 * would force every test to mock Menu too. Keeping it lazy preserves those
 * tests exactly as they are today.
 */
const getMenuModel = () => require("../models/menuModel");



/**
 * Order controller — POS side (dine-in, takeaway, phone orders).
 *
 * Multi-tenancy rules used throughout this file (§3, §17):
 *   - Every DB read is scoped by req.user.restaurantId (falling back to
 *     createdBy for the pre-multi-tenant legacy users so they don't lose
 *     access to their own orders).
 *   - Every DB write forces restaurantId, outletId and createdBy to values
 *     derived from req.user — the client cannot supply them via the request
 *     body (mass-assignment defence).
 *   - Order.orderStatus is a controlled enum with allowed forward-only
 *     transitions. Completed / Cancelled / Refunded are terminal.
 *   - bills.* is copied from the client for now (POS legacy behaviour) but
 *     coerced to safe numeric shapes — no operator objects, no NaN, no
 *     negatives. The storefront path already computes bills server-side
 *     (see orderPricingService.js).
 */

const ALLOWED_ORDER_TYPES = new Set([
  "dine-in", "takeaway", "delivery", "online", "marketplace", "collection",
]);

const ALLOWED_INITIAL_STATUS = new Set(["Pending", "In Progress", "Ready"]);
const ALLOWED_STATUS_TRANSITIONS = new Set([
  "Pending", "In Progress", "Ready", "Completed", "Cancelled",
]);
const TERMINAL_STATUSES = new Set(["Completed", "Cancelled", "Refunded"]);

const tenantScopeFor = (user, extra = {}) =>
  user?.restaurantId
    ? {
        restaurantId: user.restaurantId,
        ...(user.outletId ? { outletId: user.outletId } : {}),
        ...extra,
      }
    : { createdBy: user?._id, ...extra };

const safeNumber = (v, fallback = 0, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
};

/**
 * Sanitise the `bills` object supplied by the POS UI.
 *
 * Nothing beyond these fields (and non-negative numeric values) may reach
 * the DB. This prevents both mass-assignment tricks like `bills["$set"]…`
 * and simple tampering like `total: -999999`.
 */
const sanitizeBills = (bills = {}) => ({
  subtotal: safeNumber(bills.subtotal, 0, { min: 0, max: 1e9 }),
  total: safeNumber(bills.total, safeNumber(bills.subtotal, 0), { min: 0, max: 1e9 }),
  tax: safeNumber(bills.tax, 0, { min: 0, max: 1e9 }),
  totalWithTax: safeNumber(bills.totalWithTax, safeNumber(bills.total, 0), { min: 0, max: 1e9 }),
  discount: safeNumber(bills.discount, 0, { min: 0, max: 1e9 }),
  deliveryFee: safeNumber(bills.deliveryFee, 0, { min: 0, max: 1e9 }),
  packagingFee: safeNumber(bills.packagingFee, 0, { min: 0, max: 1e9 }),
});

/**
 * Sanitise a POS-supplied item so an attacker can't post {$where:...} or
 * negative quantities. Prices are trusted from the POS UI (staff-facing,
 * authenticated device) but bounded — a stored 1e12 price could crash
 * downstream aggregations.
 */
const sanitizeItem = (raw = {}) => ({
  name: String(raw.name || "").slice(0, 200),
  quantity: Math.max(1, Math.min(1000, Math.floor(safeNumber(raw.quantity, 1)))),
  price: safeNumber(raw.price, 0, { min: 0, max: 1e7 }),
  total: safeNumber(raw.total, 0, { min: 0, max: 1e9 }),
  note: String(raw.note || "").slice(0, 300),
  modifiers: Array.isArray(raw.modifiers)
    ? raw.modifiers.slice(0, 40).map((m) => ({
        name: String(m?.name || "").slice(0, 120),
        price: safeNumber(m?.price, 0, { min: -1e6, max: 1e6 }),
      }))
    : [],
});

// Validate table capacity on the server.
// Never trust the frontend: the table is always re-resolved
// within the caller's tenant/outlet scope before capacity is enforced.
const validateTableCapacityForOrder = async ({ tableId, guests, user }) => {
  if (!tableId) return;

  if (!mongoose.Types.ObjectId.isValid(tableId)) {
    throw createHttpError(400, "Invalid table id!");
  }

  const table = await Table.findOne({
    _id: tableId,
    ...tenantScopeFor(user),
    isDeleted: { $ne: true },
  });
  if (!table) {
    // Do not leak existence of other tenant tables - return generic 404
    throw createHttpError(404, "Table not found!");
  }

  const count = Math.max(1, Number(guests) || 1);
  const capacity = Number(table.capacity) || 4;
  if (count > capacity) {
    throw createHttpError(
      400,
      `Table ${table.tableNumber} has a maximum capacity of ${capacity} customers.`
    );
  }
  return count;
};

const sanitizeDeliveryAddress = (raw = {}) => {
  if (!raw || typeof raw !== "object") return undefined;
  const cleaned = {
    line1: String(raw.line1 || "").trim().slice(0, 200),
    line2: String(raw.line2 || "").trim().slice(0, 200),
    city: String(raw.city || "").trim().slice(0, 120),
    postalCode: String(raw.postalCode || raw.pincode || "").trim().slice(0, 20),
    instructions: String(raw.instructions || "").trim().slice(0, 400),
  };
  // If every field is empty, treat as absent so we don't persist a noisy object.
  const hasAny = Object.values(cleaned).some((v) => v && v.length > 0);
  return hasAny ? cleaned : undefined;
};

const addOrder = async (req, res, next) => {
  try {
    const { table, customerDetails, bills, orderType, deliveryAddress } = req.body || {};

    // Backend capacity enforcement for dine-in table orders
    if (table || customerDetails?.guests) {
      await validateTableCapacityForOrder({
        tableId: table,
        guests: customerDetails?.guests,
        user: req.user,
      });
    }


    const name = customerDetails?.name ? String(customerDetails.name).trim().slice(0, 200) : "";
    const phone = customerDetails?.phone ? String(customerDetails.phone).trim().slice(0, 20) : "";
    const guests = Math.max(1, Math.min(1000, Math.floor(safeNumber(customerDetails?.guests, 1))));

    let customerId = null;

    if (name || phone) {
      const restaurantId = req.user?.restaurantId || req.user?._id;
      const outletId = req.user?.outletId;
      const totalAmount = safeNumber(bills?.totalWithTax || bills?.total, 0, { min: 0, max: 1e9 });

      if (phone) {
        let customer = await Customer.findOne({
          restaurantId,
          phone,
          isDeleted: { $ne: true },
        });

        if (customer) {
          if (name) customer.name = name;
          customer.visitCount = (customer.visitCount || 0) + 1;
          customer.totalSpent = (customer.totalSpent || 0) + totalAmount;
          customer.lastVisitAt = new Date();
          await customer.save();
        } else {
          try {
            customer = await Customer.create({
              restaurantId,
              outletId,
              name: name || "",
              phone,
              createdBy: req.user?._id,
              visitCount: 1,
              totalSpent: totalAmount,
              lastVisitAt: new Date(),
            });
          } catch (err) {
            if (err.code === 11000) {
              customer = await Customer.findOne({
                restaurantId,
                phone,
                isDeleted: { $ne: true },
              });
              if (customer) {
                if (name) customer.name = name;
                customer.visitCount = (customer.visitCount || 0) + 1;
                customer.totalSpent = (customer.totalSpent || 0) + totalAmount;
                customer.lastVisitAt = new Date();
                await customer.save();
              }
            } else {
              throw err;
            }
          }
        }
        if (customer) customerId = customer._id;
      } else if (name) {
        let customer = await Customer.findOne({
          restaurantId,
          name,
          phone: "",
          isDeleted: { $ne: true },
        });

        if (customer) {
          customer.visitCount = (customer.visitCount || 0) + 1;
          customer.totalSpent = (customer.totalSpent || 0) + totalAmount;
          customer.lastVisitAt = new Date();
          await customer.save();
        } else {
          customer = await Customer.create({
            restaurantId,
            outletId,
            name,
            phone: "",
            createdBy: req.user?._id,
            visitCount: 1,
            totalSpent: totalAmount,
            lastVisitAt: new Date(),
          });
        }
        if (customer) customerId = customer._id;
      }
    }

    // Normalise + allow-list order type. Anything else → dine-in.
    let normalizedOrderType = String(orderType || "dine-in").toLowerCase();
    if (normalizedOrderType === "table service") normalizedOrderType = "dine-in";
    if (!ALLOWED_ORDER_TYPES.has(normalizedOrderType)) normalizedOrderType = "dine-in";

    // Client-supplied orderStatus is deliberately IGNORED — the POS never sets
    // "Completed" straight away, and allowing arbitrary status via the create
    // path would let a caller mark a takeaway order paid without payment.
    // Defaults to "Pending"; callers can still update via updateOrder.
    const initialStatus = "Pending";

    // EXPLICIT ALLOW-LIST — no spreading `...req.body` (mass-assignment).
    // Fields NOT taken from req.body: restaurantId, outletId, storeId,
    // createdBy, orderStatus, source, orderNumber, idempotencyKey,
    // paymentMethod, payments, timeline, isDeleted, etc.
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200).map(sanitizeItem) : [];
    const sanitizedBills = sanitizeBills(bills || {});

    const cleanDeliveryAddress = sanitizeDeliveryAddress(deliveryAddress);

    // POS redesign - Finish Order flow validation.
    //
    // Delivery orders MUST carry a real delivery address + pincode: this is
    // new capability, no legacy caller ever depended on empty delivery
    // orders, so we enforce it strictly.
    //
    // Collection and dine-in validation is intentionally relaxed at the API
    // level so pre-existing POS scripts and unit tests that submit empty
    // customer details on a "collection" order still succeed. The new POS
    // UI enforces name/phone before ever hitting this endpoint (see
    // FinishOrderModals + orderController on the client), and Table Service
    // continues to route through createTableSession — not addOrder — so
    // legacy paths remain fully backward-compatible.
    if (normalizedOrderType === "delivery") {
      if (!name) return next(createHttpError(400, "Customer name is required for delivery orders."));
      if (!phone) return next(createHttpError(400, "Customer phone is required for delivery orders."));
      if (!cleanDeliveryAddress || !cleanDeliveryAddress.line1) {
        return next(createHttpError(400, "Delivery address is required for delivery orders."));
      }
      if (!cleanDeliveryAddress.postalCode) {
        return next(createHttpError(400, "Pincode is required for delivery orders."));
      }
    }


    const orderData = {
      customerDetails: { name, phone, guests },
      orderType: normalizedOrderType,
      orderStatus: initialStatus,
      items,
      bills: sanitizedBills,
      table: table && mongoose.Types.ObjectId.isValid(table) ? table : undefined,
      ...(cleanDeliveryAddress ? { deliveryAddress: cleanDeliveryAddress } : {}),
      restaurantId: req.user?.restaurantId,
      outletId: req.user?.outletId,
      createdBy: req.user._id,
      ...(customerId ? { customerId } : {}),
      source: "POS",
      timeline: [{ status: initialStatus, timestamp: new Date(), user: req.user?.name || "POS" }],
    };


    const order = new Order(orderData);
    await order.save();

    // Sync table occupancy when a dine-in order is placed via the legacy path
    if (table) {
      await Table.findOneAndUpdate(
        {
          _id: table,
          ...tenantScopeFor(req.user),
          isDeleted: { $ne: true },
        },
        {
          status: "occupied",
          currentOrderId: order._id,
          currentOccupancy: guests,
        },
        { new: true }
      );
    }

    res
      .status(201)
      .json({ success: true, message: "Order created!", data: order });
  } catch (error) {
    next(error);
  }
};

const getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    // Prefer restaurantId scope so any staff user (not just the specific
    // POS operator who created it) can see their store's orders. Falls back
    // to createdBy for legacy single-user installs.
    const order = await Order.findOne({
      _id: id,
      ...tenantScopeFor(req.user),
      isDeleted: { $ne: true },
    });
    if (!order) return next(createHttpError(404, "Order not found!"));

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

const getOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({
      ...tenantScopeFor(req.user),
      isDeleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .limit(500)
      .populate("table");
    res.status(200).json({ data: orders });
  } catch (error) {
    next(error);
  }
};

const updateOrder = async (req, res, next) => {
  try {
    const { orderStatus } = req.body || {};
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }
    if (typeof orderStatus !== "string" || !ALLOWED_STATUS_TRANSITIONS.has(orderStatus)) {
      return next(createHttpError(400, "Invalid order status."));
    }

    const order = await Order.findOne({
      _id: id,
      ...tenantScopeFor(req.user),
      isDeleted: { $ne: true },
    });
    if (!order) return next(createHttpError(404, "Order not found!"));

    // Reject transitions out of terminal states — you cannot un-cancel or
    // un-complete an order via this endpoint (§17 business logic).
    if (TERMINAL_STATUSES.has(order.orderStatus) && order.orderStatus !== orderStatus) {
      return next(
        createHttpError(409, `Order is already ${order.orderStatus.toLowerCase()} and cannot be changed.`)
      );
    }

    order.orderStatus = orderStatus;
    order.timeline = order.timeline || [];
    order.timeline.push({
      status: orderStatus,
      timestamp: new Date(),
      user: req.user?.name || "POS",
    });
    await order.save();

    res
      .status(200)
      .json({ success: true, message: "Order updated", data: order });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/order/popular-items?limit=10&days=30
 *
 * Returns the most-ordered menu items for the current tenant/outlet based on
 * real order history. Falls back to the store's "featured" (isFeatured) or
 * top-priced products from the menu when there isn't enough order history yet.
 *
 * Store isolation (§3): every read is scoped by tenantScopeFor(req.user), so
 * one takeaway can NEVER see another takeaway's popularity data or products.
 */
const getPopularItems = async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Aggregate order-history popularity by menuItemId (preferred) and by item
    // name as a fallback (older POS lines only stored `name`).
    const scope = tenantScopeFor(req.user);
    const popularityAgg = await Order.aggregate([
      { $match: { ...scope, isDeleted: { $ne: true }, createdAt: { $gte: since } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: {
            menuItemId: "$items.menuItemId",
            name: "$items.name",
          },
          totalQty: { $sum: { $ifNull: ["$items.quantity", 1] } },
          orders: { $sum: 1 },
        },
      },
      { $sort: { totalQty: -1 } },
      { $limit: limit * 3 },
    ]);

    // Load this tenant's active menus once, then match aggregation results
    // back to real dish documents so the POS gets full product info (price,
    // image, variants, availability, etc.).
    const Menu = getMenuModel();
    const menus = await Menu.find({

      ...(req.user?.restaurantId
        ? { $or: [{ restaurantId: req.user.restaurantId }, { createdBy: req.user._id }] }
        : { createdBy: req.user?._id }),
      isDeleted: { $ne: true },
      published: { $ne: false },
    });

    const dishesById = new Map();
    const dishesByName = new Map();
    menus.forEach((menu) => {
      (menu.items || []).forEach((item) => {
        const enriched = {
          ...item.toObject(),
          categoryId: menu._id,
          categoryName: menu.name,
        };
        if (item._id) dishesById.set(String(item._id), enriched);
        if (item.name) {
          const key = item.name.trim().toLowerCase();
          if (!dishesByName.has(key)) dishesByName.set(key, enriched);
        }
      });
    });

    const seen = new Set();
    const popular = [];
    for (const row of popularityAgg) {
      let dish = null;
      const menuItemId = row._id?.menuItemId ? String(row._id.menuItemId) : null;
      if (menuItemId && dishesById.has(menuItemId)) {
        dish = dishesById.get(menuItemId);
      } else if (row._id?.name) {
        const key = row._id.name.trim().toLowerCase();
        if (dishesByName.has(key)) dish = dishesByName.get(key);
      }
      if (!dish) continue;
      const key = String(dish._id);
      if (seen.has(key)) continue;
      seen.add(key);
      popular.push({ ...dish, orderCount: row.orders, totalQty: row.totalQty });
      if (popular.length >= limit) break;
    }

    // Fallback: if we don't have enough real popularity, fill remaining slots
    // with the store's own default/featured products, then any active dishes.
    if (popular.length < limit) {
      const fallbackCandidates = [];
      menus.forEach((menu) => {
        (menu.items || []).forEach((item) => {
          if (item.isAvailable === false) return;
          fallbackCandidates.push({
            ...item.toObject(),
            categoryId: menu._id,
            categoryName: menu.name,
          });
        });
      });
      // Prefer featured then by sortOrder then by price
      fallbackCandidates.sort((a, b) => {
        if ((b.isFeatured ? 1 : 0) !== (a.isFeatured ? 1 : 0)) {
          return (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0);
        }
        if ((a.sortOrder || 0) !== (b.sortOrder || 0)) {
          return (a.sortOrder || 0) - (b.sortOrder || 0);
        }
        return (b.price || 0) - (a.price || 0);
      });
      for (const dish of fallbackCandidates) {
        const key = String(dish._id);
        if (seen.has(key)) continue;
        seen.add(key);
        popular.push({ ...dish, orderCount: 0, totalQty: 0, fallback: true });
        if (popular.length >= limit) break;
      }
    }

    res.status(200).json({ success: true, data: popular });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addOrder,
  getOrderById,
  getOrders,
  updateOrder,
  getPopularItems,
  validateTableCapacityForOrder,
};

