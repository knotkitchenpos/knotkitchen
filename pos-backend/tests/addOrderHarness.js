/**
 * Runs orderController.addOrder / updateOrder against in-memory models.
 *
 * The mocks stay installed for the whole call, not only while the controller
 * loads: addOrder requires the GST resolver, the settings model and the PIN
 * check lazily. Anything that would wait on a database (order numbers, the
 * auto-ready clocks, e-bills, platform fees) is stubbed out.
 */
const Module = require("module");

const RESTAURANT_ID = "111111111111111111111111";
const USER_ID = "222222222222222222222222";
const OWNER = { _id: USER_ID, restaurantId: RESTAURANT_ID, role: "Owner" };

const withController = async (mocks, fn) => {
  const all = {
    "../models/tableModel": {},
    "../services/eBillService": { fireAutoEBill: () => {} },
    "../services/orderCharge": { fireOrderCharge: () => {}, fireOrderChargeReversal: () => {} },
    "../services/orderNumberService": { generateOrderNumberSafe: async () => "123456" },
    "../services/autoReadyService": { computeReadyDueAt: async () => null, computeCompleteDueAt: async () => null },
    ...mocks,
  };
  const orig = Module._load;
  Module._load = function (request) {
    return request in all ? all[request] : orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve("../controllers/orderController")];
    return await fn(require("../controllers/orderController"));
  } finally {
    Module._load = orig;
  }
};

const call = async (handler, req) => {
  const out = { status: 0, body: null, error: null };
  const res = {
    status(code) {
      out.status = code;
      return this;
    },
    json(data) {
      out.body = data;
      return this;
    },
  };
  await handler(req, res, (err) => {
    out.error = err;
  });
  return out;
};

/** addOrder with `body`; `mocks` adds or replaces modules (e.g. "../services/gst"). */
const runAddOrder = async ({ body, user = OWNER, headers = {}, mocks = {}, existing = null, idempotencyKey } = {}) => {
  const saved = [];
  let customerWrites = 0;
  function OrderMock(data) {
    this.data = data;
    this._id = `order-${saved.length + 1}`;
    this.save = async () => {
      saved.push(this.data);
      return this;
    };
  }
  OrderMock.findOne = async () => existing;
  const customer = {
    findOne: async () => null,
    create: async (d) => {
      customerWrites += 1;
      return { _id: "cust-1", ...d };
    },
  };
  return withController({ "../models/orderModel": OrderMock, "../models/customerModel": customer, ...mocks }, async ({ addOrder }) => {
    const req = { body, headers, get: (h) => headers[h], user, ...(idempotencyKey ? { idempotencyKey } : {}) };
    const out = await call(addOrder, req);
    return { ...out, saved, customerWrites };
  });
};

/** updateOrder (or cancelOrder) on one stored order. */
const runUpdateOrder = async ({ order, body, user = OWNER, handler = "updateOrder", mocks = {} }) => {
  let saves = 0;
  const doc = { _id: "507f1f77bcf86cd799439011", timeline: [], ...order, save: async () => { saves += 1; }, toObject() { return { ...this }; } };
  const OrderMock = { findOne: async () => doc };
  return withController({ "../models/orderModel": OrderMock, "../models/customerModel": {}, ...mocks }, async (ctrl) => {
    const out = await call(ctrl[handler], { params: { id: doc._id }, body, user, headers: {} });
    return { ...out, saves, doc };
  });
};

/** WebsiteSettings.findOne(...).select(...).lean() returning `ordering`. */
const settingsWith = (ordering) => ({
  findOne: () => ({ select: () => ({ lean: async () => ({ ordering }) }) }),
});

/** services/gst with resolveGstForRestaurant answering `gst`. */
const gstWith = (gst) => ({ ...require("../services/gst"), resolveGstForRestaurant: async () => gst });

module.exports = { runAddOrder, runUpdateOrder, settingsWith, gstWith, OWNER, RESTAURANT_ID, USER_ID };
