const createHttpError = require("http-errors");
const CsdJob = require("../models/csdJobModel");
const Store = require("../models/storeModel");
const { logActivity } = require("../services/auditService");

/**
 * POS > Help & Support. Each request becomes a job in the CSD Jobs queue,
 * tagged to the store, so support sees it and someone picks it up. The cards
 * used to show "submitted" without sending anything anywhere.
 */
const REQUESTS = {
  printer: { title: "Printer not working", priority: "high" },
  website: { title: "Website not working", priority: "high" },
  menu: { title: "Menu change request", priority: "normal" },
  other: { title: "Other technical issue", priority: "normal" },
  callback: { title: "Call back requested", priority: "high" },
};

// A second tap, or the same request again soon after, lands on the job
// already open rather than queueing a duplicate.
const REPEAT_WINDOW_MS = 30 * 60 * 1000;

const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** POST /api/support/requests  { type, details?, phone?, preferredTime? } */
const createSupportRequest = async (req, res, next) => {
  try {
    const kind = REQUESTS[String(req.body?.type || "")];
    if (!kind) return next(createHttpError(400, "Choose what you need help with."));
    const details = String(req.body?.details ?? "").trim().slice(0, 2000);
    const phone = String(req.body?.phone ?? "").replace(/\D/g, "").slice(-10);
    const preferredTime = clean(req.body?.preferredTime, 60);
    if (req.body?.type === "callback" && phone.length !== 10) {
      return next(createHttpError(400, "Enter a 10-digit phone number for the call back."));
    }

    const storeId = String(req.user?.storeId || "");
    if (!/^\d{6}$/.test(storeId)) return next(createHttpError(400, "This account is not linked to a store."));
    const store = await Store.findOne({ storeId, isDeleted: { $ne: true } }).select("storeName").lean();
    const restaurantName = store?.storeName || "";

    const open = await CsdJob.findOne({
      source: "store",
      storeId,
      title: kind.title,
      status: { $in: ["open", "in_progress"] },
      createdAt: { $gte: new Date(Date.now() - REPEAT_WINDOW_MS) },
    })
      .select("jobId")
      .lean();
    if (open) return res.status(200).json({ success: true, data: { jobId: open.jobId, existing: true } });

    const who = clean(req.user?.name, 80) || "Store user";
    const role = clean(req.user?.role, 40);
    const byName = `${who}${role ? ` (${role})` : ""} · ${restaurantName || storeId}`;
    const description = [
      `Raised from the POS by ${who}${role ? `, ${role}` : ""}${req.user?.phone ? `, phone ${req.user.phone}` : ""}.`,
      phone ? `Call back on ${phone}${preferredTime ? ` (${preferredTime})` : ""}.` : "",
      details ? `\n${details}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    let job = null;
    for (let attempt = 0; attempt < 3 && !job; attempt++) {
      try {
        job = await CsdJob.create({
          jobId: await CsdJob.nextJobId(),
          title: kind.title,
          description,
          storeId,
          restaurantName,
          priority: kind.priority,
          status: "open",
          source: "store",
          createdByName: byName,
          transitions: [{ from: "", to: "open", byName }],
        });
      } catch (err) {
        // Two jobs raced to the same sequential id: take the next one.
        if (err?.code !== 11000) throw err;
      }
    }
    if (!job) return next(createHttpError(500, "Could not send your request. Please call support."));

    await logActivity({
      req,
      action: "SUPPORT_REQUEST_CREATED",
      resource: "CsdJob",
      entityType: "CsdJob",
      entityId: job._id,
      description: `${job.jobId}: ${kind.title}`,
      newValue: { jobId: job.jobId, type: req.body.type },
    });

    res.status(201).json({ success: true, data: { jobId: job.jobId, existing: false } });
  } catch (error) {
    next(error);
  }
};

module.exports = { createSupportRequest, REQUESTS };
