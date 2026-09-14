const createHttpError = require("http-errors");
const crypto = require("crypto");
const Menu = require("../models/menuModel");
const Order = require("../models/orderModel");
const Customer = require("../models/customerModel");
const { resolveStorefront, REASON_MESSAGES } = require("../services/storefrontResolver");
const { AWAITING_ACCEPTANCE } = require("../constants/orderStatus");
const { isItemAvailableNow, getEffectivePrice } = require("../services/businessHours");
const { calculateOrderTotals, PricingError } = require("../services/orderPricingService");
const {
  AUDIENCES,
  ORDER_TYPES,
  menuViewFor,
  projectMenus,
  allowsOrderType,
  dispatchLabel,
  WEBSITE_VISIBLE_QUERY,
} = require("../services/menuCache");
const { getTheme } = require("../services/themeRegistry");
const { buildLandingPayload } = require("../services/landingPayload");
const { emitOrderCreated } = require("../services/socket");
const WebsiteCheckout = require("../models/websiteCheckoutModel");
const { resolveGateway } = require("../services/paymentGateway");
const { localDate } = require("../services/tableBookings");
const { availabilityAt, websiteAvailability } = require("../services/websiteAvailability");
const { CUSTOMER_PAUSED_MESSAGE } = require("../services/accountLock");
const config = require("../config/config");
const { buildStorefrontUrl } = require("../services/websiteProvisioningService");

/** pay.<base>: the single payment host Cashfree needs whitelisted. "" in dev. */
const payBaseUrl = () => String(process.env.PAYMENT_PUBLIC_URL || "").replace(/\/+$/, "");
const { generateOrderNumberSafe } = require("../services/orderNumberService");


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
  // The website's list price. A product with separate channel prices shows its
  // WEBSITE COLLECTION figure here — the storefront asks for delivery vs
  // pickup at checkout, so collection is the honest default to browse at, and
  // the bill is recomputed against the chosen channel at order time.
  // `channelPrices` also travels with the product so the cart can show the
  // delivery figure once the customer picks delivery.
  const effectivePrice = getEffectivePrice(item, timezone, {
    environment: "website",
    channel: "collection",
  });
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
    // Per-channel website prices, present only when the product opts out of a
    // single price. Lets the cart re-price when the customer picks delivery.
    channelPrices:
      item.samePrice === false && item.channelPrices
        ? {
            collection: Number(item.channelPrices.websiteCollection) || effectivePrice,
            delivery: Number(item.channelPrices.websiteDelivery) || effectivePrice,
            table: Number(item.channelPrices.websiteTable) || effectivePrice,
          }
        : null,
    image: item.imageUrl || item.image || "",
    thumbnail: item.imageThumbnailUrl || item.imageUrl || item.image || "",
    imageAlt: item.imageAlt || item.name,
    isVegetarian: Boolean(item.isVegetarian),
    // Which order types this product can actually be bought through.
    //
    // It is the CATEGORY's dispatch type -- that is what the order-time check
    // enforces -- carried onto the product so the site can say "Collection
    // only" on the card, in the product sheet and in the cart. Without it the
    // customer's first news of the restriction was a refusal at checkout.
    dispatchType: menu.dispatchType
      ? {
          collection: menu.dispatchType.collection !== false,
          delivery: menu.dispatchType.delivery !== false,
          table: menu.dispatchType.table !== false,
        }
      : { collection: true, delivery: true, table: true },
    isAvailable: isItemAvailableNow(item, timezone, "website"),
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
      // Without this the storefront cannot tell a capped group from an
      // uncapped one, so it capped everything.
      maxSelectionEnabled: g.maxSelectionEnabled === true,
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
const buildStorefrontPayload = async ({ settings, restaurantId, storeId, timezone, restaurant, orderingLocked = false, preview = false }) => {
  // Hard tenant filter: only this restaurant's published menus.
  const menus = restaurantId
    ? await Menu.find({
        restaurantId,
        isDeleted: { $ne: true },
        // One rule, from services/menuCache, shared with the checkout query
        // below and with publicStoreController. Three hand-written copies of
        // "is this category on the website?" had drifted apart -- see the
        // note on the checkout query.
        ...WEBSITE_VISIBLE_QUERY,
      }).sort({ createdAt: 1 })
    : [];

  const categories = [];
  for (const menu of menus) {
    // Respect category-level scheduling (e.g. a "Breakfast" menu).
    const menuActive = !menu.schedule?.enabled || isItemAvailableNow({ isAvailable: true, schedule: menu.schedule }, timezone);
    if (!menuActive) continue;

    // Module 9 §3 — the storefront serves the Website Published snapshot and
    // nothing else. It used to fall back to menu.items for any menu not yet
    // published, which put unpublished drafts straight on the public site.
    const view = menuViewFor(menu, AUDIENCES.WEBSITE);
    const activeItems = view.items;
    const activeName = view.name;

    const products = activeItems
      .filter((item) => item.showOnWebsite !== false && item.displayTarget !== "system")
      .map((item) => toPublicProduct(item, menu, timezone))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    if (!products.length) continue;

    categories.push({
      id: menu._id,
      name: activeName,
      // Which order types this category may be sold through. The storefront
      // asks for delivery/collection at checkout rather than up front, so the
      // authoritative check runs at order time (see createStorefrontOrder);
      // this is exposed so the UI can also filter once a choice is made.
      dispatchType: menu.dispatchType
        ? { collection: menu.dispatchType.collection !== false,
            delivery: menu.dispatchType.delivery !== false,
            table: menu.dispatchType.table !== false }
        : { collection: true, delivery: true, table: true },
      icon: menu.icon || "",
      bgColor: menu.bgColor || "",
      isActive: menuActive,
      products,
    });
  }


  // Website Timing & Holidays: each channel's own hours, Close for Today and
  // the Holiday Calendar. See services/websiteAvailability.
  const availability = websiteAvailability(settings, timezone);
  // Locked for non-payment closes every channel, whatever the hours say.
  if (orderingLocked && !preview) {
    for (const channel of ["collection", "delivery", "table"]) {
      availability[channel] = { open: false, kind: "locked", reason: CUSTOMER_PAUSED_MESSAGE, windows: [] };
    }
  }
  const anyOrdering = availability.collection.open || availability.delivery.open;
  const openState = preview
    ? { isOpen: true, reason: "", nextOpen: null }
    : {
        isOpen: anyOrdering,
        reason: anyOrdering ? "" : availability.collection.reason || availability.delivery.reason,
        nextOpen: null,
      };


  const theme = getTheme(settings.theme?.themeKey) || getTheme("default-restaurant");

  return {
    store: {
      storeId,
      slug: settings.slug,
      name: settings.displayName || restaurant?.name || "",
      isOpen: openState.isOpen,
      closedReason: openState.reason,
      nextOpen: openState.nextOpen,
      acceptingOrders: openState.isOpen,
    },
    availability: {
      collection: { open: availability.collection.open, reason: availability.collection.reason, windows: availability.collection.windows },
      delivery: { open: availability.delivery.open, reason: availability.delivery.reason, windows: availability.delivery.windows },
      table: { open: availability.table.open, reason: availability.table.reason },
    },
    landing: buildLandingPayload(settings, restaurant, null),
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
      pickupWindowHours: Number(settings.ordering?.pickupWindowHours) || 5,
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

    // Short, and without stale-while-revalidate: this response carries both
    // the live menu and the landing page design, and both are edited by
    // someone who then immediately reloads to check. Serving them a stale copy
    // while refreshing in the background is exactly the wrong answer here.
    res.set("Cache-Control", "public, max-age=5");
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
/**
 * Validates, prices and schedules a website order, then hands the unsaved
 * Order to `finalize`. Two finalizers share every check above the save:
 * placing the order outright (createStorefrontOrder), and holding it until
 * the customer pays (startStorefrontCheckout).
 */
const buildStorefrontOrder = (finalize) => async (req, res, next) => {
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

    // ---- Website Timing & Holidays ----
    // Collection orders only in Collection Time, delivery only in Delivery
    // Time; a holiday or Close for Today stops both.
    const channel = requestedType === "delivery" ? "delivery" : "collection";
    const now = new Date();
    const availability = availabilityAt(settings, channel, now, timezone);
    if (!availability.open) return next(createHttpError(409, availability.reason));
    if (ctx.orderingLocked) return next(createHttpError(409, CUSTOMER_PAUSED_MESSAGE));

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
    //
    // Priced against the WEBSITE snapshot, i.e. the exact catalogue this
    // customer was shown. Pricing used to read menu.items, so an unpublished
    // price edit in Manage Menu would quietly charge the new price against a
    // site still displaying the old one — and an item only present in the
    // draft could be ordered at all.
    const menuDocs = await Menu.find({
      restaurantId,
      isDeleted: { $ne: true },
      // This clause was missing `showOnWebsite` entirely, while the browse
      // query above had it. A category with Display Status OFF and Website
      // Visibility ON was therefore shown to the customer and then refused at
      // checkout: they could see the dish, add it, and have the order fail to
      // price. Both now read the same rule.
      ...WEBSITE_VISIBLE_QUERY,
    });
    // Dispatch Type is authoritative here. The website asks for pickup vs
    // delivery at checkout rather than before browsing, so a delivery-only
    // category cannot be filtered out of the catalogue up front.
    //
    // A restricted category is still dropped from the priced menu, so a line
    // from one can never be billed. But being dropped was ALL that happened:
    // its items were simply missing from the index and the customer got "One
    // or more items are no longer available", which named neither the item nor
    // the reason and read like the dish had sold out. Name it first.
    //
    // "pickup" on the website is a collection order.
    const dispatchKey = requestedType === "delivery" ? ORDER_TYPES.DELIVERY : ORDER_TYPES.COLLECTION;
    const projectedMenus = projectMenus(menuDocs, AUDIENCES.WEBSITE);

    const blockedMenus = projectedMenus.filter((m) => !allowsOrderType(m, dispatchKey));
    if (blockedMenus.length) {
      const byId = new Map(blockedMenus.map((m) => [String(m._id), m]));
      const offending = (Array.isArray(body.items) ? body.items : []).find((line) =>
        byId.has(String(line?.menuId)),
      );
      if (offending) {
        const menu = byId.get(String(offending.menuId));
        const item = (menu.items || []).find((i) => String(i._id) === String(offending.itemId));
        const what = item?.name || menu.name;
        const label = dispatchLabel(menu.dispatchType);
        return next(
          createHttpError(
            400,
            label
              ? `${what} is ${label.toLowerCase()}. Please change your order type or remove it from your basket.`
              : `${what} is not available for ${dispatchKey} orders.`,
          ),
        );
      }
    }

    const menus = projectedMenus.filter((m) => allowsOrderType(m, dispatchKey));

    let priced;
    try {
      priced = calculateOrderTotals({
        items: body.items,
        menus,
        settings,
        restaurant: ctx.restaurant,
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
      // In the restaurant's timezone: the server runs in UTC, so a 1 AM IST
      // pickup was being judged against the previous UTC day.
      const isDifferentDay = localDate(when, timezone) !== localDate(new Date(nowTime), timezone);
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

      // The pickup itself must also fall inside Collection Time.
      const atPickup = availabilityAt(settings, "collection", when, timezone);
      if (!atPickup.open) {
        return next(createHttpError(400, `Please choose a pickup time within collection hours. ${atPickup.reason}`));
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

    // A website order arrives AWAITING ACCEPTANCE (§14). The restaurant has to
    // take it before anything else happens — it may be slammed, out of an
    // ingredient, or closing — and onlineOrderController implements exactly
    // that with accept/reject.
    //
    // This used to be created as "Preparing", on the assumption that
    // "Preparing" was simply a rename of "Pending". In the POS order list it
    // effectively is, but NOT here: the Accept / Reject buttons key off
    // "Pending", so a website order was created in a state the online-orders
    // screen had no actions for, and the whole accept/reject feature was
    // unreachable.
    //
    // The auto-ready and auto-complete clocks deliberately do NOT start here.
    // They are set when a human accepts (see onlineOrderController). Starting
    // them at creation would let an order nobody has accepted promote itself
    // to Ready and text the customer that food is ready that nobody has begun
    // cooking.
    const orderTypeForOrder =
      requestedType === "delivery" ? "delivery" : "takeaway";

    const order = new Order({
      customerDetails: { name, phone, guests: 1 },
      // Map to the POS's existing vocabulary so downstream reports keep working.
      orderType: orderTypeForOrder,
      ...(deliveryAddress ? { deliveryAddress } : {}),
      orderStatus: AWAITING_ACCEPTANCE,
      items: priced.items,
      bills: priced.bills,
      restaurantId,
      outletId: outletId || undefined,
      storeId,
      source: "WEBSITE",
      orderNumber,
      idempotencyKey,
      scheduledFor,
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


    return await finalize({ req, res, next, ctx, order, idempotencyKey, name, phone, email, priced });
  } catch (error) {
    next(error);
  }
};

/** Place the order immediately and tell the POS. */
const saveAndAnnounce = async ({ res, ctx, order, idempotencyKey, name, phone, email, priced }) => {
  const { restaurantId, outletId, storeId } = ctx;
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
    // Unique index race on orderNumber: astronomically unlikely with
    // 6-digit random IDs, but the partial-unique index in orderModel
    // is the ultimate safety net. Regenerate and retry once — the new
    // generator's pre-flight `exists()` check makes a second collision
    // vanishingly rare.
    if (err?.code === 11000 && String(err?.keyPattern?.orderNumber) === "1") {
      order.orderNumber = await generateOrderNumberSafe({
        source: "WEBSITE",
        restaurantId,
      });
      await order.save();
    } else {
      throw err;
    }
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
};

const createStorefrontOrder = buildStorefrontOrder(saveAndAnnounce);

/**
 * Open a payment for the order instead of placing it.
 *
 * Nothing is written to Orders here. The priced order waits in
 * WebsiteCheckout until verifyStorefrontCheckout hears from the gateway that
 * it was paid, so an abandoned or failed payment never reaches the POS.
 */
const openCheckout = async ({ res, next, ctx, order, idempotencyKey, name, phone, priced }) => {
  const { restaurantId, storeId } = ctx;
  const amount = Number(priced.bills?.totalWithTax) || 0;
  if (amount <= 0) return next(createHttpError(400, "Your order total must be more than zero."));

  const gw = await resolveGateway({ restaurantId, storeId });
  if (!gw.enabled) {
    return next(
      createHttpError(409, "This restaurant has not set up online payment yet, so orders cannot be placed on the website."),
    );
  }

  const payBase = payBaseUrl();
  const checkout = new WebsiteCheckout({
    restaurantId,
    storeId,
    orderData: order.toObject({ depopulate: true }),
    amount,
    currency: "INR",
    returnUrl: `${buildStorefrontUrl(ctx.settings)}/menu`,
  });

  let gatewayOrder;
  try {
    const cashfree = require("../services/gateways/cashfree");
    gatewayOrder = await cashfree.createOrder({
      appId: gw.keyId,
      secretKey: gw.secret,
      environment: gw.environment,
      amount,
      currency: "INR",
      orderId: `web_${checkout._id}`,
      customer: { id: `web_${phone}`, phone, name },
      notifyUrl: config.cashfreeNotifyUrl,
      ...(payBase ? { returnUrl: `${payBase}/c/${checkout._id}/done` } : {}),
      tags: { websiteCheckoutId: String(checkout._id), restaurantId: String(restaurantId) },
    });
  } catch (err) {
    console.warn("[storefront] gateway order failed:", err?.message || err);
    return next(createHttpError(502, "The payment page could not be opened. Please try again."));
  }

  checkout.gatewayOrderId = gatewayOrder.orderId;
  checkout.paymentSessionId = gatewayOrder.paymentSessionId;
  checkout.mode = gatewayOrder.environment === "PROD" ? "production" : "sandbox";
  await checkout.save();

  res.status(201).json({
    success: true,
    data: {
      checkoutId: String(checkout._id),
      amount,
      currency: "INR",
      // Where to send the customer to pay. Checkout never opens on the
      // store's own host, so Cashfree only needs this one domain whitelisted.
      payUrl: payBase ? `${payBase}/c/${checkout._id}` : "",
      checkout: {
        provider: "cashfree",
        paymentSessionId: gatewayOrder.paymentSessionId,
        mode: gatewayOrder.environment === "PROD" ? "production" : "sandbox",
      },
    },
  });
};

const startStorefrontCheckout = buildStorefrontOrder(openCheckout);

/**
 * POST /api/storefront/:slug/checkout/:checkoutId/verify
 *
 * The browser only says "I came back from the payment page". Whether the
 * order is placed is decided by asking the gateway about the order WE opened,
 * never by anything in the request.
 */
const verifyStorefrontCheckout = async (req, res, next) => {
  try {
    const ctx = await requireStorefront(req, next);
    if (!ctx) return;
    const { restaurantId, outletId, storeId } = ctx;

    const id = String(req.params.checkoutId || "");
    if (!/^[a-f0-9]{24}$/i.test(id)) return next(createHttpError(404, "Checkout not found."));
    let checkout = await WebsiteCheckout.findOne({ _id: id, storeId });
    if (!checkout) return next(createHttpError(404, "Checkout not found."));

    const placedView = async (c) => {
      const placed = c.orderId ? await Order.findById(c.orderId) : null;
      return placed
        ? res.status(200).json({ success: true, message: "Order placed successfully", data: publicOrderView(placed) })
        : next(createHttpError(409, "Your payment is being processed. Please wait a moment and try again."));
    };
    if (checkout.status !== "PENDING") return placedView(checkout);

    const gw = await resolveGateway({ restaurantId, storeId });
    if (!gw.enabled) return next(createHttpError(409, "Online payment is not available for this restaurant."));

    let result;
    try {
      const cashfree = require("../services/gateways/cashfree");
      result = await cashfree.isOrderPaid({
        appId: gw.keyId,
        secretKey: gw.secret,
        environment: gw.environment,
        orderId: checkout.gatewayOrderId,
      });
    } catch (err) {
      console.warn("[storefront] payment status check failed:", err?.message || err);
      return next(
        createHttpError(502, "We could not confirm your payment yet. Please do not pay again; try this page again in a moment."),
      );
    }

    if (!result.paid) {
      return next(createHttpError(402, "Payment was not completed, so your order has not been placed. Please try again."));
    }
    if (Math.abs(Number(result.amount) - Number(checkout.amount)) > 0.01) {
      return next(createHttpError(409, "The amount paid does not match this order. Please contact the restaurant."));
    }

    // Claim it: two tabs, or a retry racing the first request, place it once.
    const claimed = await WebsiteCheckout.findOneAndUpdate(
      { _id: checkout._id, status: "PENDING" },
      { $set: { status: "PLACING", transactionId: result.cfOrderId || checkout.gatewayOrderId } },
      { new: true },
    );
    if (!claimed) {
      checkout = await WebsiteCheckout.findById(checkout._id);
      return placedView(checkout);
    }

    const data = { ...claimed.orderData };
    const transactionId = claimed.transactionId;
    const order = new Order({
      ...data,
      paymentMethod: "online",
      payments: [{ method: "online", amount: claimed.amount, status: "paid", transactionId }],
      channelMeta: { ...(data.channelMeta || {}), placedAt: new Date() },
    });

    try {
      await order.save();
    } catch (err) {
      if (err?.code === 11000 && String(err?.keyPattern?.orderNumber) === "1") {
        order.orderNumber = await generateOrderNumberSafe({ source: "WEBSITE", restaurantId });
        await order.save();
      } else if (err?.code === 11000 && data.idempotencyKey) {
        const existing = await Order.findOne({ restaurantId, idempotencyKey: data.idempotencyKey });
        if (!existing) throw err;
        order._id = existing._id;
      } else {
        await WebsiteCheckout.updateOne({ _id: claimed._id }, { $set: { status: "PENDING" } });
        throw err;
      }
    }

    await WebsiteCheckout.updateOne({ _id: claimed._id }, { $set: { status: "PLACED", orderId: order._id } });

    try {
      await upsertCustomer({
        restaurantId,
        outletId,
        name: order.customerDetails?.name,
        phone: order.customerDetails?.phone,
        total: claimed.amount,
      });
    } catch (err) {
      console.warn("Customer upsert failed for website order:", err.message);
    }

    try {
      emitOrderCreated({ restaurantId, outletId, storeId, order });
    } catch (err) {
      console.warn("Realtime emit failed for website order:", err.message);
    }

    res.status(201).json({ success: true, message: "Order placed successfully", data: publicOrderView(order) });
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
  startStorefrontCheckout,
  verifyStorefrontCheckout,
  trackStorefrontOrder,
  buildStorefrontPayload,
  toPublicProduct,
  publicOrderView,
};
