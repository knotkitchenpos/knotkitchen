const createHttpError = require("http-errors");
const crypto = require("crypto");
const Menu = require("../models/menuModel");
const Order = require("../models/orderModel");
const Customer = require("../models/customerModel");
const { resolveStorefront, REASON_MESSAGES } = require("../services/storefrontResolver");
const { isStoreOpen, isItemAvailableNow, getEffectivePrice } = require("../services/businessHours");
const { calculateOrderTotals, PricingError } = require("../services/orderPricingService");
const { getTheme } = require("../services/themeRegistry");
const { emitOrderCreated } = require("../services/socket");
const { generateOrderNumberSafe } = require("../services/orderNumberService");
const { computeReadyDueAt } = require("../services/autoReadyService");


/**
 * Public storefront API (§16, §30).
 *
 * Everything here is UNAUTHENTICATED, so two rules are absolute:
 *  1. The tenant is resolved from the URL identifier via resolveStorefront().
 *     A storeId in the request body is ALWAYS ignored.
 *  2. Only public-safe fields are serialized. Costs, supplier data, internal
 *     ids, POS user info and version history never leave this layer.
 */

/** Serialize a menu item for public consumption. */
const toPublicProduct = (item, menu, timezone) => {
  const effectivePrice = getEffectivePrice(item, timezone);
  const hasDiscount =
    item.discountPrice !== null &&
    item.discountPrice !== undefined &&
    Number(item.discountPrice) > 0 &&
    Number(item.discountPrice) < effectivePrice;

  return {
    id: item._id,
    menuId: menu._id,
    name: item.name,
    description: item.description || "",
    category: item.category || menu.name,
    // `price` is what the customer pays; `originalPrice` drives strike-through.
    price: hasDiscount ? Number(item.discountPrice) : effectivePrice,
    originalPrice: hasDiscount ? effectivePrice : null,
    image: item.imageUrl || item.image || "",
    thumbnail: item.imageThumbnailUrl || item.imageUrl || item.image || "",
    imageAlt: item.imageAlt || item.name,
    isVegetarian: Boolean(item.isVegetarian),
    isAvailable: isItemAvailableNow(item, timezone),
    isFeatured: Boolean(item.isFeatured),
    isCombo: Boolean(item.isCombo),
    comboDescription: item.comboDescription || "",
    allergens: item.allergens || [],
    nutrition: item.nutrition || {},
    sortOrder: Number(item.sortOrder) || 0,

    variants: (item.variants || [])
      .filter((v) => v.isAvailable !== false)
      .map((v) => ({ id: v._id, name: v.name, price: Number(v.price) || 0 })),

    addons: (item.addons || [])
      .filter((a) => a.isAvailable !== false)
      .map((a) => ({ id: a._id, name: a.name, price: Number(a.price) || 0 })),

    modifierGroups: (item.modifierGroups || []).map((g) => ({
      id: g._id,
      name: g.name,
      required: Boolean(g.required),
      minSelections: Number(g.minSelections) || 0,
      maxSelections: Number(g.maxSelections) || 1,
      groupType: g.groupType || "addon",
      options: (g.options || [])
        .filter((o) => o.isAvailable !== false)
        .map((o) => ({ id: o._id, name: o.name, price: Number(o.price) || 0 })),
    })),
  };
};

/**
 * Build the complete storefront payload from LIVE POS data.
 * The POS menu is the single source of truth — there is no separate website
 * menu collection (§8).
 */
const buildStorefrontPayload = async ({ settings, restaurantId, storeId, timezone, restaurant, preview = false }) => {
  // Hard tenant filter: only this restaurant's published menus.
  const menus = restaurantId
    ? await Menu.find({
        restaurantId,
        isDeleted: { $ne: true },
        // Older menus used isPublished; new menus use published. Accept both
        // so a legacy POS menu does not silently disappear from the website.
        $or: [{ published: true }, { published: { $exists: false }, isPublished: true }],
      }).sort({ createdAt: 1 })
    : [];

  const categories = [];
  for (const menu of menus) {
    // Respect category-level scheduling (e.g. a "Breakfast" menu).
    const menuActive = !menu.schedule?.enabled || isItemAvailableNow({ isAvailable: true, schedule: menu.schedule }, timezone);
    if (!menuActive) continue;

    // Module 9 §3 — Storefront reads Website Published Menu snapshot
    const activeItems = menu.hasPublishedToWebsite && menu.websiteSnapshot?.items
      ? menu.websiteSnapshot.items
      : menu.items || [];
    const activeName = menu.hasPublishedToWebsite && menu.websiteSnapshot?.name
      ? menu.websiteSnapshot.name
      : menu.name;

    const products = activeItems
      .filter((item) => item.showOnWebsite !== false && item.displayTarget !== "system")
      .map((item) => toPublicProduct(item, menu, timezone))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    if (!products.length) continue;

    categories.push({
      id: menu._id,
      name: activeName,
      icon: menu.icon || "",
      bgColor: menu.bgColor || "",
      isActive: menuActive,
      products,
    });
  }


  const now = new Date();
  const activeHoliday = (settings?.holidays || []).find((h) => {
    const start = new Date(h.startDate);
    const end = new Date(h.endDate);
    end.setHours(23, 59, 59, 999);
    return now >= start && now <= end;
  });

  const openState = preview
    ? { isOpen: true, reason: "", nextOpen: null }
    : activeHoliday
    ? { isOpen: false, reason: `Store is Closed (${activeHoliday.reason || "Holiday"})`, nextOpen: activeHoliday.endDate }
    : isStoreOpen(settings, timezone);


  const theme = getTheme(settings.theme?.themeKey) || getTheme("default-restaurant");

  return {
    store: {
      storeId,
      slug: settings.slug,
      name: settings.displayName || restaurant?.name || "",
      isOpen: openState.isOpen,
      closedReason: openState.reason,
      nextOpen: openState.nextOpen,
      acceptingOrders: openState.isOpen || Boolean(settings.ordering?.acceptPreOrders),
    },
    branding: {
      siteTitle: settings.branding?.siteTitle || settings.displayName || "",
      siteDescription: settings.branding?.siteDescription || "",
      tagline: settings.branding?.tagline || "",
      aboutText: settings.branding?.aboutText || "",
      logo: settings.branding?.logo?.url || "",
      favicon: settings.branding?.favicon?.url || "",
      coverImage: settings.branding?.coverImage?.url || "",
      coverImageAlt: settings.branding?.coverImage?.alt || "",
    },
    theme: {
      key: settings.theme?.themeKey || "default-restaurant",
      name: theme?.name || "",
      colors: settings.theme?.colors || {},
      typography: settings.theme?.typography || {},
      layout: settings.theme?.layout || {},
      sections: settings.theme?.sections || {},
    },
    ordering: {
      pickupEnabled: settings.ordering?.pickupEnabled !== false,
      deliveryEnabled: Boolean(settings.ordering?.deliveryEnabled),
      minOrderValue: Number(settings.ordering?.minOrderValue) || 0,
      deliveryFee: Number(settings.ordering?.deliveryFee) || 0,
      freeDeliveryAbove: Number(settings.ordering?.freeDeliveryAbove) || 0,
      packagingFee: Number(settings.ordering?.packagingFee) || 0,
      taxPercent: Number(settings.ordering?.taxPercent) || 0,
      taxInclusive: Boolean(settings.ordering?.taxInclusive),
      currency: settings.ordering?.currency || "INR",
      currencySymbol: settings.ordering?.currencySymbol || "₹",
      prepTimeMinutes: Number(settings.ordering?.prepTimeMinutes) || 30,
      acceptPreOrders: settings.ordering?.acceptPreOrders !== false,
      specialInstructionsEnabled: settings.ordering?.specialInstructionsEnabled !== false,
    },
    contact: settings.contact || {},
    offers: (settings.offers || [])
      .filter((o) => o.isActive)
      .map((o) => ({
        title: o.title,
        description: o.description,
        code: o.code,
        image: o.image?.url || "",
      })),
    openingHours: settings.useBusinessHours ? settings.openingHours || [] : [],
    categories,
  };
};

/** Shared guard: resolve tenant or respond with a friendly public error. */
const requireStorefront = async (req, next) => {
  const result = await resolveStorefront({
    identifier: req.params.slug,
    host: req.headers.host,
  });

  if (!result.ok) {
    const error = createHttpError(
      result.status || 404,
      REASON_MESSAGES[result.reason] || "Store unavailable."
    );
    error.reason = result.reason;
    next(error);
    return null;
  }
  return result;
};

/** GET /api/storefront/:slug — full site payload (branding + theme + menu). */
const getStorefront = async (req, res, next) => {
  try {
    const ctx = await requireStorefront(req, next);
    if (!ctx) return;

    const payload = await buildStorefrontPayload(ctx);

    // Short public cache: menus change rarely, and this keeps repeat loads fast
    // while still reflecting price/availability edits within a minute (§23).
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    res.status(200).json({ success: true, data: payload });
  } catch (error) {
    next(error);
  }
};

/** GET /api/storefront/:slug/menu — menu only (lighter payload). */
const getStorefrontMenu = async (req, res, next) => {
  try {
    const ctx = await requireStorefront(req, next);
    if (!ctx) return;

    const payload = await buildStorefrontPayload(ctx);
    res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    res.status(200).json({ success: true, data: { categories: payload.categories, store: payload.store } });
  } catch (error) {
    next(error);
  }
};

/** GET /api/storefront/:slug/products/:id — single product detail. */
const getStorefrontProduct = async (req, res, next) => {
  try {
    const ctx = await requireStorefront(req, next);
    if (!ctx) return;

    const payload = await buildStorefrontPayload(ctx);
    const product = payload.categories
      .flatMap((c) => c.products)
      .find((p) => String(p.id) === String(req.params.id));

    if (!product) return next(createHttpError(404, "Item not found."));

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/storefront/:slug/orders — create an online order (§9, §11, §15).
 *
 * The request body may only contain identifiers, quantities and customer
 * contact details. Prices, taxes, fees, storeId and restaurantId are all
 * derived server-side.
 */
const createStorefrontOrder = async (req, res, next) => {
  try {
    const ctx = await requireStorefront(req, next);
    if (!ctx) return;

    const { settings, restaurantId, storeId, timezone, outletId } = ctx;
    const body = req.body || {};

    if (!restaurantId) {
      return next(createHttpError(503, "This restaurant is not accepting online orders yet."));
    }

    // ---- Order type ----
    const requestedType = String(body.orderType || "pickup").toLowerCase();
    if (!["pickup", "delivery"].includes(requestedType)) {
      return next(createHttpError(400, "Invalid order type."));
    }

    // ---- Module 7 §7: Holiday calendar gate ----
    const now = new Date();
    const activeHoliday = (settings?.holidays || []).find((h) => {
      const start = new Date(h.startDate);
      const end = new Date(h.endDate);
      end.setHours(23, 59, 59, 999);
      return now >= start && now <= end;
    });
    if (activeHoliday) {
      return next(createHttpError(409, `Store is Closed: ${activeHoliday.reason || "Holiday"}`));
    }

    // ---- Business hours / pre-order gate ----
    const openState = isStoreOpen(settings, timezone);
    if (!openState.isOpen && !settings.ordering?.acceptPreOrders) {
      return next(createHttpError(409, "The restaurant is currently closed and is not accepting pre-orders."));
    }

    if (requestedType === "pickup" && settings.ordering?.pickupEnabled === false) {
      return next(createHttpError(409, "This restaurant does not offer pickup."));
    }
    if (requestedType === "delivery" && settings.ordering?.deliveryEnabled !== true) {
      return next(createHttpError(409, "This restaurant does not offer delivery."));
    }


    // ---- Customer details ----
    const name = String(body.customer?.name || "").trim().slice(0, 120);
    const phone = String(body.customer?.phone || "").replace(/\D/g, "").slice(0, 15);
    if (!name) return next(createHttpError(400, "Please enter your name."));
    if (phone.length < 7) return next(createHttpError(400, "Please enter a valid phone number."));
    const email = String(body.customer?.email || "").trim().slice(0, 160);

    let deliveryAddress;
    if (requestedType === "delivery") {
      const line1 = String(body.deliveryAddress?.line1 || "").trim().slice(0, 200);
      if (!line1) return next(createHttpError(400, "Please enter your delivery address."));
      deliveryAddress = {
        line1,
        line2: String(body.deliveryAddress?.line2 || "").trim().slice(0, 200),
        city: String(body.deliveryAddress?.city || "").trim().slice(0, 100),
        postalCode: String(body.deliveryAddress?.postalCode || "").trim().slice(0, 20),
        instructions: String(body.deliveryAddress?.instructions || "").trim().slice(0, 300),
      };
    }

    // ---- Idempotency (§32) ----
    // A repeated submit (double-click, retry after a dropped response) returns
    // the ORIGINAL order instead of creating a duplicate.
    const rawKey = String(body.idempotencyKey || "").trim().slice(0, 100);
    const idempotencyKey = rawKey
      ? crypto.createHash("sha256").update(`${storeId}:${rawKey}`).digest("hex").slice(0, 40)
      : "";

    if (idempotencyKey) {
      const existing = await Order.findOne({ restaurantId, idempotencyKey });
      if (existing) {
        return res.status(200).json({
          success: true,
          message: "Order already placed",
          duplicate: true,
          data: publicOrderView(existing),
        });
      }
    }

    // ---- Authoritative pricing against this store's own menus ----
    const menus = await Menu.find({
      restaurantId,
      isDeleted: { $ne: true },
      $or: [{ published: true }, { published: { $exists: false }, isPublished: true }],
    });

    let priced;
    try {
      priced = calculateOrderTotals({
        items: body.items,
        menus,
        settings,
        orderType: requestedType,
        source: "WEBSITE",
        customerAddress: deliveryAddress,
        storeAddress: ctx.restaurant?.address,
        couponCode: body.couponCode,
        timezone,
      });
    } catch (err) {
      if (err instanceof PricingError) return next(createHttpError(err.status || 400, err.message));
      throw err;
    }


    // ---- Scheduled / pre-order time (Website Module 6: Collection Order Scheduling) ----
    let scheduledFor = null;
    if (body.scheduledFor) {
      const when = new Date(body.scheduledFor);
      if (Number.isNaN(when.getTime())) {
        return next(createHttpError(400, "Invalid scheduled pickup time."));
      }

      const nowTime = Date.now();
      const pickupWindowHours = Number(settings?.ordering?.pickupWindowHours) || 5; // Default 5 hours, configurable 5-6 hours
      const maxAhead = nowTime + pickupWindowHours * 60 * 60 * 1000;

      const isPast = when.getTime() < nowTime - 60000;
      const isDifferentDay = when.toDateString() !== new Date(nowTime).toDateString();
      const isTooFarAhead = when.getTime() > maxAhead;

      if (isPast) {
        return next(createHttpError(400, "Collection pickup time cannot be in the past."));
      }
      if (isDifferentDay) {
        return next(createHttpError(400, "Collection orders may only be scheduled within the current business day."));
      }
      if (isTooFarAhead) {
        return next(createHttpError(400, `Collection pickup time must be within ${pickupWindowHours} hours.`));
      }

      scheduledFor = when;
    }

    // Globally-unique, atomic per-tenant order number (Module 3 §4).
    // Replaces the earlier `W-{storeId}-{Date.now().slice(-6)}` which
    // could collide during a burst of concurrent website orders because
    // Date.now() is millisecond-resolution and Node can serve many
    // requests in the same millisecond. `Safe` variant falls back to a
    // random-suffix format if the counter collection is temporarily
    // unavailable, keeping the checkout flow resilient.
    const orderNumber = await generateOrderNumberSafe({
      source: "WEBSITE",
      restaurantId,
    });

    // Module 4 §4 — website orders enter the kitchen queue as "Preparing"
    // (renamed from "Pending") and get a server-authoritative auto-ready
    // deadline based on the tenant's configured minutes. Scheduled orders
    // deliberately skip auto-ready — the deadline for a pre-order should
    // be based on scheduledFor, not on createdAt.
    const orderTypeForOrder =
      requestedType === "delivery" ? "delivery" : "takeaway";
    const readyDueAt = scheduledFor
      ? null
      : await computeReadyDueAt({
          restaurantId,
          storeId,
          orderType: orderTypeForOrder,
        });

    const order = new Order({
      customerDetails: { name, phone, guests: 1 },
      // Map to the POS's existing vocabulary so downstream reports keep working.
      orderType: orderTypeForOrder,
      ...(deliveryAddress ? { deliveryAddress } : {}),
      orderStatus: "Preparing",
      items: priced.items,
      bills: priced.bills,
      restaurantId,
      outletId: outletId || undefined,
      storeId,
      source: "WEBSITE",
      orderNumber,
      idempotencyKey,
      scheduledFor,
      ...(readyDueAt ? { readyDueAt } : {}),
      channelMeta: {
        slug: settings.slug,
        themeKey: settings.theme?.themeKey || "",
        userAgent: String(req.headers["user-agent"] || "").slice(0, 200),
        placedAt: new Date(),
      },
      paymentMethod: "cash",
      payments: [{
        method: "cash",
        amount: priced.bills.totalWithTax,
        status: "pending",
      }],
      timeline: [{ status: "Preparing", timestamp: new Date(), user: "Website" }],
      createdBy: null, // customer-placed, no POS user
    });


    try {
      await order.save();
    } catch (err) {
      // Unique index race on idempotencyKey: another concurrent submit won.
      if (err?.code === 11000 && idempotencyKey) {
        const existing = await Order.findOne({ restaurantId, idempotencyKey });
        if (existing) {
          return res.status(200).json({
            success: true,
            message: "Order already placed",
            duplicate: true,
            data: publicOrderView(existing),
          });
        }
      }
      throw err;
    }

    // ---- CRM: upsert the customer record (best-effort) ----
    // Never let a CRM failure lose a paid/placed order (§32).
    try {
      await upsertCustomer({ restaurantId, outletId, name, phone, email, total: priced.bills.totalWithTax });
    } catch (err) {
      console.warn("Customer upsert failed for website order:", err.message);
    }

    // ---- Realtime notification to the POS (§13, §31) ----
    // Emitted AFTER the order is durably saved, and wrapped so a socket
    // failure can never fail the request — the POS will still see the order
    // via its normal fetch/reconnect path.
    try {
      emitOrderCreated({ restaurantId, outletId, storeId, order });
    } catch (err) {
      console.warn("Realtime emit failed for website order:", err.message);
    }

    res.status(201).json({
      success: true,
      message: "Order placed successfully",
      data: publicOrderView(order),
    });
  } catch (error) {
    next(error);
  }
};

/** Customer-facing projection of an order — no internal ids or POS fields. */
const publicOrderView = (order) => ({
  orderId: order._id,
  orderNumber: order.orderNumber,
  status: order.orderStatus,
  orderType: order.orderType,
  placedAt: order.createdAt || order.orderDate,
  scheduledFor: order.scheduledFor,
  items: (order.items || []).map((i) => ({
    name: i.name,
    quantity: i.quantity,
    unitPrice: i.unitPrice || i.price,
    total: i.total,
    variant: i.variant?.name || "",
    addons: (i.addons || []).map((a) => a.name),
    options: (i.modifierSelections || []).map((m) => m.optionName),
    note: i.note || "",
  })),
  bills: order.bills,
  customer: { name: order.customerDetails?.name, phone: order.customerDetails?.phone },
});

/** Create or update the Customer CRM record for this phone number. */
const upsertCustomer = async ({ restaurantId, outletId, name, phone, email, total }) => {
  if (!phone) return null;

  const existing = await Customer.findOne({ restaurantId, phone, isDeleted: { $ne: true } });
  if (existing) {
    if (name) existing.name = name;
    if (email && !existing.email) existing.email = email;
    existing.visitCount = (existing.visitCount || 0) + 1;
    existing.totalSpent = (existing.totalSpent || 0) + Number(total || 0);
    existing.lastVisitAt = new Date();
    await existing.save();
    return existing;
  }

  try {
    return await Customer.create({
      restaurantId,
      outletId,
      name,
      phone,
      ...(email ? { email } : {}),
      visitCount: 1,
      totalSpent: Number(total || 0),
      lastVisitAt: new Date(),
    });
  } catch (err) {
    if (err.code === 11000) {
      return Customer.findOne({ restaurantId, phone, isDeleted: { $ne: true } });
    }
    throw err;
  }
};

/** GET /api/storefront/:slug/orders/:orderId — customer order tracking. */
const trackStorefrontOrder = async (req, res, next) => {
  try {
    const ctx = await requireStorefront(req, next);
    if (!ctx) return;

    const phone = String(req.query.phone || "").replace(/\D/g, "");
    if (!phone) return next(createHttpError(400, "Phone number is required to track an order."));

    // Scoped by store AND phone: an order id alone is not enough to view it.
    const order = await Order.findOne({
      _id: req.params.orderId,
      storeId: ctx.storeId,
      "customerDetails.phone": phone,
    });
    if (!order) return next(createHttpError(404, "Order not found."));

    res.status(200).json({ success: true, data: publicOrderView(order) });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getStorefront,
  getStorefrontMenu,
  getStorefrontProduct,
  createStorefrontOrder,
  trackStorefrontOrder,
  buildStorefrontPayload,
  toPublicProduct,
  publicOrderView,
};
