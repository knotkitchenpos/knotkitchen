const createHttpError = require("http-errors");
const Order = require("../models/orderModel");
const Table = require("../models/tableModel");
const Customer = require("../models/customerModel");
const { default: mongoose } = require("mongoose");

// Validate table capacity on the server.
// Never trust the frontend: the table is always re-resolved
// within the caller's tenant/outlet scope before capacity is enforced.
const validateTableCapacityForOrder = async ({ tableId, guests, user }) => {
  if (!tableId) return;

  if (!mongoose.Types.ObjectId.isValid(tableId)) {
    throw createHttpError(400, "Invalid table id!");
  }

  const scopeQuery = user?.restaurantId
    ? {
        _id: tableId,
        restaurantId: user.restaurantId,
        ...(user.outletId ? { outletId: user.outletId } : {}),
        isDeleted: { $ne: true },
      }
    : { _id: tableId, createdBy: user._id, isDeleted: { $ne: true } };

  const table = await Table.findOne(scopeQuery);
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

const addOrder = async (req, res, next) => {
  try {
    const { table, customerDetails, bills, orderType } = req.body;

    // Backend capacity enforcement for dine-in table orders
    if (table || customerDetails?.guests) {
      await validateTableCapacityForOrder({
        tableId: table,
        guests: customerDetails?.guests,
        user: req.user,
      });
    }

    const name = customerDetails?.name ? String(customerDetails.name).trim() : "";
    const phone = customerDetails?.phone ? String(customerDetails.phone).trim() : "";

    let customerId = null;

    if (name || phone) {
      const restaurantId = req.user?.restaurantId || req.user?._id;
      const outletId = req.user?.outletId;
      const totalAmount = Number(bills?.totalWithTax || bills?.total || 0);

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

    const normalizedOrderType = orderType ? String(orderType).toLowerCase() : "dine-in";

    const orderData = {
      ...req.body,
      orderType: normalizedOrderType === "table service" ? "dine-in" : normalizedOrderType,
      customerDetails: {
        name,
        phone,
        guests: customerDetails?.guests ? Number(customerDetails.guests) : 1,
      },
      ...(customerId ? { customerId } : {}),
      createdBy: req.user._id,
    };

    const order = new Order(orderData);
    await order.save();

    // Sync table occupancy when a dine-in order is placed via the legacy path
    if (table) {
      const guests = Math.max(1, Number(customerDetails?.guests) || 1);
      const scopeQuery = req.user?.restaurantId
        ? {
            _id: table,
            restaurantId: req.user.restaurantId,
            ...(req.user.outletId ? { outletId: req.user.outletId } : {}),
            isDeleted: { $ne: true },
          }
        : { _id: table, createdBy: req.user._id, isDeleted: { $ne: true } };

      await Table.findOneAndUpdate(
        scopeQuery,
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
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }

    const order = await Order.findOne({ _id: id, createdBy: req.user._id });
    if (!order) {
      const error = createHttpError(404, "Order not found!");
      return next(error);
    }

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

const getOrders = async (req, res, next) => {
  try {
    const orders = await Order.find({ createdBy: req.user._id }).populate("table");
    res.status(200).json({ data: orders });
  } catch (error) {
    next(error);
  }
};

const updateOrder = async (req, res, next) => {
  try {
    const { orderStatus } = req.body;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }

    const order = await Order.findOneAndUpdate(
      { _id: id, createdBy: req.user._id },
      { orderStatus },
      { new: true }
    );

    if (!order) {
      const error = createHttpError(404, "Order not found!");
      return next(error);
    }

    res
      .status(200)
      .json({ success: true, message: "Order updated", data: order });
  } catch (error) {
    next(error);
  }
};

module.exports = { addOrder, getOrderById, getOrders, updateOrder, validateTableCapacityForOrder };