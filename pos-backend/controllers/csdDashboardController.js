const Store = require("../models/storeModel");
const Order = require("../models/orderModel");

/**
 * Business timezone. Containers run UTC, but "orders this month" must mean the
 * calendar month in India — otherwise every order placed between 00:00 and
 * 05:30 IST on the 1st lands in the previous month's figure. IST is a fixed
 * UTC+05:30 with no DST, so a constant offset is exact here.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Start of the IST calendar month containing `now`, as a UTC instant. */
const istMonthStart = (now = new Date(), monthsBack = 0) => {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const startIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - monthsBack, 1, 0, 0, 0, 0);
  return new Date(startIst - IST_OFFSET_MS);
};

/**
 * `orderStatus` is a free-form string and the codebase writes it with
 * inconsistent casing ("Completed" and "completed", "Ready" and "ready").
 * Revenue therefore excludes cancellations case-insensitively rather than
 * matching a positive list, which would silently drop whole casings.
 */
const NOT_CANCELLED = { orderStatus: { $not: /^cancelled$/i } };

const revenueMatch = (from, to) => ({
  isDeleted: { $ne: true },
  orderDate: { $gte: from, $lt: to },
  ...NOT_CANCELLED,
});

/**
 * GET /api/csd/dashboard  — admin only.
 *
 * Current-month KPIs plus a 6-month trend. Everything is computed in the
 * database (countDocuments / aggregate); nothing is pulled into Node to be
 * summed in JS, so this stays flat as order volume grows.
 */
const getDashboard = async (req, res, next) => {
  try {
    const now = new Date();
    const monthStart = istMonthStart(now);
    const nextMonthStart = istMonthStart(now, -1);

    const [
      totalRegistered,
      totalActive,
      totalDisabled,
      statusBreakdown,
      monthAgg,
      trend,
      newStoresThisMonth,
    ] = await Promise.all([
      Store.countDocuments({ isDeleted: { $ne: true } }),
      Store.countDocuments({ isDeleted: { $ne: true }, status: "active" }),
      // "Stopped using KnotKitchen or been disabled" — deliberately excludes
      // closed_temporarily / closed_until, which are ordinary trading pauses.
      Store.countDocuments({ isDeleted: { $ne: true }, status: { $in: ["suspended", "deleted"] } }),

      Store.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      Order.aggregate([
        { $match: revenueMatch(monthStart, nextMonthStart) },
        {
          $group: {
            _id: null,
            orders: { $sum: 1 },
            // Fall back through the bill fields — older documents predate
            // totalWithTax and would otherwise contribute 0 to revenue.
            revenue: {
              $sum: {
                $ifNull: ["$bills.totalWithTax", { $ifNull: ["$bills.total", 0] }],
              },
            },
          },
        },
      ]),

      Order.aggregate([
        { $match: revenueMatch(istMonthStart(now, 5), nextMonthStart) },
        {
          $group: {
            _id: {
              // Bucket by IST month, not UTC, to match the KPI above.
              y: { $year: { date: "$orderDate", timezone: "Asia/Kolkata" } },
              m: { $month: { date: "$orderDate", timezone: "Asia/Kolkata" } },
            },
            orders: { $sum: 1 },
            revenue: {
              $sum: { $ifNull: ["$bills.totalWithTax", { $ifNull: ["$bills.total", 0] }] },
            },
          },
        },
        { $sort: { "_id.y": 1, "_id.m": 1 } },
      ]),

      Store.countDocuments({
        isDeleted: { $ne: true },
        createdAt: { $gte: monthStart, $lt: nextMonthStart },
      }),
    ]);

    const month = monthAgg[0] || { orders: 0, revenue: 0 };

    res.status(200).json({
      success: true,
      data: {
        period: {
          from: monthStart,
          to: nextMonthStart,
          label: new Intl.DateTimeFormat("en-IN", {
            month: "long",
            year: "numeric",
            timeZone: "Asia/Kolkata",
          }).format(now),
          timezone: "Asia/Kolkata",
        },
        kpis: {
          totalRegistered,
          totalActive,
          totalDisabled,
          ordersThisMonth: month.orders,
          revenueThisMonth: Math.round((month.revenue + Number.EPSILON) * 100) / 100,
          newStoresThisMonth,
        },
        statusBreakdown: statusBreakdown
          .map((s) => ({ status: s._id || "unknown", count: s.count }))
          .sort((a, b) => b.count - a.count),
        trend: trend.map((t) => ({
          month: `${t._id.y}-${String(t._id.m).padStart(2, "0")}`,
          orders: t.orders,
          revenue: Math.round((t.revenue + Number.EPSILON) * 100) / 100,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getDashboard, istMonthStart };
