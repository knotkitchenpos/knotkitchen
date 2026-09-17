const createHttpError = require("http-errors");
const Customer = require("../models/customerModel");

const getScopedQuery = (req) => {
  const q = { restaurantId: req.user.restaurantId, isDeleted: { $ne: true } };
  if (req.user.outletId) q.outletId = req.user.outletId;
  return q;
};

// Upsert a customer by phone (dedupe by unique (restaurantId, phone) index)
const upsertCustomer = async (req, res, next) => {
  try {
    const { name, phone, email, notes, tags } = req.body;
    if (!phone) throw createHttpError(400, "Phone is required!");

    const existing = await Customer.findOne({ restaurantId: req.user.restaurantId, phone, isDeleted: { $ne: true } });
    let customer;
    if (existing) {
      if (name) existing.name = name;
      if (email) existing.email = email;
      if (notes) existing.notes = notes;
      if (tags) existing.tags = tags;
      if (req.user.outletId) existing.outletId = req.user.outletId;
      customer = await existing.save();
    } else {
      customer = await Customer.create({
        restaurantId: req.user.restaurantId,
        outletId: req.user.outletId,
        name: name || "", phone, email: email || "", notes: notes || "", tags: tags || [],
        createdBy: req.user._id, isRegistered: false, visitCount: 1, totalSpent: 0,
      });
    }
    res.status(200).json({ success: true, data: customer });
  } catch (error) { next(error); }
};

const listCustomers = async (req, res, next) => {
  try {
    const { search } = req.query;
    const q = getScopedQuery(req);
    if (search) q.$or = [{ name: { $regex: search, $options: "i" } }, { phone: { $regex: search, $options: "i" } }, { email: { $regex: search, $options: "i" } }];
    const customers = await Customer.find(q).sort({ createdAt: -1 }).limit(200);
    res.status(200).json({ success: true, data: customers });
  } catch (error) { next(error); }
};

const getCustomer = async (req, res, next) => {
  try {
    const customer = await Customer.findOne({ _id: req.params.id, ...getScopedQuery(req) });
    if (!customer) throw createHttpError(404, "Customer not found!");
    res.status(200).json({ success: true, data: customer });
  } catch (error) { next(error); }
};

/** PUT /:id { name, email, notes, tags } -- the bits staff maintain by hand. */
const updateCustomer = async (req, res, next) => {
  try {
    const customer = await Customer.findOne({ _id: req.params.id, ...getScopedQuery(req) });
    if (!customer) throw createHttpError(404, "Customer not found!");
    const { name, email, notes, tags } = req.body || {};
    if (name !== undefined) customer.name = String(name).trim().slice(0, 120);
    if (email !== undefined) customer.email = String(email).trim().slice(0, 160);
    if (notes !== undefined) customer.notes = String(notes).trim().slice(0, 1000);
    if (Array.isArray(tags)) customer.tags = tags.map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 20);
    await customer.save();
    res.status(200).json({ success: true, data: customer });
  } catch (error) { next(error); }
};

/** GET /:id/orders -- the customer's last 50 orders, by id or by phone. */
const customerOrders = async (req, res, next) => {
  try {
    const customer = await Customer.findOne({ _id: req.params.id, ...getScopedQuery(req) }).lean();
    if (!customer) throw createHttpError(404, "Customer not found!");
    const Order = require("../models/orderModel");
    const or = [{ customerId: customer._id }];
    if (customer.phone) or.push({ "customerDetails.phone": customer.phone });
    const data = await Order.find({ restaurantId: req.user.restaurantId, isDeleted: { $ne: true }, $or: or })
      .sort({ createdAt: -1 })
      .limit(50)
      .select("orderNumber orderType orderStatus source bills createdAt items.name items.quantity")
      .lean();
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
};

module.exports = { upsertCustomer, listCustomers, getCustomer, updateCustomer, customerOrders };