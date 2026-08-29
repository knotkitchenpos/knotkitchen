const Store = require("../models/storeModel");
const Order = require("../models/orderModel");
const CsdJob = require("../models/csdJobModel");
const CsdStaff = require("../models/csdStaffModel");
const AuditLog = require("../models/auditLogModel");
const { istMonthStart } = require("./csdDashboardController");

/**
 * GET /api/csd/reports — admin only.
 *
 * Operational reporting on top of the same IST-bucketed, cancellation-aware
 * rules the dashboard uses (see csdDashboardController for why both matter).
 *
 * ?months=N controls the trend window (1–24, default 6).
 */
const NOT_CANCELLED = { orderStatus: { $not: /^cancelled$/i } };
const REVENUE = { $sum: { $ifNull: ["$bills.totalWithTax", { $ifNull: ["$bills.total", 0] }] } };

const getReports = async (req, res, next) => {
  try {
    const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);
    const now = new Date();
    const from = istMonthStart(now, months - 1);
    const to = istMonthStart(now, -1);

    const orderMatch = { isDeleted: { $ne: true }, orderDate: { $gte: from, $lt: to }, ...NOT_CANCELLED };

    const [topStores, byOrderType, bySource, jobStats, jobsByAssignee, staffActivity, cancelled] =
      await Promise.all([
        // Revenue leaderboard.
        Order.aggregate([
          { $match: orderMatch },
          { $group: { _id: "$storeId", orders: { $sum: 1 }, revenue: REVENUE } },
          { $sort: { revenue: -1 } },
          { $limit: 10 },
        ]),

        Order.aggregate([
          { $match: orderMatch },
          { $group: { _id: "$orderType", orders: { $sum: 1 }, revenue: REVENUE } },
          { $sort: { orders: -1 } },
        ]),

        Order.aggregate([
          { $match: orderMatch },
          { $group: { _id: "$source", orders: { $sum: 1 }, revenue: REVENUE } },
          { $sort: { orders: -1 } },
        ]),

        CsdJob.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),

        CsdJob.aggregate([
          { $match: { assignedToId: { $ne: null } } },
          {
            $group: {
              _id: { id: "$assignedToId", name: "$assignedToName", code: "$assignedToStaffId" },
              total: { $sum: 1 },
              closed: { $sum: { $cond: [{ $eq: ["$status", "closed"] }, 1, 0] } },
            },
          },
          { $sort: { total: -1 } },
          { $limit: 15 },
        ]),

        // Volume of recorded CSD actions per person — an activity signal, not
        // a performance metric; it counts audited actions only.
        AuditLog.aggregate([
          { $match: { role: /^csd:/, timestamp: { $gte: from } } },
          { $group: { _id: "$phone", actions: { $sum: 1 } } },
          { $sort: { actions: -1 } },
          { $limit: 15 },
        ]),

        // Cancellations are excluded from revenue, so report them separately
        // rather than letting them vanish from the picture entirely.
        Order.aggregate([
          {
            $match: {
              isDeleted: { $ne: true },
              orderDate: { $gte: from, $lt: to },
              orderStatus: /^cancelled$/i,
            },
          },
          { $group: { _id: null, orders: { $sum: 1 }, value: REVENUE } },
        ]),
      ]);

    // Resolve store + staff names for just the rows being returned.
    const storeIds = topStores.map((s) => s._id).filter(Boolean);
    const [stores, staff] = await Promise.all([
      storeIds.length
        ? Store.find({ storeId: { $in: storeIds } }, { storeId: 1, storeName: 1, status: 1 }).lean()
        : [],
      CsdStaff.find({}, { phone: 1, fullName: 1, staffId: 1 }).lean(),
    ]);
    const storeById = new Map(stores.map((s) => [s.storeId, s]));
    const staffByPhone = new Map(staff.map((s) => [s.phone, s]));

    const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

    res.status(200).json({
      success: true,
      data: {
        period: { from, to, months, timezone: "Asia/Kolkata" },
        topStores: topStores.map((s) => ({
          storeId: s._id || "",
          storeName: storeById.get(s._id)?.storeName || "",
          status: storeById.get(s._id)?.status || "",
          orders: s.orders,
          revenue: round(s.revenue),
        })),
        byOrderType: byOrderType.map((r) => ({
          label: r._id || "unspecified",
          orders: r.orders,
          revenue: round(r.revenue),
        })),
        bySource: bySource.map((r) => ({
          label: r._id || "unspecified",
          orders: r.orders,
          revenue: round(r.revenue),
        })),
        cancellations: {
          orders: cancelled[0]?.orders || 0,
          value: round(cancelled[0]?.value || 0),
        },
        jobs: {
          byStatus: jobStats.map((j) => ({ status: j._id, count: j.count })),
          byAssignee: jobsByAssignee.map((j) => ({
            staffId: j._id.code || "",
            name: j._id.name || "",
            total: j.total,
            closed: j.closed,
            open: j.total - j.closed,
          })),
        },
        staffActivity: staffActivity.map((a) => ({
          staffId: staffByPhone.get(a._id)?.staffId || "",
          name: staffByPhone.get(a._id)?.fullName || "Unknown",
          actions: a.actions,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/csd/reports/audit — admin only.
 *
 * The platform activity log, filtered to CSD actors. This is the record the
 * spec asks be kept for store creation, staff changes and job lifecycle
 * events; it is read-only by design — AuditLog is append-only and there is no
 * route that edits or deletes an entry.
 */
const getAuditLog = async (req, res, next) => {
  try {
    const q = req.query || {};
    const filters = { role: /^csd:/ };

    if (String(q.action || "").trim()) filters.action = String(q.action).trim();
    if (String(q.storeId || "").trim()) filters.storeId = String(q.storeId).trim();

    const page = Math.max(parseInt(q.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);

    const [total, entries, actions] = await Promise.all([
      AuditLog.countDocuments(filters),
      AuditLog.find(filters).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AuditLog.distinct("action", { role: /^csd:/ }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        entries: entries.map((e) => ({
          id: String(e._id),
          action: e.action,
          description: e.description,
          storeId: e.storeId || "",
          role: e.role,
          phone: e.phone,
          severity: e.severity,
          previousValue: e.previousValue,
          newValue: e.newValue,
          timestamp: e.timestamp,
          ipAddress: e.ipAddress || "",
        })),
        total,
        page,
        pages: Math.ceil(total / limit),
        actions: actions.sort(),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getReports, getAuditLog };
