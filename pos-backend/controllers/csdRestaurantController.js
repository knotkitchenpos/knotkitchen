const crypto = require("crypto");
const createHttpError = require("http-errors");
const mongoose = require("mongoose");

const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");
const Order = require("../models/orderModel");
const User = require("../models/userModel");
const WebsiteSettings = require("../models/websiteSettingsModel");
const AuditLog = require("../models/auditLogModel");
const CsdStoreCharges = require("../models/csdStoreChargesModel");
const CsdPosSession = require("../models/csdPosSessionModel");
const CsdJob = require("../models/csdJobModel");

const { isStoreOpen } = require("../services/businessHours");
const { buildStorefrontUrl } = require("../services/websiteProvisioningService");
const { csdAudit } = require("../services/csdAuditService");
const config = require("../config/config");
const { formatAddress } = require("../services/address");
const { statusFor } = require("../services/subscription");

const str = (v) => String(v ?? "").trim();
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Load the store + its restaurant + website settings, or 404. */
const loadStore = async (storeId) => {
  if (!/^\d{6}$/.test(storeId)) throw createHttpError(400, "Invalid Store ID.");
  const store = await Store.findOne({ storeId, isDeleted: { $ne: true } }).lean();
  if (!store) throw createHttpError(404, "Store not found.");

  const [restaurant, settings] = await Promise.all([
    Restaurant.findOne({ storeId, isDeleted: { $ne: true } }, { securityPin: 0 }).lean(),
    WebsiteSettings.findOne({ storeId, isDeleted: { $ne: true } }).lean(),
  ]);
  return { store, restaurant, settings };
};

const addressOf = (restaurant) => {
  const a = restaurant?.address || {};
  return {
    line1: a.line1 || "", line2: a.line2 || "", city: a.city || "",
    state: a.state || "", postalCode: a.postalCode || "", country: a.country || "",
    // Shared with the receipt and the CSD store list, so one restaurant's
    // address reads the same wherever it is shown.
    full: formatAddress(a),
  };
};

/**
 * GET /api/csd/restaurants/:storeId
 *
 * The whole Restaurant Details Page in one round trip. Sections that are
 * expensive or independently paginated (customers, orders, activity) have
 * their own endpoints; everything the page renders immediately is here.
 */
const getRestaurant = async (req, res, next) => {
  try {
    const storeId = str(req.params.storeId);
    const { store, restaurant, settings } = await loadStore(storeId);

    const timezone = restaurant?.timezone || "Asia/Kolkata";
    // §18: computed live from the configured hours, never a stored flag.
    const openState = isStoreOpen(settings, timezone);

    const openingHours = DAYS.map((label, day) => {
      const row = (settings?.openingHours || []).find((h) => h.day === day);
      return {
        day, label,
        isOpen: row ? row.isOpen !== false : null,
        openTime: row?.openTime || null,
        closeTime: row?.closeTime || null,
      };
    });

    // Agreement v2.0 terms as the POS sees them: installation, commitment,
    // the refund the restaurant would get today, and the accepted Schedule 1.
    let agreementTerms = null;
    if (restaurant?._id) {
      try {
        const st = await statusFor(restaurant._id);
        agreementTerms = {
          agreementVersion: st.agreementVersion,
          activatedAt: st.activatedAt,
          installation: st.installation,
          installationRequired: st.installationRequired,
          commitment: st.commitment,
          schedule: st.schedule,
          planName: st.planName,
          currentPeriodEnd: st.currentPeriodEnd,
        };
      } catch (err) {
        console.warn("[csd] agreement terms unavailable:", err.message);
      }
    }

    const charges = (await CsdStoreCharges.findOne({ storeId }).lean()) || {
      ...CsdStoreCharges.DEFAULTS,
      isDefault: true,
    };

    res.status(200).json({
      success: true,
      data: {
        header: {
          storeId,
          restaurantName: restaurant?.name || store.storeName || "",
          logoUrl: settings?.branding?.logo?.url || "",
          status: store.status,
          // "Disabled" in the spec's sense — not serving customers.
          isActive: store.status === "active",
          availability: {
            isOpen: !!openState.isOpen,
            reason: openState.reason || "",
            nextOpen: openState.nextOpen || null,
            timezone,
          },
        },

        basic: {
          restaurantName: restaurant?.name || store.storeName || "",
          storeId,
          restaurantType: restaurant?.restaurantType || "",
          restaurantPhone: restaurant?.restaurantPhone || "",
          website: settings ? buildStorefrontUrl(settings) : "",
          customDomain: settings?.customDomain || "",
          address: addressOf(restaurant),
          status: store.status,
          closedUntil: store.closedUntil || null,
          closureReason: store.closureReason || "",
          registeredOn: store.createdAt,
        },

        owner: {
          name: store.ownerName || restaurant?.ownerName || "",
          phone: store.ownerPhone || restaurant?.ownerPhone || "",
          email: restaurant?.ownerEmail || "",
        },
        sales: { agentName: restaurant?.salesAgentName || "" },
        contact: {
          ownerPhone: store.ownerPhone || restaurant?.ownerPhone || "",
          restaurantPhone: restaurant?.restaurantPhone || "",
        },

        googleBusiness: {
          url: restaurant?.googleBusinessUrl || "",
          mapsLink: restaurant?.mapsLink || "",
        },

        quickAccess: {
          website: settings ? buildStorefrontUrl(settings) : "",
          googleBusinessUrl: restaurant?.googleBusinessUrl || "",
          // The POS link is NOT a plain URL — it is minted per click through
          // /pos-session so the access is scoped, single-use and audited.
          posAvailable: !!restaurant,
        },

        websiteSettings: {
          delivery: !!(settings?.ordering?.deliveryEnabled ?? restaurant?.orderTypeToggles?.delivery),
          collection: !!(settings?.ordering?.pickupEnabled ?? restaurant?.orderTypeToggles?.collection),
          tableOrders: !!restaurant?.orderTypeToggles?.table,
          websiteEnabled: settings?.enabled !== false,
          currency: settings?.ordering?.currency || restaurant?.currency || "INR",
        },

        storeProperties: {
          // §28 asks for minimum/maximum delivery and collection times, but the
          // platform does not store those. What exists is a single prep time
          // plus a per-channel auto-ready window. Reporting them as a min–max
          // range produced nonsense like "25–20 min", so they are returned
          // under their real names and the UI labels them accurately.
          timings: {
            prepMinutes: settings?.ordering?.prepTimeMinutes ?? null,
            autoReady: {
              delivery: settings?.ordering?.autoReadyMinutes?.delivery ?? null,
              collection: settings?.ordering?.autoReadyMinutes?.collection ?? null,
              table: settings?.ordering?.autoReadyMinutes?.table ?? null,
            },
            // Tells the UI to explain the gap rather than imply the figures
            // are configured min/max delivery windows.
            hasConfiguredMinMax: false,
          },
          usesBusinessHours: !!settings?.useBusinessHours,
          openingHours,
          closedForToday: settings?.closedForToday?.enabled
            ? { reason: settings.closedForToday.reason || "" }
            : null,
          orderMethods: {
            delivery: !!settings?.ordering?.deliveryEnabled,
            collection: !!settings?.ordering?.pickupEnabled,
            tableOrders: !!restaurant?.orderTypeToggles?.table,
          },
        },

        charges: {
          onlinePaidOrderCharge: charges.onlinePaidOrderCharge,
          gstPercent: charges.gstPercent,
          monthlySubscription: charges.monthlySubscription,
          billingExempt: Boolean(charges.billingExempt),
          plan: restaurant?.subscription?.plan || "free",
          subscriptionStatus: restaurant?.subscription?.status || "",
          usingDefaults: !!charges.isDefault,
          notes: charges.notes || "",
          agreementTerms,
          // Drives whether the UI renders Edit controls at all (§29). The
          // server enforces it regardless — see requireCsdAdmin on the route.
          canEdit: req.csdStaff.role === "admin",
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/csd/restaurants/:storeId/customers
 *
 * §20 — unique customers who ordered through website, POS or table.
 * A customer is identified by phone: the same person ordering at the counter
 * and from the website is one customer, and orders carry the phone but not
 * always a customerId.
 */
const getCustomers = async (req, res, next) => {
  try {
    const storeId = str(req.params.storeId);
    await loadStore(storeId);

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const base = {
      storeId,
      isDeleted: { $ne: true },
      orderStatus: { $not: /^cancelled$/i },
      "customerDetails.phone": { $nin: [null, ""] },
    };

    const grouped = [
      { $match: base },
      {
        $group: {
          _id: "$customerDetails.phone",
          name: { $last: "$customerDetails.name" },
          totalOrders: { $sum: 1 },
          lastOrderDate: { $max: "$orderDate" },
          // A customer can order through more than one channel; keep the set.
          sources: { $addToSet: { $ifNull: ["$source", "POS"] } },
          orderTypes: { $addToSet: { $ifNull: ["$orderType", ""] } },
        },
      },
    ];

    const [countRows, rows] = await Promise.all([
      Order.aggregate([...grouped, { $count: "n" }]),
      Order.aggregate([
        ...grouped,
        { $sort: { lastOrderDate: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ]),
    ]);

    const total = countRows[0]?.n || 0;

    res.status(200).json({
      success: true,
      data: {
        total,
        page,
        pages: Math.ceil(total / limit),
        customers: rows.map((c) => ({
          phone: c._id,
          name: c.name || "",
          totalOrders: c.totalOrders,
          lastOrderDate: c.lastOrderDate,
          sources: (c.sources || []).filter(Boolean),
          orderTypes: (c.orderTypes || []).filter(Boolean),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/csd/restaurants/:storeId/order-summary?period=today|yesterday|week|month
 *
 * §26 — order counts split by channel. Periods are IST calendar windows, for
 * the same reason the dashboard is (see csdDashboardController).
 */
const PERIODS = ["today", "yesterday", "week", "month"];

const periodWindow = (period) => {
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  const y = nowIst.getUTCFullYear();
  const m = nowIst.getUTCMonth();
  const d = nowIst.getUTCDate();
  const istMidnight = (dayOffset = 0) => new Date(Date.UTC(y, m, d + dayOffset) - IST_OFFSET_MS);

  switch (period) {
    case "yesterday": return { from: istMidnight(-1), to: istMidnight(0) };
    case "week": return { from: istMidnight(-6), to: istMidnight(1) }; // today + 6 back
    case "month": return { from: istMidnight(-29), to: istMidnight(1) };
    default: return { from: istMidnight(0), to: istMidnight(1) };
  }
};

/**
 * Classify an order into the spec's three buckets. `source` is the primary
 * signal; `orderType` disambiguates table orders, which the POS records as a
 * dine-in order rather than a distinct source.
 */
const CHANNEL_STAGE = {
  $switch: {
    branches: [
      { case: { $eq: ["$source", "WEBSITE"] }, then: "website" },
      { case: { $eq: ["$source", "QR"] }, then: "table" },
      { case: { $in: ["$orderType", ["dine-in", "table"]] }, then: "table" },
    ],
    default: "pos",
  },
};

const getOrderSummary = async (req, res, next) => {
  try {
    const storeId = str(req.params.storeId);
    await loadStore(storeId);

    const period = PERIODS.includes(str(req.query.period)) ? str(req.query.period) : "today";
    const { from, to } = periodWindow(period);

    const rows = await Order.aggregate([
      {
        $match: {
          storeId,
          isDeleted: { $ne: true },
          orderStatus: { $not: /^cancelled$/i },
          orderDate: { $gte: from, $lt: to },
        },
      },
      { $group: { _id: CHANNEL_STAGE, orders: { $sum: 1 },
        revenue: { $sum: { $ifNull: ["$bills.totalWithTax", { $ifNull: ["$bills.total", 0] }] } } } },
    ]);

    const byChannel = { website: 0, pos: 0, table: 0 };
    let revenue = 0;
    for (const r of rows) {
      byChannel[r._id] = r.orders;
      revenue += r.revenue;
    }

    res.status(200).json({
      success: true,
      data: {
        period,
        from,
        to,
        timezone: "Asia/Kolkata",
        websiteOrders: byChannel.website,
        posOrders: byChannel.pos,
        tableOrders: byChannel.table,
        totalOrders: byChannel.website + byChannel.pos + byChannel.table,
        revenue: Math.round((revenue + Number.EPSILON) * 100) / 100,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/csd/restaurants/:storeId/staff
 *
 * §25 — the RESTAURANT's own staff (POS users), not KnotKitchen employees.
 * Read-only here: these accounts belong to the restaurant and are managed
 * from their own POS.
 */
const getRestaurantStaff = async (req, res, next) => {
  try {
    const storeId = str(req.params.storeId);
    const { store, restaurant } = await loadStore(storeId);

    const users = restaurant
      ? await User.find(
          { restaurantId: restaurant._id, isDeleted: { $ne: true } },
          { name: 1, role: 1, phone: 1, email: 1, isActive: 1, createdAt: 1 }
        ).sort({ createdAt: 1 }).lean()
      : [];

    const staff = users.map((u) => ({
      id: String(u._id),
      name: u.name || "",
      role: u.role || "Staff",
      phone: u.phone || "",
      email: u.email || "",
      status: u.isActive === false ? "disabled" : "active",
      addedDate: u.createdAt,
      isOwner: false,
    }));

    // The owner may not exist as a POS user row, but the spec requires they
    // always appear. Synthesise from the store record and de-duplicate by
    // phone so a real owner account isn't listed twice.
    const ownerPhone = store.ownerPhone || restaurant?.ownerPhone || "";
    const ownerRow = staff.find((s) => s.phone && s.phone === ownerPhone);
    if (ownerRow) {
      ownerRow.isOwner = true;
      ownerRow.role = "Owner";
    } else {
      staff.unshift({
        id: null,
        name: store.ownerName || restaurant?.ownerName || "Restaurant Owner",
        role: "Owner",
        phone: ownerPhone,
        email: restaurant?.ownerEmail || "",
        status: "active",
        addedDate: store.createdAt,
        isOwner: true,
        synthesised: true,
      });
    }

    res.status(200).json({ success: true, data: { staff, total: staff.length } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/csd/restaurants/:storeId/activity
 *
 * §33 — everything recorded against this restaurant: CSD audit entries, POS
 * support sessions, and job lifecycle events, merged chronologically.
 */
const getActivity = async (req, res, next) => {
  try {
    const storeId = str(req.params.storeId);
    await loadStore(storeId);

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    const [audits, sessions, jobs] = await Promise.all([
      AuditLog.find({ storeId }).sort({ timestamp: -1 }).limit(limit).lean(),
      CsdPosSession.find({ storeId, usedAt: { $ne: null } }).sort({ usedAt: -1 }).limit(30).lean(),
      CsdJob.find({ storeId }).sort({ updatedAt: -1 }).limit(30).lean(),
    ]);

    const entries = [
      ...audits.map((a) => ({
        kind: "audit",
        action: a.action,
        description: a.description || a.action,
        by: a.role?.startsWith("csd:") ? a.phone : a.role || "",
        at: a.timestamp,
        severity: a.severity,
      })),
      ...sessions.map((s) => ({
        kind: "pos_session",
        action: "POS_SUPPORT_ACCESS",
        description: `${s.staffName} opened a POS support session${s.reason ? ` — ${s.reason}` : ""}`,
        by: s.staffCode,
        at: s.usedAt,
        severity: "WARNING",
      })),
      ...jobs.map((j) => ({
        kind: "job",
        action: j.status === "closed" ? "JOB_CLOSED" : "JOB_ACTIVE",
        description: `${j.jobId}: ${j.title}`,
        by: j.assignedToName || j.createdByName,
        at: j.closedAt || j.updatedAt,
        severity: "INFO",
      })),
    ]
      .filter((e) => e.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, limit);

    res.status(200).json({ success: true, data: { entries, total: entries.length } });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/csd/restaurants/:storeId/google-business — admin only. */
const updateGoogleBusiness = async (req, res, next) => {
  try {
    const storeId = str(req.params.storeId);
    const { restaurant } = await loadStore(storeId);
    if (!restaurant) return next(createHttpError(404, "This store has no restaurant record."));

    const url = str(req.body?.googleBusinessUrl);
    if (url && !/^https?:\/\//i.test(url)) {
      return next(createHttpError(400, "Enter a full URL starting with http:// or https://", {
        fieldErrors: { googleBusinessUrl: "Must start with http:// or https://" },
      }));
    }

    const previous = restaurant.googleBusinessUrl || "";
    await Restaurant.updateOne({ _id: restaurant._id }, { $set: { googleBusinessUrl: url } });

    await csdAudit({
      req, staff: req.csdStaff,
      action: "CSD_GOOGLE_BUSINESS_UPDATED",
      resource: "Restaurant", entityType: "Restaurant", entityId: restaurant._id, storeId,
      description: `Google Business URL ${previous ? "updated" : "added"} for ${storeId}`,
      previousValue: { googleBusinessUrl: previous }, newValue: { googleBusinessUrl: url },
    });

    res.status(200).json({ success: true, data: { googleBusinessUrl: url } });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/csd/restaurants/:storeId/charges — admin only (§29). */
const updateCharges = async (req, res, next) => {
  try {
    const storeId = str(req.params.storeId);
    const { restaurant } = await loadStore(storeId);

    const b = req.body || {};
    const fieldErrors = {};
    const patch = {};

    for (const [key, label, max] of [
      ["onlinePaidOrderCharge", "Online paid order charge", 10000],
      ["ebillCharge", "E-bill charge", 1000],
      ["gstPercent", "GST percentage", 100],
      ["monthlySubscription", "Monthly subscription", 1000000],
    ]) {
      if (b[key] === undefined) continue;
      const n = Number(b[key]);
      if (Number.isNaN(n) || n < 0) fieldErrors[key] = `${label} must be a positive number.`;
      else if (n > max) fieldErrors[key] = `${label} looks too large.`;
      else patch[key] = n;
    }
    if (b.notes !== undefined) patch.notes = str(b.notes).slice(0, 1000);
    if (b.billingExempt !== undefined) {
      if (typeof b.billingExempt !== "boolean") {
        fieldErrors.billingExempt = "Must be true or false.";
      } else {
        patch.billingExempt = b.billingExempt;
      }
    }

    /**
     * A negotiated price for a specific plan -- "ABC pays 999 for Growth"
     * while the standard price stays 1299.
     *
     * Sent as a whole list, not a patch, so removing an entry is possible:
     * with a merge there would be no way to put a restaurant back on the
     * standard price once it had been given a special one.
     */
    if (b.planPrices !== undefined) {
      if (!Array.isArray(b.planPrices)) {
        fieldErrors.planPrices = "Plan prices must be a list.";
      } else {
        const seen = new Set();
        patch.planPrices = b.planPrices.map((row, i) => {
          const code = str(row?.code).trim().toLowerCase();
          const price = Number(row?.price);
          if (!code) fieldErrors[`planPrices.${i}.code`] = "Pick a plan.";
          if (seen.has(code)) fieldErrors[`planPrices.${i}.code`] = "That plan is listed twice.";
          seen.add(code);
          if (Number.isNaN(price) || price < 0) {
            fieldErrors[`planPrices.${i}.price`] = "Price must be zero or more.";
          } else if (price > 1000000) {
            fieldErrors[`planPrices.${i}.price`] = "Price looks too large.";
          }
          return { code, price };
        });
      }
    }

    if (Object.keys(fieldErrors).length) {
      return next(createHttpError(400, "Please correct the highlighted fields.", { fieldErrors }));
    }
    if (!Object.keys(patch).length) return next(createHttpError(400, "Nothing to update."));

    // Materialise the row from defaults on first edit.
    const existing =
      (await CsdStoreCharges.findOne({ storeId })) ||
      new CsdStoreCharges({ storeId, ...CsdStoreCharges.DEFAULTS });

    const previous = {
      onlinePaidOrderCharge: existing.onlinePaidOrderCharge,
      gstPercent: existing.gstPercent,
      monthlySubscription: existing.monthlySubscription,
      billingExempt: Boolean(existing.billingExempt),
    };

    for (const [k, v] of Object.entries(patch)) {
      if (k === "planPrices") {
        existing.history.push({
          field: k,
          from: (existing.planPrices || []).map((p) => `${p.code}:${p.price}`).join(", "),
          to: v.map((p) => `${p.code}:${p.price}`).join(", "),
          byId: req.csdStaff._id, byStaffId: req.csdStaff.staffId, byName: req.csdStaff.fullName,
        });
      } else if (k !== "notes" && existing[k] !== v) {
        existing.history.push({
          field: k, from: existing[k], to: v,
          byId: req.csdStaff._id, byStaffId: req.csdStaff.staffId, byName: req.csdStaff.fullName,
        });
      }
      existing[k] = v;
    }
    await existing.save();

    // Making a locked store a demo store should unlock it now, not at the next
    // sweep; turning it back into a normal store re-checks.
    if (patch.billingExempt !== undefined && restaurant?._id) {
      require("../services/accountLock").fireEvaluateLock(restaurant._id);
    }

    await csdAudit({
      req, staff: req.csdStaff,
      action: "CSD_STORE_CHARGES_UPDATED",
      resource: "CsdStoreCharges", entityType: "CsdStoreCharges", entityId: existing._id, storeId,
      description: `Charges updated for ${storeId}`,
      previousValue: previous,
      newValue: patch,
      severity: "WARNING",
    });

    res.status(200).json({
      success: true,
      data: {
        onlinePaidOrderCharge: existing.onlinePaidOrderCharge,
        gstPercent: existing.gstPercent,
        monthlySubscription: existing.monthlySubscription,
        ebillCharge: existing.ebillCharge,
        billingExempt: Boolean(existing.billingExempt),
        planPrices: existing.planPrices || [],
        notes: existing.notes,
        plan: restaurant?.subscription?.plan || "free",
        usingDefaults: false,
        canEdit: true,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/csd/restaurants/:storeId/pos-session   (§22)
 *
 * Mints a short-lived, single-use token that lets an authorised CSD member
 * open this restaurant's POS as a support session, without the owner's OTP.
 *
 * This endpoint hands out access to a customer's live business data, so:
 *   - only the token HASH is stored (a database dump yields nothing usable);
 *   - it expires in minutes and is redeemable exactly once;
 *   - it is bound to this storeId AND this staff member;
 *   - issuing is audited here, and redemption is audited again on use, so the
 *     record shows both intent and actual entry.
 *
 * The POS backend must still validate the token before honouring it — this
 * only issues the credential.
 */
const POS_SESSION_TTL_MS = 5 * 60 * 1000;

const createPosSession = async (req, res, next) => {
  try {
    const storeId = str(req.params.storeId);
    const { store, restaurant } = await loadStore(storeId);
    if (!restaurant) return next(createHttpError(400, "This store has no restaurant record to open."));

    if (["deleted"].includes(store.status)) {
      return next(createHttpError(400, "This store has been deleted."));
    }

    const raw = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
    const expiresAt = new Date(Date.now() + POS_SESSION_TTL_MS);

    await CsdPosSession.create({
      tokenHash,
      storeId,
      restaurantId: restaurant._id,
      restaurantName: restaurant.name || store.storeName || "",
      staffId: req.csdStaff._id,
      staffCode: req.csdStaff.staffId,
      staffName: req.csdStaff.fullName,
      staffRole: req.csdStaff.role,
      reason: str(req.body?.reason).slice(0, 500),
      expiresAt,
      issuedFromIp: (req.headers["x-real-ip"] || req.ip || "").toString().split(",")[0].trim(),
      userAgent: str(req.headers["user-agent"]).slice(0, 300),
    });

    await csdAudit({
      req, staff: req.csdStaff,
      action: "CSD_POS_SESSION_ISSUED",
      resource: "Restaurant", entityType: "Store", entityId: store._id, storeId,
      description: `${req.csdStaff.staffId} requested POS support access to ${storeId}`,
      newValue: { reason: str(req.body?.reason) || null, expiresAt },
      severity: "WARNING",
    });

    // Per-store POS host. NOTE: `<storeId>.business.<domain>` needs its own
    // wildcard DNS record and certificate — a `*.<domain>` wildcard does not
    // cover a two-label subdomain. `posHostReady` tells the UI whether that
    // is actually reachable so it can avoid sending staff to a dead link.
    const base = config.baseDomain || "";
    const posHost = base ? `${storeId}.business.${base}` : "";

    res.status(201).json({
      success: true,
      data: {
        token: raw, // returned once, never stored in plaintext
        expiresAt,
        storeId,
        restaurantName: restaurant.name || store.storeName || "",
        posHost,
        posUrl: posHost ? `https://${posHost}/support-session?token=${raw}` : "",
        fallbackUrl: base ? `https://business.${base}/support-session?token=${raw}&store=${storeId}` : "",
        posHostReady: false,
        // The impersonation landing route lives on the platform-wide POS host
        // (business.<domain>), which is guaranteed reachable — unlike the
        // per-store <storeId>.business.<domain> subdomains that still need
        // wildcard DNS + a cert. This is what the CSD "Open POS" button uses.
        impersonateUrl: base ? `https://business.${base}/impersonate?token=${raw}` : "",
        ttlSeconds: Math.round(POS_SESSION_TTL_MS / 1000),
      },
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/csd/restaurants/:storeId/pos-sessions — who has accessed this POS. */
const listPosSessions = async (req, res, next) => {
  try {
    const storeId = str(req.params.storeId);
    await loadStore(storeId);

    const sessions = await CsdPosSession.find({ storeId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.status(200).json({
      success: true,
      data: sessions.map((s) => ({
        id: String(s._id),
        staffCode: s.staffCode,
        staffName: s.staffName,
        staffRole: s.staffRole,
        reason: s.reason,
        issuedAt: s.createdAt,
        usedAt: s.usedAt,
        expiresAt: s.expiresAt,
        // An unused, expired token means nobody actually entered the POS.
        outcome: s.usedAt ? "used" : s.expiresAt < new Date() ? "expired unused" : "pending",
      })),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getRestaurant, getCustomers, getOrderSummary, getRestaurantStaff, getActivity,
  updateGoogleBusiness, updateCharges, createPosSession, listPosSessions,
  loadStore, periodWindow, PERIODS,
};
