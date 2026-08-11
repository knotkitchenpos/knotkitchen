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

module.exports = { upsertCustomer, listCustomers, getCustomer };