const createHttpError = require("http-errors");
const { AUDIENCES, projectMenus } = require("../services/menuCache");
const Order = require("../models/orderModel");
const Table = require("../models/tableModel");
const Customer = require("../models/customerModel");
const Restaurant = require("../models/restaurantModel");
const { logActivity } = require("../services/auditService");

const { default: mongoose } = require("mongoose");
const { generateOrderNumberSafe } = require("../services/orderNumberService");
const { computeReadyDueAt, computeCompleteDueAt } = require("../services/autoReadyService");
const { notifyOrderReady } = require("../services/readyNotificationService");
const { fireAutoEBill } = require("../services/eBillService");
const { fireOrderCharge, fireOrderChargeReversal } = require("../services/orderCharge");
const { emitOrderCreated, emitOrderStatusChanged } = require("../services/socket");
const { indianMobile } = require("../services/otpService");
const { round2 } = require("../services/money");
const { isDuplicateKey } = require("../services/idempotency");
const { computeDeliveryFeeFromSlabs } = require("../services/distanceService");
const { displayPaymentMethod } = require("../constants/paymentMethods");
const { maskPhone } = require("../middlewares/customerPrivacy");
const { DEFAULT_TZ, zonedInstant, localDate } = require("../services/tableBookings");


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

/**
 * Module 4 §1 — canonical order-status vocabulary.
 *
 *   Preparing → Ready → Completed
 *
 * The vocabulary itself now lives in constants/orderStatus.js, which is the
 * single source of truth shared with the auto-ready sweep, analytics and the
 * table/QR flows. It previously lived here, and every other file kept its own
 * slightly different copy — that divergence is what let lowercase statuses go
 * unmatched by queries for so long. Re-exported below so existing importers
 * of this module keep working.
 */
const {
  READY,
  CANCELLED,
  REFUNDED,
  OUT_FOR_DELIVERY,
  isSettled,
  ALLOWED_INITIAL_STATUS,
  ALLOWED_STATUS_TRANSITIONS,
  TERMINAL_STATUSES,
  canonicalStatus,
  isFinished,
  isCancelled,
} = require("../constants/orderStatus");


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
  taxPercent: safeNumber(bills.taxPercent, 0, { min: 0, max: 100 }),
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
const sanitizeItem = (raw = {}) => {
  const quantity = Math.max(1, Math.min(1000, Math.floor(safeNumber(raw.quantity, 1))));
  const price = safeNumber(raw.price, 0, { min: 0, max: 1e7 });
  // The schema means `price` per unit and `total` per line. A client that
  // sends only `price` used to store total: 0, which the receipt then
  // reconstructed as price * quantity -- counting the quantity twice for the
  // POS, whose cart puts the LINE total in `price`. Derive it instead of
  // storing a zero nobody can interpret later.
  const total =
    safeNumber(raw.total, 0, { min: 0, max: 1e9 }) ||
    safeNumber(price * quantity, 0, { min: 0, max: 1e9 });
  return {
  name: String(raw.name || "").slice(0, 200),
  quantity,
  price,
  total,
  note: String(raw.note || "").slice(0, 300),
  // `optionName` is what the till sends -- reading only `name` stored an
  // EMPTY string for every extra on every POS order ever taken. The names
  // survived solely inside the composed product name, which is why removing
  // that bracket had to come with this.
  modifiers: Array.isArray(raw.modifiers)
    ? raw.modifiers.slice(0, 40).map((m) => ({
        name: String(m?.name || m?.optionName || "").slice(0, 120),
        price: safeNumber(m?.price, 0, { min: -1e6, max: 1e6 }),
        quantity: Math.max(1, Math.min(99, Math.floor(safeNumber(m?.quantity, 1)))),
      }))
    : [],

  // The structured detail behind those extras. Dropped entirely before, so a
  // POS order could never say which option group a choice came from, and a
  // chosen variant left no trace at all.
  variant: raw.variant
    ? {
        name: String(raw.variant.name || "").slice(0, 120),
        price: safeNumber(raw.variant.price, 0, { min: -1e6, max: 1e6 }),
      }
    : undefined,
  modifierSelections: Array.isArray(raw.modifierSelections)
    ? raw.modifierSelections.slice(0, 40).map((m) => ({
        groupName: String(m?.groupName || "").slice(0, 120),
        optionName: String(m?.optionName || m?.name || "").slice(0, 120),
        price: safeNumber(m?.price, 0, { min: -1e6, max: 1e6 }),
      }))
    : [],
  addons: Array.isArray(raw.addons)
    ? raw.addons.slice(0, 40).map((a) => ({
        name: String(a?.name || "").slice(0, 120),
        price: safeNumber(a?.price, 0, { min: -1e6, max: 1e6 }),
      }))
    : [],
  };
};

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
  if (!hasAny) return undefined;
  // The distance staff typed at the till, which prices delivery by slab.
  const km = raw.distanceKm === "" || raw.distanceKm == null ? NaN : Number(raw.distanceKm);
  if (km >= 0 && km <= 100) Object.assign(cleaned, { distanceKm: round2(km), distanceSource: "staff" });
  return cleaned;
};

/** Split parts (services/splitPayment, upper case) as Order.payments[].method. */
const SPLIT_PART_METHOD = { CASH: "cash", UPI: "upi", QR_CODE: "upi", CARD: "card" };

const addOrder = async (req, res, next) => {
  try {
    const {
      table,
      customerDetails,
      bills,
      orderType,
      deliveryAddress,
      paymentMethod: rawPaymentMethod,
    } = req.body || {};

    // Set by the offline sync (routes/offlineRoute.js) and only there. Read
    // before the header below can set a key: a live request must not earn the
    // offline exemptions (GST re-pricing, discount PIN) by sending a header.
    const offlineSync = Boolean(req.idempotencyKey);

    // A live till sends its local id as Idempotency-Key, the same id it queues
    // the order under if the answer is lost. When the first attempt did get
    // through, the retry and the offline sync both find it here instead of
    // creating the sale twice.
    const headerKey = String(req.get?.("Idempotency-Key") || "").trim().slice(0, 80);
    if (headerKey && !offlineSync && req.user?.restaurantId) {
      req.idempotencyKey = `offline:${headerKey}`;
      const existing = await Order.findOne({ restaurantId: req.user.restaurantId, idempotencyKey: req.idempotencyKey });
      if (existing) return res.status(200).json({ success: true, message: "Order already created", data: existing });
    }

    // Backend capacity enforcement for dine-in table orders
    if (table || customerDetails?.guests) {
      await validateTableCapacityForOrder({
        tableId: table,
        guests: customerDetails?.guests,
        user: req.user,
      });
    }


    const name = customerDetails?.name ? String(customerDetails.name).trim().slice(0, 200) : "";
    // The same rule as every other channel: a 10-digit Indian mobile, +91 / 0
    // stripped. Any string used to be saved, become a CRM customer and get an
    // e-bill. Blank is still fine for a walk-in.
    const rawPhone = customerDetails?.phone ? String(customerDetails.phone).trim() : "";
    const phone = rawPhone ? indianMobile(rawPhone) : "";
    if (rawPhone && !phone) {
      return next(createHttpError(400, "Enter a valid 10-digit mobile number, or leave the phone blank."));
    }
    const guests = Math.max(1, Math.min(1000, Math.floor(safeNumber(customerDetails?.guests, 1))));
    // Module 4 §5 — structured customer address fields.
    // These are stored on customerDetails so they render alongside name/phone
    // in the Order Details view without needing a deliveryAddress object.
    const custAddress = customerDetails?.address ? String(customerDetails.address).trim().slice(0, 300) : "";
    const custCity = customerDetails?.city ? String(customerDetails.city).trim().slice(0, 120) : "";
    let custPin = customerDetails?.pinCode ? String(customerDetails.pinCode).trim().slice(0, 20) : "";
    // B2B bill: company + GSTIN, validated so a typo is refused at the till.
    const buyer = require("../services/gst").buyerFrom(customerDetails || {});
    const custDeliveryNote = customerDetails?.deliveryNote
      ? String(customerDetails.deliveryNote).trim().slice(0, 400)
      : "";

    // Normalise + allow-list order type. Anything else → dine-in.
    let normalizedOrderType = String(orderType || "dine-in").toLowerCase();
    if (normalizedOrderType === "table service") normalizedOrderType = "dine-in";
    if (!ALLOWED_ORDER_TYPES.has(normalizedOrderType)) normalizedOrderType = "dine-in";

    // Module 7 §4 — Order Type Toggles enforcement
    if (req.user?.restaurantId && mongoose.connection.readyState === 1) {
      try {
        const restaurant = await Restaurant.findById(req.user.restaurantId);
        const toggles = restaurant?.orderTypeToggles || { collection: true, delivery: true, table: true };
        const key = normalizedOrderType === "dine-in" ? "table" : normalizedOrderType === "takeaway" ? "collection" : normalizedOrderType;
        if (toggles[key] === false) {
          return next(createHttpError(400, `${key.charAt(0).toUpperCase() + key.slice(1)} orders are currently disabled in Store Settings.`));
        }
      } catch (e) {
        // Safe fallback in test environments where Restaurant model is un-mocked
      }
    }



    // Client-supplied orderStatus is deliberately IGNORED — the POS never
    // sets "Completed" straight away, and allowing arbitrary status via the
    // create path would let a caller mark a takeaway order paid without
    // payment. Module 4 §1 renamed "Pending" → "Preparing" so every new POS
    // order enters the queue as Preparing.
    //
    // EXCEPTION (§Finish Order — Cash / UPI / Card / Split): when the biller
    // has already collected the money at the till, the order is by definition
    // fully paid the moment it's created. We accept an allow-listed
    // `paymentMethod` from the request body and, for the "paid-at-till"
    // channels only, record matching payments[] entries so downstream code
    // (invoice, reports, receipts, online orders view) can render the correct
    // payment status instead of showing "pending" / "Pay on collection" for an
    // order that has already been paid. Pay-by-Link still stays Preparing +
    // pending — that transition is owned by verifyAndCaptureLinkPayment.
    const normalizedPaymentMethod = (() => {
      const raw = String(rawPaymentMethod || "").trim().toLowerCase();
      if (raw === "cash") return "Cash";
      if (raw === "upi" || raw === "qr" || raw === "qr/online" || raw === "online") return "UPI";
      if (raw === "card") return "Card";
      if (raw === "split") return "Split";
      if (raw === "paymentlink" || raw === "payment_link" || raw === "link") return "PaymentLink";
      return "";
    })();
    const isPaidAtTill = ["Cash", "UPI", "Card", "Split"].includes(normalizedPaymentMethod);
    // A paid delivery still has to be cooked and driven over: it goes through
    // the kitchen and out for delivery, and finishes at Delivered. Created
    // "Completed", it could never be marked out for delivery at all.
    const initialStatus = isPaidAtTill && normalizedOrderType !== "delivery" ? "Completed" : "Preparing";


    // EXPLICIT ALLOW-LIST — no spreading `...req.body` (mass-assignment).
    // Fields NOT taken from req.body: restaurantId, outletId, storeId,
    // createdBy, orderStatus, source, orderNumber, idempotencyKey (the
    // offline sync sets it on the request, never the client), paymentMethod,
    // payments, timeline, isDeleted, etc.
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200).map(sanitizeItem) : [];
    const sanitizedBills = sanitizeBills(bills || {});

    let cleanDeliveryAddress = sanitizeDeliveryAddress(deliveryAddress);
    if (!cleanDeliveryAddress && (custAddress || custPin)) {
      cleanDeliveryAddress = sanitizeDeliveryAddress({
        line1: custAddress,
        city: custCity,
        postalCode: custPin,
        instructions: custDeliveryNote,
      });
    }

    if (normalizedOrderType === "delivery") {
      if (!name) return next(createHttpError(400, "Customer name is required for delivery orders."));
      if (!phone) return next(createHttpError(400, "Customer phone is required for delivery orders."));
      if (!cleanDeliveryAddress || !cleanDeliveryAddress.line1) {
        return next(createHttpError(400, "Delivery address is required for delivery orders."));
      }
      if (!cleanDeliveryAddress.postalCode && custPin) {
        cleanDeliveryAddress.postalCode = custPin;
      }
      // An Indian PIN code. Any 20 characters used to be saved ("SA4 8DE").
      const pin = cleanDeliveryAddress.postalCode.replace(/\s/g, "");
      if (!/^[1-9]\d{5}$/.test(pin)) return next(createHttpError(400, "Enter a valid 6-digit pincode."));
      cleanDeliveryAddress.postalCode = pin;
      custPin = pin;
    }

    // GST is the store's to decide, not the till's: a GST number AND a rate,
    // for the system channel (services/gst, the rule table, QR and website
    // orders already use). The till used to send whatever its copy of the
    // settings said, and that was stored. A live till that priced with stale
    // or missing settings is sent back (409) rather than saving a total the
    // customer was never shown; an order synced from offline was already paid
    // for, so it is re-priced instead of refused.
    // What the till charged, before any re-pricing below. An order synced
    // from offline was paid at this figure: its payment lines (and a split's
    // parts) record it, or a split rung up on old settings was refused at sync.
    const tillTotal = Number(sanitizedBills?.totalWithTax ?? sanitizedBills?.total ?? 0) || 0;
    const gst = await require("../services/gst").resolveGstForRestaurant(req.user?.restaurantId, "system");
    const priced = require("../services/price").computeTotals({
      subtotal: sanitizedBills.subtotal,
      discount: sanitizedBills.discount,
      packagingFee: sanitizedBills.packagingFee,
      deliveryFee: sanitizedBills.deliveryFee,
      taxRate: gst.rate,
      taxInclusive: gst.inclusive,
    });
    if (!offlineSync && Math.abs(priced.totalWithTax - sanitizedBills.totalWithTax) > 0.05) {
      return next(createHttpError(409, "GST or charges changed since this till loaded them. Check the new total and finish again."));
    }
    Object.assign(sanitizedBills, {
      tax: priced.tax,
      taxPercent: priced.taxPercent,
      taxInclusive: priced.taxInclusive,
      totalWithTax: priced.totalWithTax,
    });

    // Delivery is priced here too: by the distance staff typed when the store
    // charges by distance slab (Rules & Charges), else the flat fee, waived
    // above freeDeliveryAbove -- the website's rule (orderPricingService).
    // Outside the tax base, so the GST above is unchanged. Same 409 / re-price
    // split as GST.
    if (normalizedOrderType === "delivery") {
      const settings = req.user?.restaurantId
        ? await require("../models/websiteSettingsModel").findOne({ restaurantId: req.user.restaurantId }).select("ordering").lean()
        : null;
      const ordering = settings?.ordering || {};
      const slabs = ordering.deliverySlabsConfig?.slabs || [];
      const km = cleanDeliveryAddress.distanceKm;
      const clientFee = sanitizedBills.deliveryFee;
      let fee = Number(ordering.deliveryFee) || 0;
      let problem = slabs.length && km === undefined ? "Enter the delivery distance (km)." : "";
      if (!problem && (slabs.length || km !== undefined)) {
        try {
          fee = computeDeliveryFeeFromSlabs({ distanceKm: km, slabsConfig: ordering.deliverySlabsConfig, defaultFee: fee });
        } catch (err) {
          problem = err.message;
        }
      }
      const freeAbove = Number(ordering.freeDeliveryAbove) || 0;
      if (freeAbove > 0 && sanitizedBills.subtotal >= freeAbove) fee = 0;

      if (problem) {
        // A delivery taken offline was already made; keep what the till charged.
        if (!offlineSync) return next(createHttpError(400, problem));
      } else if (Math.abs(fee - clientFee) > 0.05) {
        if (!offlineSync) {
          return next(createHttpError(409, `Delivery here is ₹${round2(fee).toFixed(2)}, not ₹${clientFee.toFixed(2)}. Check the new total and finish again.`));
        }
        sanitizedBills.deliveryFee = round2(fee);
        sanitizedBills.totalWithTax = round2(sanitizedBills.totalWithTax - clientFee + fee);
      }
    }

    // Build a canonical payments[] array for immediate-pay (Cash/UPI/Card/
    // Split) so paymentStatus rendering ("paid" vs "pending") is correct from
    // creation. For Pay-by-Link we omit payments — the payment link
    // controller pushes a "paid" entry once the customer actually pays.
    const paidAmount = offlineSync ? tillTotal : Number(sanitizedBills?.totalWithTax ?? sanitizedBills?.total ?? 0) || 0;
    let paymentsForOrder = [];
    let paymentLabel = normalizedPaymentMethod;
    if (normalizedPaymentMethod === "Split") {
      // One bill, several counter methods: the same rule as a table settle.
      // Each part keeps its own method, so the cash part reaches the drawer.
      const { validateSplits, splitLabel } = require("../services/splitPayment");
      const check = validateSplits(req.body?.splits, paidAmount);
      if (!check.ok) return next(createHttpError(400, check.message));
      paymentsForOrder = check.parts.map((p) => ({ method: SPLIT_PART_METHOD[p.method], amount: p.amount, status: "paid", transactionId: "" }));
      paymentLabel = splitLabel(check.parts, displayPaymentMethod);
    } else if (isPaidAtTill) {
      paymentsForOrder = [
        {
          method: normalizedPaymentMethod.toLowerCase(),
          amount: paidAmount,
          status: "paid",
          transactionId: "",
        },
      ];
    }

    // A discount is money off a sale, so it needs the Security PIN, as a void
    // does, unless the owner gives it. The till asks for the PIN when the
    // discount is applied; this is the enforcement. Offline-synced orders are
    // exempt: the sale already happened, a PIN token has long expired by sync
    // time, and refusing would lose it.
    // ponytail: a hand-crafted offline-sync request skips the PIN; audit-log offline discounts if that matters.
    if (sanitizedBills.discount > 0 && !offlineSync) {
      const { isOwnerUser, hasPinAuthorization, pinRequired } = require("../middlewares/requirePermission");
      if (!isOwnerUser(req.user) && !(await hasPinAuthorization(req))) return next(pinRequired());
    }

    // The CRM record is written only once every check above has passed, so a
    // refused order never counts as a visit.
    let customerId = null;

    if (name || phone) {
      const restaurantId = req.user?.restaurantId || req.user?._id;
      const outletId = req.user?.outletId;
      const totalAmount = sanitizedBills.totalWithTax;

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


    // Allocate a globally-unique, human-friendly order number BEFORE saving
    // (Module 3 §4). The generator is atomic per (restaurantId, source,
    // date) so two concurrent addOrder calls cannot receive the same
    // number. As additional protection, Order.orderNumber carries a
    // partial-unique index — a second Order.save with the same string will
    // fail with E11000 and the request will error, which is exactly what
    // we want (loud failure > silent duplicate).
    const orderNumber = await generateOrderNumberSafe({
      source: "POS",
      restaurantId: req.user?.restaurantId || null,
    });

    // Module 4 §4 — Automatic Preparing → Ready.
    // Compute readyDueAt server-side from the tenant's configured
    // autoReadyMinutes. If auto-ready is disabled (0 mins) or the order
    // type isn't eligible, readyDueAt stays null and the background
    // scheduler simply won't touch it.
    const readyDueAt = await computeReadyDueAt({
      restaurantId: req.user?.restaurantId || null,
      orderType: normalizedOrderType,
    });
    const completeDueAt = await computeCompleteDueAt({
      restaurantId: req.user?.restaurantId || null,
      orderType: normalizedOrderType,
    });

    const orderData = {
      customerDetails: {
        name,
        phone,
        guests,
        ...(custAddress ? { address: custAddress } : {}),
        ...(custCity ? { city: custCity } : {}),
        ...(custPin ? { pinCode: custPin } : {}),
        ...(custDeliveryNote ? { deliveryNote: custDeliveryNote } : {}),
        ...(buyer ? { company: buyer.company, gstin: buyer.gstin } : {}),
      },
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
      orderNumber,
      ...(readyDueAt ? { readyDueAt } : {}),
      ...(completeDueAt ? { completeDueAt } : {}),
      ...(paymentLabel ? { paymentMethod: paymentLabel } : {}),
      ...(paymentsForOrder.length ? { payments: paymentsForOrder } : {}),
      ...(normalizedPaymentMethod === "Split" ? { isSplit: true } : {}),
      timeline: [{ status: initialStatus, timestamp: new Date(), user: req.user?.name || "POS" }],
      ...(req.idempotencyKey ? { idempotencyKey: req.idempotencyKey } : {}),
    };



    const order = new Order(orderData);
    try {
      await order.save();
    } catch (err) {
      // Belt-and-braces: if the atomic counter ever produced a collision
      // (e.g. race with a manual DB insert), regenerate once and retry.
      if (err && err.code === 11000 && String(err?.keyPattern?.orderNumber) === "1") {
        order.orderNumber = await generateOrderNumberSafe({
          source: "POS",
          restaurantId: req.user?.restaurantId || null,
        });
        await order.save();
      } else if (isDuplicateKey(err) && err?.keyPattern?.idempotencyKey && !offlineSync) {
        // A retry raced the first attempt (or its offline sync) and lost: the
        // unique index kept one order, so answer with it.
        const winner = await Order.findOne({ restaurantId: req.user?.restaurantId, idempotencyKey: req.idempotencyKey });
        if (!winner) throw err;
        return res.status(200).json({ success: true, message: "Order already created", data: winner });
      } else {
        throw err;
      }
    }

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

    // A counter order paid at the till is created ALREADY "Completed" (see
    // initialStatus above), so it never passes through updateOrderStatus and
    // would never have fired the automatic e-bill -- silently missing the most
    // common order in the whole system. One that is not paid yet is
    // "Preparing", and fires later when it is completed or swept. A paid
    // delivery fires now (it is paid) and again at Delivered, which the
    // e-bill and the charge both ignore as already done.
    //
    // Fire-and-forget, and a no-op unless posSettings.autoEBill is on and the
    // order carries a phone number.
    if (isPaidAtTill) fireAutoEBill({ orderId: order._id });
    // Same trigger, different direction: the e-bill goes to the diner, this
    // settles the platform fee with the restaurant. A till order never carries
    // one, so it is only stamped "No platform fee was collected."
    if (isPaidAtTill) fireOrderCharge(order._id);

    // A POS order emitted nothing at all, so a second till, the KDS and the
    // Orders screen only learned about it on their next manual refresh.
    try {
      emitOrderCreated({
        restaurantId: order.restaurantId,
        outletId: order.outletId,
        storeId: order.storeId,
        order,
      });
    } catch (err) {
      console.warn("emitOrderCreated failed:", err.message);
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

    res.status(200).json({ success: true, data: { ...order.toObject(), ...refundView(order) } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/order
 *
 * Query params (Module 4 §6):
 *   - date        YYYY-MM-DD               single-day filter (tenant timezone-ish)
 *   - from / to   YYYY-MM-DD                inclusive date range
 *   - status      "Preparing" | "Ready" | ...  (comma-separated for multiple)
 *
 * Default when NO date/from/to is supplied: today's orders only.
 * Historical orders are never returned by default — the spec explicitly
 * forbids showing them on Orders open.
 *
 * Every day is the STORE's day (Asia/Kolkata), not the server's: the server
 * runs in UTC, so "today" used to start at 05:30 and an order at 02:00
 * landed in yesterday's report.
 *
 * All results also get `orderStatus` mapped to the canonical Module 4
 * vocabulary ("Preparing" instead of legacy "Pending"/"In Progress") so
 * the UI can render a single tab set without knowing about aliases.
 */
const buildDateWindow = (query, timeZone = DEFAULT_TZ) => {
  const parseDay = (s, endOfDay = false) => {
    if (!s || typeof s !== "string") return null;
    // Accept ISO date or YYYY-MM-DD. Anything else is silently ignored so
    // a bad query string does not surface as an internal error.
    let ymd = s;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return null;
      ymd = localDate(d, timeZone);
    }
    if (!endOfDay) return zonedInstant(ymd, "00:00", timeZone);
    const lastMinute = zonedInstant(ymd, "23:59", timeZone);
    return lastMinute && new Date(lastMinute.getTime() + 59999);
  };

  const { date, from, to } = query || {};

  if (date) {
    const start = parseDay(date, false);
    const end = parseDay(date, true);
    if (start && end) return { start, end, source: "single" };
  }

  if (from || to) {
    const start = parseDay(from, false) || parseDay(to, false);
    const end = parseDay(to, true) || parseDay(from, true);
    if (start && end && start <= end) return { start, end, source: "range" };
  }

  // Default: the store's today (00:00 → 23:59:59.999).
  const today = localDate(new Date(), timeZone);
  return { start: parseDay(today, false), end: parseDay(today, true), source: "today" };
};

const getOrders = async (req, res, next) => {
  try {
    const window = buildDateWindow(req.query);
    const filter = {
      ...tenantScopeFor(req.user),
      isDeleted: { $ne: true },
      createdAt: { $gte: window.start, $lte: window.end },
    };

    if (req.query.status) {
      const statuses = String(req.query.status)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (statuses.length) filter.orderStatus = { $in: statuses };
    }

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .populate("table");

    // Present the canonical Module 4 status name to the UI. We do NOT
    // rewrite the underlying document — the KDS + KDS-driven workflows
    // still write "In Progress" and we want them to keep working — this
    // is purely a read-time projection.
    const projected = orders.map((o) => {
      const obj = o.toObject ? o.toObject() : o;
      obj.orderStatus = canonicalStatus(obj.orderStatus);
      // How it was paid and where a refund stands, decided here, not by the screen.
      Object.assign(obj, refundView(obj));
      return obj;
    });

    res.status(200).json({
      data: projected,
      window: {
        from: window.start.toISOString(),
        to: window.end.toISOString(),
        source: window.source,
      },
    });
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

    if (canonicalStatus(orderStatus) === OUT_FOR_DELIVERY && order.orderType !== "delivery") {
      return next(createHttpError(400, "Only delivery orders can go out for delivery."));
    }

    // Reject transitions out of terminal states — you cannot un-cancel or
    // un-complete an order via this endpoint (§17 business logic).
    // isFinished, not TERMINAL_STATUSES.has: the latter holds only the three
    // canonical names, so "Served", "Delivered", "paid" and the legacy
    // lowercase spellings slipped past and a finished order could be reopened.
    //
    // One exception: a PAID (settled) order may be voided through the reasoned,
    // PIN-guarded cancel route. Cancelling and refunding are separate: a
    // gateway payment is refunded afterwards through refundOrder, cash is
    // handed back at the counter, and the order records which.
    //
    // Paid means settled OR money already taken: a delivery paid at the till
    // is still cooking (Preparing) but is no less a sale.
    const paid = isSettled(order.orderStatus) || wasPaid(order);
    const cancelling = canonicalStatus(orderStatus) === CANCELLED;
    const voidingPaid = Boolean(req.voidWithReason) && cancelling && paid;
    // A paid order is voided by the owner or a manager only, with a reason;
    // the Security PIN alone is not enough for undoing a sale.
    if (voidingPaid && !require("../middlewares/requirePermission").isManagerUser(req.user)) {
      return next(createHttpError(403, "Only the store owner or a manager can cancel a paid order."));
    }
    if (cancelling && paid && !voidingPaid && !isFinished(order.orderStatus)) {
      return next(createHttpError(409, "This order is paid. Cancel it from Orders, with a reason."));
    }
    if (isFinished(order.orderStatus) && canonicalStatus(order.orderStatus) !== canonicalStatus(orderStatus) && !voidingPaid) {
      return next(
        createHttpError(409, `Order is already ${order.orderStatus.toLowerCase()} and cannot be changed.`)
      );
    }
    // Cancelling a table's ticket here voids what is on the table, like
    // voiding a dish there: staff need the Security PIN. (The reasoned cancel
    // route has already checked it.)
    if (cancelling && !req.voidWithReason && order.tableSessionId) {
      const { isOwnerUser, hasPinAuthorization, pinRequired } = require("../middlewares/requirePermission");
      if (!isOwnerUser(req.user) && !(await hasPinAuthorization(req))) return next(pinRequired());
    }

    // Normalise legacy input aliases to the canonical Module 4 name.
    const nextStatus = canonicalStatus(orderStatus);
    order.orderStatus = nextStatus;
    order.timeline = order.timeline || [];
    order.timeline.push({
      status: nextStatus,
      timestamp: new Date(),
      user: req.user?.name || "POS",
    });
    if (nextStatus === CANCELLED && typeof req.body?.reason === "string") {
      order.cancelReason = req.body.reason.trim().slice(0, 200);
      order.cancelledBy = req.user?.name || "POS";
    }

    // Module 4 §2 — if the update transitions to Ready, stamp the Ready
    // metadata, emit the socket event and fire the (idempotent) SMS. The
    // notification service handles duplicate suppression so a manual
    // mark-ready followed by the auto-ready timer will only send once.
    let readyTransition = false;
    if (nextStatus === "Ready" && !order.readyAt) {
      order.readyAt = new Date();
      order.readyBy = "STAFF";
      readyTransition = true;
    }

    const lowerNext = String(nextStatus).toLowerCase();
    let settledTransition = false;
    if (["completed", "delivered", "served", "cancelled", "refunded"].includes(lowerNext)) {
      order.completeDueAt = null;
      if (["completed", "delivered", "served"].includes(lowerNext) && !order.completedAt) {
        order.completedAt = new Date();
        order.completedBy = "STAFF";
        settledTransition = true;
      }
    } else if (!order.completeDueAt && !order.completedAt) {
      const computed = await computeCompleteDueAt({
        restaurantId: order.restaurantId,
        storeId: order.storeId,
        orderType: order.orderType,
      });
      if (computed) order.completeDueAt = computed;
    }

    await order.save();

    // EVERY transition is broadcast, not only the one to Ready.
    //
    // This used to sit inside `if (readyTransition)`, so a screen listening
    // for changes heard about an order becoming Ready and nothing else --
    // completing, cancelling or settling one left every other till showing
    // the old status until somebody reloaded the page.
    try {
      emitOrderStatusChanged({
        restaurantId: order.restaurantId,
        outletId: order.outletId,
        storeId: order.storeId,
        order,
      });
    } catch (err) {
      console.warn("emitOrderStatusChanged failed:", err.message);
    }

    if (readyTransition) {
      // Fire-and-forget SMS; errors are logged inside the service.
      notifyOrderReady(order).catch((err) => {
        console.warn("notifyOrderReady failed:", err.message);
      });
    }

    // The order is finished, so the bill is final. Fire-and-forget for the
    // same reason as the ready SMS: the operator is being told their status
    // change worked, and a messaging problem must not turn that into an error.
    // Does nothing unless posSettings.autoEBill is on for this restaurant.
    if (settledTransition) fireAutoEBill({ orderId: order._id });
    if (settledTransition) fireOrderCharge(order._id);

    // Cancelling wrote orderStatus and stopped. The table session and the
    // Table were never told, so Manage Tables kept the table occupied and the
    // diner's QR page kept the dishes. Required lazily: tableSessionController
    // requires this file back.
    if (canonicalStatus(nextStatus) === CANCELLED) {
      // A platform fee already debited for this order goes back to the wallet.
      fireOrderChargeReversal(order._id);
      try {
        const { releaseSessionForCancelledOrder } = require("./tableSessionController");
        await releaseSessionForCancelledOrder(order, req.user?.name || "POS");
      } catch (err) {
        console.warn("releaseSessionForCancelledOrder failed:", err.message);
      }
    }

    // Return canonical status to the client too.
    const projected = order.toObject();
    projected.orderStatus = canonicalStatus(projected.orderStatus);
    res
      .status(200)
      .json({ success: true, message: "Order updated", data: projected });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/order/:id/ready
 *
 * Module 4 §2 — dedicated "Mark Ready" action for staff.
 *
 * A thin, semantic wrapper around updateOrder({ orderStatus: "Ready" })
 * that:
 *   - refuses to run against terminal or already-Ready orders
 *   - stamps readyAt / readyBy = "STAFF"
 *   - emits the realtime status event
 *   - triggers the customer notification (idempotent, phone-required)
 *
 * We keep updateOrder as the generic status endpoint so KDS + Cancel
 * flows continue to work, but expose this dedicated one so the POS
 * "Mark Ready" button reads clearly server-side too.
 */
const markOrderReady = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    const order = await Order.findOne({
      _id: id,
      ...tenantScopeFor(req.user),
      isDeleted: { $ne: true },
    });
    if (!order) return next(createHttpError(404, "Order not found!"));

    // A takeaway paid at the till is created Completed but still has to be
    // cooked, so the kitchen screen lists it. Its Ready stamps readyAt (and
    // tells the customer); the sale stays Completed.
    const paidTakeaway =
      isSettled(order.orderStatus) && !order.readyAt && order.source === "POS" && !["dine-in", "delivery"].includes(order.orderType);
    if (isFinished(order.orderStatus) && !paidTakeaway) {
      return next(
        createHttpError(409, `Order is already ${order.orderStatus.toLowerCase()} and cannot be changed.`)
      );
    }
    if (order.orderStatus === READY) {
      // Idempotent — return the current state without re-firing SMS/emit.
      const projected = order.toObject();
      projected.orderStatus = canonicalStatus(projected.orderStatus);
      return res
        .status(200)
        .json({ success: true, message: "Order already ready", data: projected });
    }

    if (!paidTakeaway) order.orderStatus = READY;
    order.readyAt = new Date();
    order.readyBy = "STAFF";
    order.timeline = order.timeline || [];
    order.timeline.push({
      status: "Ready",
      timestamp: new Date(),
      user: req.user?.name || "POS",
    });
    await order.save();

    try {
      emitOrderStatusChanged({
        restaurantId: order.restaurantId,
        outletId: order.outletId,
        storeId: order.storeId,
        order,
      });
    } catch (err) {
      console.warn("emitOrderStatusChanged failed:", err.message);
    }

    let notification = { sent: false, reason: "not_attempted" };
    try {
      notification = await notifyOrderReady(order);
    } catch (err) {
      console.warn("notifyOrderReady failed:", err.message);
      notification = { sent: false, reason: err.message };
    }

    const projected = order.toObject();
    projected.orderStatus = canonicalStatus(projected.orderStatus);
    res.status(200).json({
      success: true,
      message: "Order marked ready",
      data: projected,
      notification,
    });
  } catch (error) {
    next(error);
  }
};


/**
 * GET /api/order/report
 *
 * Module 5 — Reports payload for the selected period. Everything derives
 * from REAL orders in the database (no synthetic figures).
 *
 * Query params:
 *   date=YYYY-MM-DD                — single day (default: today)
 *   from=YYYY-MM-DD&to=YYYY-MM-DD  — inclusive date range
 *
 * Every card is a count and a value, and the three groups are independent:
 *
 *   Source — where the order was STARTED. Written once when the order is
 *   created and never changed by how it is paid, so a till order settled
 *   through the table QR is still a System order.
 *     System   = POS / PHONE (and anything unrecognised — our own channels)
 *     Website  = WEBSITE (collection and delivery from the store site)
 *     Table QR = QR
 *     Outside  = MARKETPLACE (Swiggy, Zomato, ...)
 *
 *   Payment method — how it was paid. Every order is in exactly one, so
 *   the cards add up to the total: an unpaid order (or one paid some other
 *   way) is "Unpaid / Other".
 *     Cash / UPI / Card / Gateway / Split / Other
 *
 *   Tips — left at a table settle. Not sales, so outside every other card.
 *
 *   Type — Delivery / Collection.
 *
 * Cancelled orders count as orders but never add value — otherwise a
 * big refund could inflate today's takings.
 */
const REPORT_METHOD = {
  cash: "cash",
  upi: "upi",
  qr_code: "upi",
  qr: "upi",
  online: "gateway",
  "payment gateway": "gateway",
  "pay by link": "gateway",
  paymentlink: "gateway",
  payment_link: "gateway",
  link: "gateway",
  card: "card",
  split: "split",
};

const reportMethodOf = (o) => {
  // Only money that went through the gateway has a gateway payment id. A paid
  // pay-by-link order is rewritten to the instrument (upi/card), and a counter
  // settle carries an empty one.
  if (o.paymentData?.gatewayPaymentId) return "gateway";
  if (o.isSplit) return "split";
  const raw = o.payments?.[0]?.method || o.paymentMethod || "";
  return REPORT_METHOD[String(raw).trim().toLowerCase()] || "other";
};

const PAYMENT_LABELS = { cash: "Cash", upi: "UPI", card: "Card", gateway: "Payment Gateway" };

/**
 * One order as Reports shows it: the canonical status, the payment method
 * named after the card it is counted in, and the customer's phone masked.
 * Reports is a list of everyone's numbers, so it never shows one in full,
 * not even today's (the Orders screen does, for delivery calls and e-bills).
 */
const reportOrderView = (o) => {
  const obj = o.toObject ? o.toObject() : o;
  obj.orderStatus = canonicalStatus(obj.orderStatus);
  if (obj.customerDetails?.phone) obj.customerDetails.phone = maskPhone(obj.customerDetails.phone);
  const method = reportMethodOf(obj);
  obj.paymentLabel = PAYMENT_LABELS[method] || obj.paymentMethod || "—";
  return obj;
};

const { netAmount, wasPaid, refundCancelledOrder, syncRefund, refundView, REFUND_STATUS } = require("../services/refunds");

/**
 * PUT /api/order/:id/cancel  { reason }
 *
 * A void with a reason on record. Same state change as PUT /:id with
 * Cancelled, but the reason is required and the route is PIN-protected, so
 * a mis-punched order cannot quietly disappear. A PAID order may be voided
 * this way too: the money is a separate matter (see refundOrder), which is
 * why only this route, not the plain status update, may do it.
 */
const cancelOrder = async (req, res, next) => {
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 3) return next(createHttpError(400, "A reason is required to cancel an order."));
  req.body = { orderStatus: CANCELLED, reason };
  req.voidWithReason = true;
  return updateOrder(req, res, next);
};

/**
 * POST /api/order/:id/refund  { reason? }
 *
 * Refund a CANCELLED order that was paid through Cashfree, through Cashfree.
 * The backend decides everything: whether the order exists and is this
 * store's, that it is cancelled, that it was paid and by which kind of
 * payment, what was paid and what has already gone back, and whether an
 * attempt is already in flight. The browser sends a reason and nothing else.
 * Cash and counter UPI/card orders are refused: there is nothing to send.
 */
const refundOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(404, "Invalid id!"));
    const order = await Order.findOne({ _id: id, ...tenantScopeFor(req.user), isDeleted: { $ne: true } });
    if (!order) return next(createHttpError(404, "Order not found!"));

    const { entry, amount } = await refundCancelledOrder(order, { user: req.user, reason: req.body?.reason, amount: req.body?.amount });

    await logActivity({
      req,
      action: "Order Refund " + entry.status,
      resource: "Order",
      resourceId: order._id,
      newValue: `₹${amount.toFixed(2)} via Cashfree (${entry.gateway?.refundId || ""}): ${entry.status}${entry.failureReason ? " - " + entry.failureReason : ""}`,
      description: `Refund on #${order.orderNumber || order._id}: ${entry.reason}`,
    });

    try {
      const { emitOrderStatusChanged } = require("../services/socket");
      emitOrderStatusChanged({ restaurantId: order.restaurantId, outletId: order.outletId, storeId: order.storeId, order });
    } catch (err) {
      console.warn("[refund] socket emit failed:", err.message);
    }

    const view = refundView(order);
    const message =
      view.refundStatus === REFUND_STATUS.REFUNDED
        ? `₹${amount.toFixed(2)} refunded through Cashfree.`
        : view.refundStatus === REFUND_STATUS.REFUND_PENDING
          ? `Cashfree has accepted the refund of ₹${amount.toFixed(2)}; it reaches the customer in 5 to 7 working days.`
          : `Cashfree did not complete the refund: ${entry.failureReason}`;
    res.status(view.refundStatus === REFUND_STATUS.REFUND_FAILED ? 502 : 200).json({
      success: view.refundStatus !== REFUND_STATUS.REFUND_FAILED,
      message,
      data: { ...order.toObject(), ...view },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/order/:id/refund/sync
 *
 * Ask Cashfree where the open refund stands and record its answer. For a
 * refund Cashfree is still processing, or an attempt that timed out before
 * it could be confirmed.
 */
const syncOrderRefund = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(404, "Invalid id!"));
    const order = await Order.findOne({ _id: id, ...tenantScopeFor(req.user), isDeleted: { $ne: true } });
    if (!order) return next(createHttpError(404, "Order not found!"));
    const { entry, changed } = await syncRefund(order);
    if (!entry) return res.status(200).json({ success: true, message: "No refund is waiting on Cashfree.", data: { ...order.toObject(), ...refundView(order) } });
    res.status(200).json({
      success: true,
      message: changed ? `Cashfree reports the refund as ${entry.status.toLowerCase()}.` : `Still ${entry.status.toLowerCase()} at Cashfree.`,
      data: { ...order.toObject(), ...refundView(order) },
    });
  } catch (error) {
    next(error);
  }
};

const buildReportBuckets = (orders) => {
  const bucket = () => ({ count: 0, amount: 0 });
  const summary = {
    total: bucket(),
    system: bucket(),
    website: bucket(),
    knotEats: bucket(),
    tableQr: bucket(),
    outside: bucket(),
    cash: bucket(),
    upi: bucket(),
    gateway: bucket(),
    card: bucket(),
    split: bucket(),
    other: bucket(),
    tips: bucket(),
    delivery: bucket(),
    collection: bucket(),
  };

  const inc = (b, amt) => {
    b.count += 1;
    b.amount = Math.round((b.amount + amt) * 100) / 100;
  };

  for (const o of orders) {
    // A cancelled order was never a sale: it is in no card, count or value
    // (as in the dish, category, hour and staff breakdowns).
    if (canonicalStatus(o.orderStatus) === CANCELLED) continue;
    // Takings after refunds; a fully refunded order counts but adds nothing.
    const amount = netAmount(o);

    inc(summary.total, amount);

    const source = String(o.source || "").toUpperCase();
    if (source === "MARKETPLACE") inc(summary.outside, amount);
    // Knot Eats orders are website orders by source; their own card keeps the
    // source cards summing to the total.
    else if (source === "WEBSITE") inc(o.salesChannel === "KNOT_EATS" ? summary.knotEats : summary.website, amount);
    else if (source === "QR") inc(summary.tableQr, amount);
    else inc(summary.system, amount);

    inc(summary[reportMethodOf(o)], amount);
    const tip = Number(o.bills?.tip || o.tips) || 0;
    if (tip > 0) inc(summary.tips, tip);

    const type = String(o.orderType || "").toLowerCase();
    if (type === "delivery") inc(summary.delivery, amount);
    else if (type === "collection" || type === "takeaway") inc(summary.collection, amount);
  }

  return summary;
};

const getOrdersReport = async (req, res, next) => {
  try {
    const window = buildDateWindow(req.query);
    const filter = {
      ...tenantScopeFor(req.user),
      isDeleted: { $ne: true },
      createdAt: { $gte: window.start, $lte: window.end },
    };

    // Every order in the period: the totals used to come from the newest
    // 1,000 only, so a busy month silently dropped its oldest orders.
    // ponytail: totals in memory; move them to a $group if one period ever runs to tens of thousands of orders.
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .populate("table")
      .populate("createdBy", "name")
      .lean();

    // Canonical status (Preparing instead of legacy Pending / In Progress)
    // so the frontend can drive its filters from a single vocabulary.
    const projected = orders.map(reportOrderView);

    const summary = buildReportBuckets(projected);

    // By dish / category / hour / staff. Categories come from the tenant's
    // menus: a line only carries the dish, not the category it sat in.
    const { buildReportBreakdown, categoryLookup } = require("../services/reportBreakdown");
    const menus = await getMenuModel()
      .find(req.user?.restaurantId ? { restaurantId: req.user.restaurantId } : { createdBy: req.user?._id })
      .select("name items._id items.name")
      .lean();
    const breakdown = buildReportBreakdown(projected, { categoryOf: categoryLookup(menus) });

    await logActivity({
      req,
      action: "Accessed Reports",
      resource: "Reports",
      description: `Accessed order & financial report for window: ${localDate(window.start)} to ${localDate(window.end)}`,
    });

    res.status(200).json({
      success: true,
      data: {
        window: {
          from: window.start.toISOString(),
          to: window.end.toISOString(),
          source: window.source,
        },
        summary,
        breakdown,
        // The list is capped for the browser; the cards above are not.
        orders: projected.slice(0, 1000),
        truncated: projected.length > 1000,
      },
    });
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

      // Same rule as menuScopeFor(): the tenant ALONE, with createdBy only
      // as a fallback for a user that has no restaurantId. The $or that
      // used to be here was a union, so a creator with two takeaways got
      // the other one's dishes suggested here -- exactly what the comment
      // above promises can never happen.
      ...(req.user?.restaurantId
        ? { restaurantId: req.user.restaurantId }
        : { createdBy: req.user?._id }),
      isDeleted: { $ne: true },
    });

    // POS surface: index the System Published catalogue (visibility from the
    // published flags), so "popular dishes" can never suggest an item the
    // tills are not serving yet.
    const publishedMenus = projectMenus(menus, AUDIENCES.SYSTEM);

    const dishesById = new Map();
    const dishesByName = new Map();
    publishedMenus.forEach((menu) => {
      (menu.items || []).forEach((item) => {
        const enriched = {
          // Snapshot items come through as plain objects, live subdocuments do
          // not — accept either.
          ...(typeof item.toObject === "function" ? item.toObject() : item),
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
      publishedMenus.forEach((menu) => {
        (menu.items || []).forEach((item) => {
          if (item.isAvailable === false) return;
          fallbackCandidates.push({
            ...(typeof item.toObject === "function" ? item.toObject() : item),
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
  markOrderReady,
  cancelOrder,
  refundOrder,
  syncOrderRefund,
  getPopularItems,
  getOrdersReport,
  validateTableCapacityForOrder,
  // Exposed for other controllers/services that need consistent
  // canonicalisation (e.g. onlineOrderController projecting to the POS view).
  canonicalStatus,
  buildReportBuckets,
  buildDateWindow,
  reportOrderView,
};



