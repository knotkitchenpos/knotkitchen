/**
 * Printer and tablet requests: a store asks from POS Billing, KnotKitchen
 * (CSD) delivers.
 *
 *   REQUESTED  paid; the store can still cancel it itself (full refund)
 *   ACCEPTED   KnotKitchen is preparing it
 *   DISPATCHED on its way (courier, tracking)
 *   DELIVERED  handed over and set up
 *   CANCELLED  the printer/tablet is released and the refund is in the wallet
 *
 * Paying is unchanged: a printer is paid through Cashfree (services/recharge),
 * a tablet from the wallet (services/subscription rentTablet). Each opens its
 * request here once the payment has landed, keyed by the payment's own key,
 * so a retried payment opens one request.
 *
 * A refund always goes to the wallet (a REFUND ledger credit), for a card
 * payment too: it is instant, needs no gateway round trip, and pays the
 * store's next bills. Never through afterRecharge -- a refund is not a top-up
 * and must not start a plan or earn a tablet.
 */

const HardwareRequest = require("../models/hardwareRequestModel");
const { PlatformSubscription, PlatformInvoice } = require("../models/platformSubscriptionModel");
const RechargeOrder = require("../models/rechargeOrderModel");
const Restaurant = require("../models/restaurantModel");
const { InvoiceCounter } = require("./invoiceNumber");
const { credit, findByIdempotencyKey } = require("./ledger");
const { findOrCreate } = require("./idempotency");
const { asAmount, formatINR } = require("./money");

class HardwareRequestError extends Error {
  constructor(message, status = 400, code = "") {
    super(message);
    this.name = "HardwareRequestError";
    this.status = status;
    if (code) this.code = code;
  }
}

// Printers and tablets from before requests existed were handled by hand;
// only rows from here on get a request (see reconcile).
const LAUNCHED_AT = new Date("2026-09-25T00:00:00+05:30");

const OPEN = ["REQUESTED", "ACCEPTED", "DISPATCHED"];

// CSD moves. Delivering straight from ACCEPTED is a technician carrying it in.
// Dispatching again while DISPATCHED corrects the tracking.
const MOVES = {
  accept: { from: ["REQUESTED"], to: "ACCEPTED" },
  dispatch: { from: ["ACCEPTED", "DISPATCHED"], to: "DISPATCHED" },
  deliver: { from: ["ACCEPTED", "DISPATCHED"], to: "DELIVERED" },
};

const text = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

// ---------------------------------------------------------------------------
// Delivery address
// ---------------------------------------------------------------------------

/** Where the store's own details say to deliver. */
const defaultShipTo = (restaurant) => {
  const a = restaurant?.address || {};
  return {
    name: text(restaurant?.ownerName || restaurant?.name, 80),
    phone: cleanPhone(restaurant?.ownerPhone || restaurant?.contactPersonPhone || restaurant?.restaurantPhone),
    line1: text(a.line1, 200),
    line2: text(a.line2, 200),
    city: text(a.city, 80),
    state: text(a.state, 80),
    postalCode: text(a.postalCode, 10),
    note: "",
  };
};

/** A 10-digit Indian mobile, from "+91 98300 12345", "098300..." and the like. */
const cleanPhone = (raw) => {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
};

/**
 * The address a courier can deliver to, or a 400 naming what is missing.
 * `raw` absent (an older till) falls back to the store's own details.
 */
const resolveShipTo = async (restaurantId, raw) => {
  let input = raw && typeof raw === "object" ? raw : null;
  if (!input) {
    const restaurant = await Restaurant.findById(restaurantId)
      .select("name ownerName ownerPhone contactPersonPhone restaurantPhone address")
      .lean();
    input = defaultShipTo(restaurant);
  }
  const shipTo = {
    name: text(input.name, 80),
    phone: cleanPhone(input.phone),
    line1: text(input.line1, 200),
    line2: text(input.line2, 200),
    city: text(input.city, 80),
    state: text(input.state, 80),
    postalCode: text(input.postalCode, 10).replace(/\s/g, ""),
    note: text(input.note, 300),
  };
  const missing = [];
  if (shipTo.name.length < 2) missing.push("a contact name");
  if (!/^[6-9]\d{9}$/.test(shipTo.phone)) missing.push("a 10-digit mobile number");
  if (shipTo.line1.length < 3) missing.push("the address");
  if (!shipTo.city) missing.push("the city");
  if (!shipTo.state) missing.push("the state");
  if (!/^[1-9]\d{5}$/.test(shipTo.postalCode)) missing.push("a 6-digit PIN code");
  if (missing.length) {
    throw new HardwareRequestError(`Add ${missing.join(", ")} for the delivery.`, 400, "SHIP_TO_INVALID");
  }
  return shipTo;
};

// ---------------------------------------------------------------------------
// Opening a request (called once the payment has landed)
// ---------------------------------------------------------------------------

const nextRequestNo = async (storeId) => {
  const store = String(storeId || "000000");
  const counter = await InvoiceCounter.findOneAndUpdate(
    { key: `hwreq:${store}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `HR-${store}-${String(counter.seq).padStart(3, "0")}`;
};

/**
 * One request per payment key; a repeat returns the first. Never throws for
 * a missing detail -- the payment has already happened, so the request must
 * exist; CSD calls the store if the address is short.
 */
const openRequest = async ({ type, key, restaurantId, item = {}, payment = {}, shipTo = null, on = new Date() }) => {
  const find = () => HardwareRequest.findOne({ key });
  const { doc } = await findOrCreate({
    find,
    create: async () => {
      const [restaurant, subscription] = await Promise.all([
        Restaurant.findById(restaurantId)
          .select("name storeId ownerName ownerPhone contactPersonPhone restaurantPhone address")
          .lean(),
        PlatformSubscription.findOne({ restaurantId }).select("_id storeId hardware").lean(),
      ]);
      const storeId = restaurant?.storeId || subscription?.storeId || "";
      // A tablet is paid by a wallet debit under the same key as the request;
      // a printer's invoice is fixed on its hardware row.
      const entry = type === "TABLET" ? await findByIdempotencyKey(key) : null;
      const invoiceId =
        payment.invoiceId ||
        (type === "PRINTER"
          ? (subscription?.hardware || []).find((h) => h.key === key)?.invoiceId
          : entry && (await PlatformInvoice.findOne({ restaurantId, ledgerEntryId: entry._id }).select("_id").lean())?._id) ||
        null;
      const amountPaise = type === "TABLET" ? Number(entry?.amountPaise) || 0 : Math.round(Number(payment.amountPaise) || 0);
      return HardwareRequest.create({
        requestNo: await nextRequestNo(storeId),
        key,
        restaurantId,
        storeId,
        restaurantName: restaurant?.name || "",
        type,
        item: { code: item.code || "", name: item.name || (type === "TABLET" ? "Tablet" : "Printer"), tabletSerial: item.tabletSerial ?? null },
        payment: {
          method: amountPaise > 0 ? (type === "TABLET" ? "WALLET" : "GATEWAY") : "NONE",
          amountPaise,
          gatewayOrderId: payment.gatewayOrderId || "",
          ledgerEntryId: entry?._id || null,
          invoiceId,
        },
        shipTo: shipTo || defaultShipTo(restaurant),
        status: "REQUESTED",
        history: [{ from: "", to: "REQUESTED", byType: "STORE", note: amountPaise > 0 ? `Paid ${formatINR(amountPaise)}` : "", at: on }],
      });
    },
  });
  return doc;
};

// ---------------------------------------------------------------------------
// Cancelling, with the refund
// ---------------------------------------------------------------------------

const notify = (request) => {
  try {
    require("./socket").emitToRestaurant(String(request.restaurantId), "hardwareRequest:updated", {
      id: String(request._id),
      status: request.status,
    });
  } catch (err) {
    console.warn("[hardwareRequests] notify failed:", err.message);
  }
};

/**
 * Release the printer/tablet, refund, and mark the invoice. Every step is
 * guarded to happen once, so a cancel interrupted halfway is finished by
 * calling this again.
 */
const settleCancellation = async (request) => {
  const at = request.cancel?.at || new Date();
  if (request.type === "TABLET") {
    // Ends now (not at the period end, as a returned tablet does): it was
    // never handed over, so it must not renew. On a plan whose period has
    // already run out (expired), at that period's end, or the renewal that
    // follows the refund would bill it again. The tablet top-up it used is
    // given back. A tablet CSD had already set to end later is ended too.
    // Once ended at or before `end` it no longer matches, so this runs once.
    // The row stays, so tablet numbers never repeat.
    const sub = await PlatformSubscription.findOne({ restaurantId: request.restaurantId }).select("currentPeriodEnd").lean();
    const periodEnd = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
    const end = periodEnd && periodEnd < new Date(at) ? periodEnd : new Date(at);
    await PlatformSubscription.updateOne(
      {
        restaurantId: request.restaurantId,
        tablets: { $elemMatch: { serial: request.item.tabletSerial, endsAt: { $not: { $lte: end } } } },
      },
      { $set: { "tablets.$.endsAt": end }, $inc: { tabletRechargeCredits: 1 } },
    );
  } else {
    await PlatformSubscription.updateOne(
      { restaurantId: request.restaurantId, hardware: { $elemMatch: { key: request.key, cancelledAt: null } } },
      { $set: { "hardware.$.cancelledAt": at } },
    );
  }

  const refundPaise = Math.round(Number(request.cancel?.refundPaise) || 0);
  let refundLedgerEntryId = null;
  if (refundPaise > 0) {
    const { entry } = await credit({
      restaurantId: request.restaurantId,
      kind: "REFUND",
      amountPaise: refundPaise,
      description: `Refund: ${request.item.name} (${request.requestNo})`,
      idempotencyKey: `hwreq-refund-${request._id}`,
      refType: "HardwareRequest",
      refId: request._id,
      meta: { requestNo: request.requestNo, by: request.cancel?.byName || "", reason: request.cancel?.reason || "" },
    });
    refundLedgerEntryId = entry?._id || null;
    // Money arrived: collect dues and lift a lock, as a top-up does.
    try {
      await require("./orderCharge").settlePendingCharges(request.restaurantId);
      await require("./accountLock").evaluateLock(request.restaurantId);
    } catch (err) {
      console.warn("[hardwareRequests] settling after refund failed:", err.message);
    }
  }

  if (request.payment?.invoiceId) {
    const paid = Number(request.cancel?.paidPaise) || Number(request.payment.amountPaise) || 0;
    const full = refundPaise > 0 && refundPaise >= paid;
    // No credit notes yet: a full refund voids the invoice; a part refund is noted on it.
    await PlatformInvoice.updateOne(
      { _id: request.payment.invoiceId, status: "PAID" },
      {
        $set: full
          ? { status: "VOID", notes: `Cancelled (${request.requestNo}). ${formatINR(refundPaise)} refunded to the KnotKitchen wallet.` }
          : { notes: `${request.requestNo} cancelled. ${formatINR(refundPaise)} refunded to the KnotKitchen wallet.` },
      },
    );
  }

  return HardwareRequest.findOneAndUpdate(
    { _id: request._id },
    { $set: { "cancel.settledAt": new Date(), "cancel.refundLedgerEntryId": refundLedgerEntryId } },
    { new: true },
  );
};

/**
 * Everything the store paid for this request. A tablet still waiting for
 * delivery when a period ended was renewed with the plan (renewal invoices
 * carry a "Tablet #N rental — ..." line); that share is refundable too.
 */
const refundableFor = async (request) => {
  let paid = Number(request.payment?.amountPaise) || 0;
  if (request.type === "TABLET" && request.item?.tabletSerial != null) {
    const tag = `Tablet #${request.item.tabletSerial} rental — `;
    const renewals = await PlatformInvoice.find({
      restaurantId: request.restaurantId,
      kind: "SUBSCRIPTION",
      status: "PAID",
      createdAt: { $gte: request.createdAt },
    })
      .select("lines")
      .lean();
    for (const inv of renewals) {
      for (const l of inv.lines || []) if (String(l.description || "").startsWith(tag)) paid += Number(l.totalPaise) || 0;
    }
  }
  return paid;
};

/**
 * Cancel a request. The store may cancel only while it is REQUESTED, and
 * always gets everything back. CSD may cancel until it is delivered and
 * decides the refund (all by default; less when, say, it was already shipped).
 * `refundPaise` null means all of it.
 */
const cancelRequest = async ({ id, restaurantId = null, by, reason = "", refundPaise = null }) => {
  let request = await HardwareRequest.findOne({ _id: id, ...(restaurantId ? { restaurantId } : {}) });
  if (!request) throw new HardwareRequestError("No such request.", 404);

  if (request.status === "CANCELLED") {
    if (request.cancel?.settledAt) {
      // The store asking twice is harmless. CSD cancelling one someone else
      // already cancelled must not be recorded as this person's refund.
      if (by.type === "CSD") {
        throw new HardwareRequestError(
          `Already cancelled by ${request.cancel?.byType === "STORE" ? "the store" : request.cancel?.byName || "KnotKitchen"}.`,
          409,
          "ALREADY_CANCELLED",
        );
      }
      return request;
    }
    // Interrupted halfway: finish it below.
  } else {
    const allowed = by.type === "STORE" ? ["REQUESTED"] : OPEN;
    if (!allowed.includes(request.status)) {
      throw new HardwareRequestError(
        by.type === "STORE"
          ? "KnotKitchen is already preparing this. Call support to cancel it."
          : "A delivered request cannot be cancelled. A tablet coming back is ended from the store's page.",
        409,
        "NOT_CANCELLABLE",
      );
    }
    const paid = await refundableFor(request);
    const refund = refundPaise == null || by.type === "STORE" ? paid : Math.round(Number(refundPaise));
    if (!Number.isFinite(refund) || refund < 0 || refund > paid) {
      throw new HardwareRequestError(`The refund can be at most ${formatINR(paid)}.`, 400, "REFUND_TOO_LARGE");
    }
    const cleanReason = text(reason, 300);
    if (by.type === "CSD" && cleanReason.length < 3) throw new HardwareRequestError("Say why it is cancelled.", 400);
    const at = new Date();
    request = await HardwareRequest.findOneAndUpdate(
      { _id: request._id, status: request.status },
      {
        $set: {
          status: "CANCELLED",
          cancel: {
            reason: cleanReason,
            byType: by.type,
            byName: text(by.name, 80),
            at,
            paidPaise: paid,
            refundPaise: refund,
            refundLedgerEntryId: null,
            settledAt: null,
          },
        },
        $push: {
          history: {
            from: request.status,
            to: "CANCELLED",
            byType: by.type,
            byId: String(by.id || ""),
            byName: text(by.name, 80),
            note: [cleanReason, refund > 0 ? `${formatINR(refund)} refunded to the wallet` : "No refund"].filter(Boolean).join(". "),
            at,
          },
        },
      },
      { new: true },
    );
    if (!request) throw new HardwareRequestError("This request changed just now. Reload and try again.", 409, "CHANGED");
  }

  const settled = await settleCancellation(request);
  notify(settled);
  return settled;
};

// ---------------------------------------------------------------------------
// CSD: moving a request along
// ---------------------------------------------------------------------------

const cleanUrl = (raw) => {
  const s = text(raw, 300);
  if (!s) return "";
  try {
    const url = new URL(s);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};

/**
 * accept | dispatch {courier, trackingNo, trackingUrl, expectedBy} |
 * deliver {deviceSerial}. Conditional on the status read, so two staff
 * pressing at once move it once.
 */
const advance = async ({ id, action, staff, fields = {} }) => {
  const move = MOVES[action];
  if (!move) throw new HardwareRequestError("Unknown action.", 400);
  const request = await HardwareRequest.findById(id);
  if (!request) throw new HardwareRequestError("No such request.", 404);
  if (!move.from.includes(request.status)) {
    throw new HardwareRequestError(`A ${request.status.toLowerCase()} request cannot be ${move.to.toLowerCase()}.`, 409, "BAD_MOVE");
  }

  const at = new Date();
  const set = { status: move.to };
  const note = text(fields.note, 500);
  if (action === "dispatch") {
    const courier = text(fields.courier, 60);
    if (courier.length < 2) throw new HardwareRequestError("Name the courier (or who is taking it).", 400);
    const trackingUrl = cleanUrl(fields.trackingUrl);
    if (trackingUrl === null) throw new HardwareRequestError("The tracking link must start with https://", 400);
    const expectedBy = fields.expectedBy ? new Date(fields.expectedBy) : null;
    if (expectedBy && Number.isNaN(expectedBy.getTime())) throw new HardwareRequestError("The expected date is not a date.", 400);
    set.dispatch = {
      courier,
      trackingNo: text(fields.trackingNo, 60),
      trackingUrl,
      expectedBy,
      at: request.dispatch?.at || at,
    };
  }
  if (action === "deliver") {
    set.deliveredAt = at;
    set.deviceSerial = text(fields.deviceSerial, 80);
  }

  const updated = await HardwareRequest.findOneAndUpdate(
    { _id: request._id, status: request.status },
    {
      $set: set,
      $push: {
        history: {
          from: request.status,
          to: move.to,
          byType: "CSD",
          byId: String(staff?._id || ""),
          byName: text(staff?.fullName, 80),
          note:
            action === "dispatch" && request.status === "DISPATCHED"
              ? ["Tracking updated", note].filter(Boolean).join(". ")
              : note,
          at,
        },
      },
    },
    { new: true },
  );
  if (!updated) throw new HardwareRequestError("This request changed just now. Reload and try again.", 409, "CHANGED");
  notify(updated);
  return { request: updated, from: request.status };
};

const addNote = async ({ id, staff, body }) => {
  const clean = text(body, 2000);
  if (!clean) throw new HardwareRequestError("Write the note first.", 400);
  const updated = await HardwareRequest.findOneAndUpdate(
    { _id: id },
    { $push: { notes: { body: clean, byId: String(staff?._id || ""), byName: text(staff?.fullName, 80), at: new Date() } } },
    { new: true },
  );
  if (!updated) throw new HardwareRequestError("No such request.", 404);
  return updated;
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Opening a request is a separate write after the payment, so a crash in
 * between could leave a paid printer/tablet with no request. Checked when
 * the store opens Billing: anything paid since launch without a request gets
 * one, and a cancel interrupted halfway is finished.
 */
const reconcile = async (restaurantId) => {
  const sub = await PlatformSubscription.findOne({ restaurantId }).select("_id tablets hardware").lean();
  if (sub) {
    const since = LAUNCHED_AT.getTime();
    const paid = [
      ...(sub.hardware || [])
        .filter((h) => h.key && !h.cancelledAt && new Date(h.purchasedAt).getTime() >= since)
        .map((h) => ({ type: "PRINTER", key: h.key, item: { code: h.code, name: h.name }, amountPaise: h.totalPaise, invoiceId: h.invoiceId })),
      ...(sub.tablets || [])
        .filter((t) => !t.endsAt && new Date(t.rentedAt).getTime() >= since)
        .map((t) => ({
          type: "TABLET",
          key: `tablet-${sub._id}-${t.serial}`,
          item: { code: "TABLET", name: `Tablet #${t.serial}`, tabletSerial: t.serial },
          // Kept on the row by rentTablet, so the address typed survives.
          shipTo: t.shipTo || null,
        })),
    ];
    if (paid.length) {
      const have = new Set((await HardwareRequest.find({ key: { $in: paid.map((p) => p.key) } }).select("key").lean()).map((r) => r.key));
      for (const p of paid.filter((x) => !have.has(x.key))) {
        const gatewayOrderId = p.type === "PRINTER" ? p.key.replace(/^printer-pay-/, "") : "";
        const intent = gatewayOrderId ? await RechargeOrder.findOne({ gatewayOrderId }).select("item").lean() : null;
        await openRequest({
          type: p.type,
          key: p.key,
          restaurantId,
          item: p.item,
          payment: { amountPaise: p.amountPaise, invoiceId: p.invoiceId, gatewayOrderId },
          shipTo: p.shipTo || intent?.item?.shipTo || null,
        });
      }
    }
  }
  const unsettled = await HardwareRequest.find({ restaurantId, status: "CANCELLED", "cancel.settledAt": null });
  // notify: the refund just landed, so an open till refreshes its wallet too.
  for (const r of unsettled) notify(await settleCancellation(r));
};

const shipToView = (s = {}) => ({
  name: s.name || "",
  phone: s.phone || "",
  line1: s.line1 || "",
  line2: s.line2 || "",
  city: s.city || "",
  state: s.state || "",
  postalCode: s.postalCode || "",
  note: s.note || "",
});

/** What the store sees: no staff names, no internal notes. */
const storeView = (r) => ({
  id: String(r._id),
  requestNo: r.requestNo,
  type: r.type,
  item: { code: r.item?.code || "", name: r.item?.name || "", tabletSerial: r.item?.tabletSerial ?? null },
  paid: asAmount(r.payment?.amountPaise || 0),
  paidVia: r.payment?.method || "NONE",
  shipTo: shipToView(r.shipTo),
  status: r.status,
  canCancel: r.status === "REQUESTED",
  // What cancelling gives back (a renewed, undelivered tablet included); listForStore fills it in.
  refundable: asAmount(r.refundablePaise ?? r.payment?.amountPaise ?? 0),
  dispatch: r.dispatch?.at
    ? {
        courier: r.dispatch.courier || "",
        trackingNo: r.dispatch.trackingNo || "",
        trackingUrl: r.dispatch.trackingUrl || "",
        expectedBy: r.dispatch.expectedBy || null,
        at: r.dispatch.at,
      }
    : null,
  deliveredAt: r.deliveredAt || null,
  cancel:
    r.status === "CANCELLED"
      ? { reason: r.cancel?.reason || "", at: r.cancel?.at || null, refund: asAmount(r.cancel?.refundPaise || 0), byStore: r.cancel?.byType === "STORE" }
      : null,
  history: (r.history || []).map((h) => ({ to: h.to, at: h.at, by: h.byType === "CSD" ? "KnotKitchen" : h.byType === "STORE" ? "You" : "" })),
  createdAt: r.createdAt,
});

/** What CSD sees: everything. */
const csdView = (r) => ({
  ...storeView(r),
  restaurantId: String(r.restaurantId),
  storeId: r.storeId,
  restaurantName: r.restaurantName,
  deviceSerial: r.deviceSerial || "",
  payment: {
    method: r.payment?.method || "NONE",
    amount: asAmount(r.payment?.amountPaise || 0),
    gatewayOrderId: r.payment?.gatewayOrderId || "",
    invoiceId: r.payment?.invoiceId ? String(r.payment.invoiceId) : null,
  },
  cancel:
    r.status === "CANCELLED"
      ? {
          reason: r.cancel?.reason || "",
          at: r.cancel?.at || null,
          by: r.cancel?.byType === "STORE" ? "Store" : r.cancel?.byName || "KnotKitchen",
          refund: asAmount(r.cancel?.refundPaise || 0),
          settled: Boolean(r.cancel?.settledAt),
        }
      : null,
  history: (r.history || []).map((h) => ({ from: h.from, to: h.to, at: h.at, byType: h.byType, byName: h.byName, note: h.note })),
  notes: (r.notes || []).map((n) => ({ id: String(n._id), body: n.body, byName: n.byName, at: n.at })),
  updatedAt: r.updatedAt,
});

const listForStore = async (restaurantId) => {
  try {
    await reconcile(restaurantId);
  } catch (err) {
    console.warn("[hardwareRequests] reconcile failed:", err.message);
  }
  const rows = await HardwareRequest.find({ restaurantId }).sort({ createdAt: -1 }).limit(50).lean();
  for (const r of rows) if (r.status === "REQUESTED" && r.type === "TABLET") r.refundablePaise = await refundableFor(r);
  return rows.map(storeView);
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The CSD queue: open ones first, oldest waiting at the top. */
/**
 * The CSD queue. An open status lists the oldest waiting first; delivered,
 * cancelled and "All" list the latest activity first. The tab counts follow
 * the same store/type/search filter.
 */
const listForCsd = async ({ status = "", type = "", storeId = "", q = "", page = 1, limit = 25 } = {}) => {
  const base = {};
  if (type) {
    if (!["PRINTER", "TABLET"].includes(type)) throw new HardwareRequestError("Unknown type.", 400);
    base.type = type;
  }
  if (storeId) base.storeId = text(storeId, 6);
  const search = text(q, 80);
  if (search) {
    const re = new RegExp(escapeRegex(search), "i");
    base.$or = [{ requestNo: re }, { restaurantName: re }, { storeId: re }, { "shipTo.phone": re }];
  }
  const filter = { ...base };
  if (status === "OPEN") filter.status = { $in: OPEN };
  else if (status) {
    if (!HardwareRequest.STATUSES.includes(status)) throw new HardwareRequestError("Unknown status.", 400);
    filter.status = status;
  }
  const size = Math.min(100, Math.max(1, Number(limit) || 25));
  const current = Math.max(1, Number(page) || 1);
  const open = status === "OPEN" || OPEN.includes(status);
  const [rows, total, counts] = await Promise.all([
    HardwareRequest.find(filter)
      .sort(open ? { createdAt: 1, _id: 1 } : { updatedAt: -1, _id: -1 })
      .skip((current - 1) * size)
      .limit(size)
      .lean(),
    HardwareRequest.countDocuments(filter),
    countsForCsd(base),
  ]);
  return { results: rows.map(csdView), total, page: current, pages: Math.max(1, Math.ceil(total / size)), counts };
};

/** Counts per status, for the CSD nav badge (everything) and the queue tabs (filtered). */
const countsForCsd = async (match = {}) => {
  const rows = await HardwareRequest.aggregate([{ $match: match }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
  const counts = Object.fromEntries(HardwareRequest.STATUSES.map((s) => [s, 0]));
  for (const r of rows) if (r._id in counts) counts[r._id] = r.n;
  return { ...counts, OPEN: OPEN.reduce((sum, s) => sum + counts[s], 0) };
};

const getForCsd = async (id) => {
  let r = await HardwareRequest.findById(id).lean();
  if (!r) throw new HardwareRequestError("No such request.", 404);
  // A cancel interrupted before its refund finishes here, so CSD opening it
  // does not have to wait for the store to open Billing.
  if (r.status === "CANCELLED" && !r.cancel?.settledAt) {
    try {
      const settled = await settleCancellation(r);
      notify(settled);
      r = settled?.toObject ? settled.toObject() : settled || r;
    } catch (err) {
      console.warn("[hardwareRequests] finishing a cancel failed:", err.message);
    }
  }
  return csdView(r);
};

module.exports = {
  HardwareRequestError,
  LAUNCHED_AT,
  MOVES,
  resolveShipTo,
  defaultShipTo,
  cleanPhone,
  openRequest,
  cancelRequest,
  settleCancellation,
  advance,
  addNote,
  reconcile,
  listForStore,
  listForCsd,
  countsForCsd,
  getForCsd,
  storeView,
  csdView,
};
