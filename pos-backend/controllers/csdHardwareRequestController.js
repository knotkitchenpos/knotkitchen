const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const { csdAudit } = require("../services/csdAuditService");
const { toPaise, formatINR } = require("../services/money");
const {
  HardwareRequestError,
  advance,
  addNote,
  cancelRequest,
  listForCsd,
  countsForCsd,
  getForCsd,
  csdView,
} = require("../services/hardwareRequests");

/**
 * The CSD queue of printer and tablet requests from POS Billing.
 *
 * Any CSD staff works the queue (accept, dispatch, deliver, notes). Cancelling
 * moves money back to the store's wallet, so it is admin-only (csdRoute).
 * Every change is audited against the store, so it shows on its Activity.
 */

const fail = (err, next) =>
  err instanceof HardwareRequestError ? next(createHttpError(err.status, err.message, { code: err.code })) : next(err);

const idOr404 = (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HardwareRequestError("No such request.", 404);
  return req.params.id;
};

const audit = (req, request, action, description, severity = "INFO", previousValue, newValue) =>
  csdAudit({
    req,
    staff: req.csdStaff,
    action: `HARDWARE_REQUEST.${action}`,
    resource: "HardwareRequest",
    entityType: "HardwareRequest",
    entityId: String(request._id),
    storeId: request.storeId || "",
    description: `${request.requestNo} (${request.item?.name}): ${description} -- ${req.csdStaff?.staffId || ""} ${req.csdStaff?.fullName || ""}`.trim(),
    previousValue,
    newValue,
    severity,
  });

// GET /api/csd/hardware-requests?status=OPEN|REQUESTED|...&type=&storeId=&q=&page=
const listHardwareRequests = async (req, res, next) => {
  try {
    const page = await listForCsd({
      status: String(req.query.status || "").toUpperCase(),
      type: String(req.query.type || "").toUpperCase(),
      storeId: String(req.query.storeId || ""),
      q: String(req.query.q || ""),
      page: req.query.page,
      limit: req.query.limit,
    });
    res.status(200).json({ success: true, data: page });
  } catch (err) {
    fail(err, next);
  }
};

// GET /api/csd/hardware-requests/counts — the nav badge.
const hardwareRequestCounts = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await countsForCsd() });
  } catch (err) {
    fail(err, next);
  }
};

// GET /api/csd/hardware-requests/:id
const getHardwareRequest = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await getForCsd(idOr404(req)) });
  } catch (err) {
    fail(err, next);
  }
};

const DESCRIBE = {
  accept: () => "accepted",
  dispatch: (r, from) =>
    `${from === "DISPATCHED" ? "tracking updated" : "dispatched"} via ${r.dispatch.courier}${r.dispatch.trackingNo ? ` (${r.dispatch.trackingNo})` : ""}`,
  deliver: (r) => `delivered${r.deviceSerial ? `, device ${r.deviceSerial}` : ""}`,
};

// POST /api/csd/hardware-requests/:id/accept | dispatch | deliver
const moveHardwareRequest = (action) => async (req, res, next) => {
  try {
    const { request, from } = await advance({ id: idOr404(req), action, staff: req.csdStaff, fields: req.body || {} });
    await audit(req, request, action.toUpperCase(), DESCRIBE[action](request, from), "INFO", { status: from }, {
      status: request.status,
      ...(action === "dispatch" ? { dispatch: request.dispatch } : {}),
      ...(action === "deliver" ? { deviceSerial: request.deviceSerial } : {}),
    });
    res.status(200).json({ success: true, data: csdView(request) });
  } catch (err) {
    fail(err, next);
  }
};

// POST /api/csd/hardware-requests/:id/notes { body } — internal, never shown to the store.
const noteHardwareRequest = async (req, res, next) => {
  try {
    const request = await addNote({ id: idOr404(req), staff: req.csdStaff, body: req.body?.body });
    res.status(201).json({ success: true, data: csdView(request) });
  } catch (err) {
    fail(err, next);
  }
};

/**
 * POST /api/csd/hardware-requests/:id/cancel { reason, refund } — admin only.
 * refund in RUPEES; left out means everything the store paid. It goes to the
 * store's KnotKitchen wallet.
 */
const cancelHardwareRequest = async (req, res, next) => {
  try {
    const raw = req.body?.refund;
    const refundPaise = raw === undefined || raw === null || raw === "" ? null : Number.isFinite(Number(raw)) ? toPaise(raw) : NaN;
    if (refundPaise !== null && !Number.isFinite(refundPaise)) throw new HardwareRequestError("The refund is not an amount.", 400);
    const request = await cancelRequest({
      id: idOr404(req),
      by: { type: "CSD", id: req.csdStaff?._id, name: req.csdStaff?.fullName },
      reason: req.body?.reason,
      refundPaise,
    });
    await audit(
      req,
      request,
      "CANCEL",
      `cancelled (${request.cancel?.reason || "no reason"}), ${formatINR(request.cancel?.refundPaise || 0)} refunded to the wallet`,
      "WARNING",
      null,
      { status: request.status, refundPaise: request.cancel?.refundPaise || 0 },
    );
    res.status(200).json({ success: true, data: csdView(request) });
  } catch (err) {
    fail(err, next);
  }
};

module.exports = {
  listHardwareRequests,
  hardwareRequestCounts,
  getHardwareRequest,
  moveHardwareRequest,
  noteHardwareRequest,
  cancelHardwareRequest,
};
