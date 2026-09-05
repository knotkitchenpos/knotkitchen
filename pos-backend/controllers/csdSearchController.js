const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const str = (v) => String(v ?? "").trim();

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** Parse a YYYY-MM-DD as midnight IST (the operator's calendar day). */
const istDayStart = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(ymd));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - IST_OFFSET_MS);
};
const istDayEnd = (ymd) => {
  const start = istDayStart(ymd);
  return start ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : null;
};

/**
 * Resolve a free-text store name to the storeIds it matches.
 *
 * Orders carry a denormalised `storeId` but not the restaurant's name, so a
 * name filter has to be turned into an id set first. Capped: a two-character
 * name would otherwise pull every store into an $in.
 */
const storeIdsForName = async (name) => {
  const rx = new RegExp(escapeRegex(name), "i");
  const [stores, restaurants] = await Promise.all([
    Store.find({ storeName: rx, isDeleted: { $ne: true } }, { storeId: 1 }).limit(200).lean(),
    Restaurant.find({ name: rx, isDeleted: { $ne: true } }, { storeId: 1 }).limit(200).lean(),
  ]);
  return [...new Set([...stores, ...restaurants].map((s) => s.storeId).filter(Boolean))];
};

/** Best-effort single payment status for the results table. */
const paymentStatusOf = (order) => {
  const payments = order.payments || [];
  if (!payments.length) return order.paymentMethod ? "pending" : "";
  if (payments.some((p) => p.status === "refunded")) return "refunded";
  if (payments.every((p) => p.status === "paid")) return "paid";
  if (payments.some((p) => p.status === "paid")) return "partial";
  if (payments.some((p) => p.status === "failed")) return "failed";
  return "pending";
};

const transactionIdOf = (order) =>
  (order.payments || []).find((p) => p.transactionId)?.transactionId ||
  order.paymentData?.gatewayPaymentId ||
  "";

const customerAddressOf = (o) => {
  const c = o.customerDetails || {};
  const d = o.deliveryAddress || {};
  return (
    [c.address, c.city, c.pinCode].filter(Boolean).join(", ") ||
    [d.line1, d.line2, d.city, d.postalCode].filter(Boolean).join(", ") ||
    ""
  );
};

/**
 * GET /api/csd/orders/search
 *
 * Every filter below is optional and they AND together, per the spec's
 * "Store Name + Order Date + Order Amount" example. At least one is required:
 * an unfiltered query would page through every order on the platform.
 *
 * Available to staff as well as admins — order lookup is core CSD work.
 */
const searchOrders = async (req, res, next) => {
  try {
    const q = req.query || {};
    const filters = {};
    const applied = [];

    // --- Store ---------------------------------------------------------
    const storeId = str(q.storeId);
    if (storeId) {
      if (!/^\d{1,6}$/.test(storeId)) return next(createHttpError(400, "Store ID must be digits."));
      filters.storeId = storeId.length === 6 ? storeId : new RegExp(`^${storeId}`);
      applied.push("storeId");
    }

    const storeName = str(q.storeName);
    if (storeName) {
      if (storeName.length < 2) return next(createHttpError(400, "Store name needs at least 2 characters."));
      const ids = await storeIdsForName(storeName);
      if (!ids.length) {
        return res.status(200).json({
          success: true,
          data: { results: [], total: 0, page: 1, pages: 0, applied: [...applied, "storeName"] },
        });
      }
      // Combine with an explicit storeId rather than overwriting it.
      filters.storeId = filters.storeId ? { $in: ids.filter((i) => i === storeId) } : { $in: ids };
      applied.push("storeName");
    }

    // --- Order identity -------------------------------------------------
    const orderId = str(q.orderId);
    if (orderId) {
      const or = [{ orderNumber: new RegExp(escapeRegex(orderId), "i") }];
      if (mongoose.Types.ObjectId.isValid(orderId)) or.push({ _id: orderId });
      filters.$and = [...(filters.$and || []), { $or: or }];
      applied.push("orderId");
    }

    // --- Customer -------------------------------------------------------
    const customerName = str(q.customerName);
    if (customerName) {
      filters["customerDetails.name"] = new RegExp(escapeRegex(customerName), "i");
      applied.push("customerName");
    }

    const customerPhone = str(q.customerPhone).replace(/\D/g, "");
    if (customerPhone) {
      filters["customerDetails.phone"] = new RegExp(`${escapeRegex(customerPhone)}$`);
      applied.push("customerPhone");
    }

    const customerAddress = str(q.customerAddress);
    if (customerAddress) {
      const rx = new RegExp(escapeRegex(customerAddress), "i");
      filters.$and = [
        ...(filters.$and || []),
        {
          $or: [
            { "customerDetails.address": rx },
            { "customerDetails.city": rx },
            { "customerDetails.pinCode": rx },
            { "deliveryAddress.line1": rx },
            { "deliveryAddress.line2": rx },
            { "deliveryAddress.city": rx },
            { "deliveryAddress.postalCode": rx },
          ],
        },
      ];
      applied.push("customerAddress");
    }

    // --- Transaction ----------------------------------------------------
    const transactionId = str(q.transactionId);
    if (transactionId) {
      const rx = new RegExp(escapeRegex(transactionId), "i");
      filters.$and = [
        ...(filters.$and || []),
        { $or: [{ "payments.transactionId": rx }, { "paymentData.gatewayPaymentId": rx }] },
      ];
      applied.push("transactionId");
    }

    // --- Date range (inclusive, IST calendar days) ----------------------
    const dateFrom = istDayStart(q.dateFrom);
    const dateTo = istDayEnd(q.dateTo);
    if (str(q.dateFrom) && !dateFrom) return next(createHttpError(400, "Invalid 'from' date."));
    if (str(q.dateTo) && !dateTo) return next(createHttpError(400, "Invalid 'to' date."));
    if (dateFrom || dateTo) {
      filters.orderDate = {};
      if (dateFrom) filters.orderDate.$gte = dateFrom;
      if (dateTo) filters.orderDate.$lt = dateTo;
      applied.push("orderDate");
    }

    // --- Amount range ---------------------------------------------------
    const amountMin = q.amountMin === undefined || q.amountMin === "" ? null : Number(q.amountMin);
    const amountMax = q.amountMax === undefined || q.amountMax === "" ? null : Number(q.amountMax);
    if (amountMin !== null && Number.isNaN(amountMin)) return next(createHttpError(400, "Invalid minimum amount."));
    if (amountMax !== null && Number.isNaN(amountMax)) return next(createHttpError(400, "Invalid maximum amount."));
    if (amountMin !== null || amountMax !== null) {
      filters["bills.totalWithTax"] = {};
      if (amountMin !== null) filters["bills.totalWithTax"].$gte = amountMin;
      if (amountMax !== null) filters["bills.totalWithTax"].$lte = amountMax;
      applied.push("amount");
    }

    // --- Status ---------------------------------------------------------
    const status = str(q.status);
    if (status) {
      // Case-insensitive: orderStatus is free-form and written inconsistently
      // across the codebase ("Completed" vs "completed").
      filters.orderStatus = new RegExp(`^${escapeRegex(status)}$`, "i");
      applied.push("status");
    }

    if (!applied.length) {
      return next(createHttpError(400, "Apply at least one filter to search orders."));
    }

    filters.isDeleted = { $ne: true };

    const page = Math.max(parseInt(q.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 25, 1), 100);

    const [total, orders] = await Promise.all([
      Order.countDocuments(filters),
      Order.find(filters)
        .sort({ orderDate: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    // Resolve store names for just this page, not the whole result set.
    const ids = [...new Set(orders.map((o) => o.storeId).filter(Boolean))];
    const stores = ids.length
      ? await Store.find({ storeId: { $in: ids } }, { storeId: 1, storeName: 1 }).lean()
      : [];
    const nameById = new Map(stores.map((s) => [s.storeId, s.storeName]));

    res.status(200).json({
      success: true,
      data: {
        results: orders.map((o) => ({
          id: String(o._id),
          orderNumber: o.orderNumber || "",
          storeId: o.storeId || "",
          storeName: nameById.get(o.storeId) || "",
          customerName: o.customerDetails?.name || "",
          customerPhone: o.customerDetails?.phone || "",
          customerAddress: customerAddressOf(o),
          orderDate: o.orderDate || o.createdAt,
          transactionId: transactionIdOf(o),
          amount: o.bills?.totalWithTax ?? o.bills?.total ?? 0,
          orderStatus: o.orderStatus || "",
          paymentStatus: paymentStatusOf(o),
          orderType: o.orderType || "",
          source: o.source || "",
        })),
        total,
        page,
        pages: Math.ceil(total / limit),
        applied,
      },
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/csd/orders/:id — full order detail for the drawer. */
const getOrder = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(400, "Invalid order id."));

    const o = await Order.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!o) return next(createHttpError(404, "Order not found."));

    const store = o.storeId ? await Store.findOne({ storeId: o.storeId }).lean() : null;

    res.status(200).json({
      success: true,
      data: {
        id: String(o._id),
        orderNumber: o.orderNumber || "",
        storeId: o.storeId || "",
        storeName: store?.storeName || "",
        orderDate: o.orderDate || o.createdAt,
        orderStatus: o.orderStatus || "",
        paymentStatus: paymentStatusOf(o),
        orderType: o.orderType || "",
        source: o.source || "",
        transactionId: transactionIdOf(o),
        customer: {
          name: o.customerDetails?.name || "",
          phone: o.customerDetails?.phone || "",
          address: customerAddressOf(o),
          note: o.customerDetails?.deliveryNote || "",
        },
        bills: o.bills || {},
        items: (o.items || []).map((i) => ({
          name: i.name || "",
          quantity: i.quantity ?? i.qty ?? 1,
          price: i.price ?? 0,
          total: i.total ?? 0,
          status: i.status || "",
        })),
        // Method and status only — never the raw gateway payload.
        payments: (o.payments || []).map((p) => ({
          method: p.method,
          amount: p.amount,
          status: p.status,
          transactionId: p.transactionId || "",
        })),
        refunds: o.refunds || [],
        timeline: o.timeline || [],
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { searchOrders, getOrder };
