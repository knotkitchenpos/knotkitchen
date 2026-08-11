const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const Order = require("../models/orderModel");
const KDSOrder = require("../models/kdsModel");
const Ingredient = require("../models/inventoryModel").Ingredient;
const Customer = require("../models/loyaltyModel").Customer;
const Table = require("../models/tableModel");
const router = express.Router();

// Sales dashboard / analytics
router.route("/sales/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const { period = "today", outletId } = req.query;
    const now = new Date();
    let startDate;
    if (period === "today") startDate = new Date(now.setHours(0, 0, 0, 0));
    else if (period === "week") startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    else if (period === "month") startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    else if (period === "year") startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const match = { restaurantId: req.params.restaurantId, isDeleted: false, orderDate: { $gte: startDate } };
    if (outletId) match.outletId = outletId;

    const orders = await Order.find(match);
    const completedOrders = orders.filter(o => ["completed", "delivered", "served"].includes(o.orderStatus));
    const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.bills?.totalWithTax || 0), 0);
    const totalOrders = completedOrders.length;
    const avgOrderValue = totalOrders ? totalRevenue / totalOrders : 0;

    // Peak hour analysis
    const hourlyMap = {};
    completedOrders.forEach(o => {
      const h = new Date(o.orderDate).getHours();
      hourlyMap[h] = (hourlyMap[h] || 0) + 1;
    });
    const peakHours = Object.entries(hourlyMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Daily breakdown for charts
    const dailyMap = {};
    completedOrders.forEach(o => {
      const d = o.orderDate.toISOString().split("T")[0];
      dailyMap[d] = (dailyMap[d] || 0) + (o.bills?.totalWithTax || 0);
    });
    const dailyBreakdown = Object.entries(dailyMap).map(([date, revenue]) => ({ date, revenue }));

    // Order type breakdown
    const typeBreakdown = {};
    completedOrders.forEach(o => { typeBreakdown[o.orderType] = (typeBreakdown[o.orderType] || 0) + 1; });

    // Top items
    const itemMap = {};
    completedOrders.forEach(o => {
      o.items.forEach(i => { itemMap[i.name] = (itemMap[i.name] || 0) + i.quantity; });
    });
    const topItems = Object.entries(itemMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, quantity]) => ({ name, quantity }));

    // Outlet comparison
    const outletMap = {};
    completedOrders.forEach(o => {
      outletMap[o.outletId] = (outletMap[o.outletId] || 0) + (o.bills?.totalWithTax || 0);
    });
    const outletComparison = Object.entries(outletMap).map(([outletId, revenue]) => ({ outletId, revenue }));

    res.status(200).json({ success: true, data: {
      totalRevenue, totalOrders, avgOrderValue, peakHours, dailyBreakdown, typeBreakdown, topItems, outletComparison,
    }});
  } catch (error) { next(error); }
});

// Real-time dashboard metrics
router.route("/realtime/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.setHours(0, 0, 0, 0));
    const [activeOrders, todayOrders, activeTables, kitchenQueue, activeCustomers, todayRevenue] = await Promise.all([
      Order.find({ restaurantId: req.params.restaurantId, orderStatus: { $in: ["pending", "preparing", "ready"] } }).countDocuments(),
      Order.find({ restaurantId: req.params.restaurantId, orderDate: { $gte: todayStart } }),
      Table.find({ restaurantId: req.params.restaurantId, status: "occupied" }).countDocuments(),
      KDSOrder.find({ restaurantId: req.params.restaurantId, status: { $in: ["new", "preparing"] } }),
      Customer.find({ restaurantId: req.params.restaurantId, isDeleted: false }).countDocuments(),
      Order.find({ restaurantId: req.params.restaurantId, orderDate: { $gte: todayStart }, orderStatus: { $in: ["completed", "served", "delivered"] } }),
    ]);
    const todayRevenueTotal = todayRevenue.reduce((s, o) => s + (o.bills?.totalWithTax || 0), 0);
    res.status(200).json({ success: true, data: {
      activeOrders, todayOrders: todayOrders.length, activeTables, kitchenQueue: kitchenQueue.length, activeCustomers, todayRevenue: todayRevenueTotal,
    }});
  } catch (error) { next(error); }
});

// Kitchen analytics
router.route("/kitchen/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const kdsOrders = await KDSOrder.find({ restaurantId: req.params.restaurantId }).sort({ createdAt: -1 }).limit(200);
    const completed = kdsOrders.filter(o => o.status === "completed");
    const avgPrepTime = completed.length
      ? completed.reduce((s, o) => s + (o.preparationTime || 0), 0) / completed.length
      : 0;
    res.status(200).json({ success: true, data: { avgPrepTime, totalOrders: kdsOrders.length, completedCount: completed.length } });
  } catch (error) { next(error); }
});

// Customer analytics
router.route("/customers/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const customers = await Customer.find({ restaurantId: req.params.restaurantId, isDeleted: false });
    const totalCustomers = customers.length;
    const totalPoints = customers.reduce((s, c) => s + (c.rewardPoints || 0), 0);
    const avgLoyalty = totalCustomers ? totalPoints / totalCustomers : 0;
    res.status(200).json({ success: true, data: { totalCustomers, totalPoints, avgLoyalty } });
  } catch (error) { next(error); }
});

// Profitability report (revenue vs ingredient cost)
router.route("/profitability/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const orders = await Order.find({ restaurantId: req.params.restaurantId, isDeleted: false, orderStatus: { $in: ["completed", "served", "delivered"] } });
    const ingredients = await Ingredient.find({ restaurantId: req.params.restaurantId });
    const totalRevenue = orders.reduce((s, o) => s + (o.bills?.totalWithTax || 0), 0);
    const totalCost = ingredients.reduce((s, i) => s + (i.stockQuantity * i.costPerUnit), 0);
    res.status(200).json({ success: true, data: { totalRevenue, totalCost, profit: totalRevenue - totalCost, margin: totalRevenue ? ((totalRevenue - totalCost) / totalRevenue * 100).toFixed(2) : 0 } });
  } catch (error) { next(error); }
});

module.exports = router;