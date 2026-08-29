const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const CsdJob = require("../models/csdJobModel");
const CsdStaff = require("../models/csdStaffModel");
const Store = require("../models/storeModel");
const { csdAudit } = require("../services/csdAuditService");

const { JOB_STATUSES, JOB_PRIORITIES } = CsdJob;
const str = (v) => String(v ?? "").trim();
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Legal status transitions.
 *
 * Reopening a closed job is deliberately allowed (back to in_progress) —
 * work that turns out to be incomplete should reattach to its existing
 * history rather than spawning a second job that loses the original trail.
 */
const NEXT = {
  open: ["in_progress", "closed"],
  in_progress: ["open", "closed"],
  closed: ["in_progress"],
};

const actor = (staff) => ({
  id: staff._id,
  staffId: staff.staffId,
  name: staff.fullName,
});

const shape = (j) => ({
  id: String(j._id),
  jobId: j.jobId,
  title: j.title,
  description: j.description,
  storeId: j.storeId,
  restaurantName: j.restaurantName,
  status: j.status,
  priority: j.priority,
  deadline: j.deadline,
  createdBy: { staffId: j.createdByStaffId, name: j.createdByName, id: String(j.createdById) },
  assignedTo: j.assignedToId
    ? { staffId: j.assignedToStaffId, name: j.assignedToName, id: String(j.assignedToId) }
    : null,
  createdAt: j.createdAt,
  updatedAt: j.updatedAt,
  closedAt: j.closedAt,
  closedByName: j.closedByName,
  commentCount: (j.comments || []).length,
  attachmentCount: (j.attachments || []).length,
});

const shapeFull = (j) => ({
  ...shape(j),
  comments: (j.comments || []).map((c) => ({
    id: String(c._id),
    body: c.body,
    authorStaffId: c.authorStaffId,
    authorName: c.authorName,
    internal: c.internal,
    createdAt: c.createdAt,
  })),
  attachments: (j.attachments || []).map((a) => ({
    id: String(a._id),
    filename: a.filename,
    url: a.url,
    mimeType: a.mimeType,
    size: a.size,
    uploadedAt: a.uploadedAt,
  })),
  transitions: j.transitions || [],
});

/**
 * GET /api/csd/jobs — list with filters.
 *
 * Staff and admin both see all jobs: CSD work is shared, and hiding a
 * colleague's job would defeat the "who did what work" record the spec asks
 * for. `mine=true` narrows to the caller's own assignments.
 */
const listJobs = async (req, res, next) => {
  try {
    const q = req.query || {};
    const filters = {};

    const status = str(q.status);
    if (status) {
      if (!JOB_STATUSES.includes(status)) return next(createHttpError(400, "Unknown status."));
      filters.status = status;
    }

    const priority = str(q.priority);
    if (priority) {
      if (!JOB_PRIORITIES.includes(priority)) return next(createHttpError(400, "Unknown priority."));
      filters.priority = priority;
    }

    if (str(q.storeId)) filters.storeId = str(q.storeId);
    if (q.mine === "true") filters.assignedToId = req.csdStaff._id;

    const assignedTo = str(q.assignedTo);
    if (assignedTo && mongoose.Types.ObjectId.isValid(assignedTo)) filters.assignedToId = assignedTo;
    if (assignedTo === "unassigned") filters.assignedToId = null;

    const search = str(q.q);
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filters.$or = [{ title: rx }, { description: rx }, { jobId: rx }, { restaurantName: rx }];
    }

    const page = Math.max(parseInt(q.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 25, 1), 100);

    const [total, jobs] = await Promise.all([
      CsdJob.countDocuments(filters),
      CsdJob.find(filters)
        // Open work first, then most recently touched.
        .sort({ status: 1, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      data: { results: jobs.map(shape), total, page, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/csd/jobs/:id */
const getJob = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    const job = mongoose.Types.ObjectId.isValid(id)
      ? await CsdJob.findById(id).lean()
      : await CsdJob.findOne({ jobId: id.toUpperCase() }).lean();
    if (!job) return next(createHttpError(404, "Job not found."));
    res.status(200).json({ success: true, data: shapeFull(job) });
  } catch (error) {
    next(error);
  }
};

/** Resolve an assignee id to an active staff member. */
const resolveAssignee = async (assignedToId) => {
  if (!assignedToId) return null;
  if (!mongoose.Types.ObjectId.isValid(assignedToId)) {
    throw createHttpError(400, "Unknown staff member for assignment.");
  }
  const staff = await CsdStaff.findById(assignedToId);
  if (!staff || staff.status !== "active") {
    throw createHttpError(400, "That staff member is not active.");
  }
  return staff;
};

/** POST /api/csd/jobs */
const createJob = async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = str(b.title);
    if (title.length < 3) return next(createHttpError(400, "Give the job a title."));

    const priority = str(b.priority) || "normal";
    if (!JOB_PRIORITIES.includes(priority)) return next(createHttpError(400, "Unknown priority."));

    let deadline = null;
    if (str(b.deadline)) {
      deadline = new Date(b.deadline);
      if (Number.isNaN(deadline.getTime())) return next(createHttpError(400, "Invalid deadline."));
    }

    // Denormalise the restaurant name so a closed job still reads correctly
    // if the store is later renamed.
    let storeId = "";
    let restaurantName = "";
    if (str(b.storeId)) {
      storeId = str(b.storeId);
      if (!/^\d{6}$/.test(storeId)) return next(createHttpError(400, "Store ID must be 6 digits."));
      const store = await Store.findOne({ storeId, isDeleted: { $ne: true } }).lean();
      if (!store) return next(createHttpError(400, "No store with that ID."));
      restaurantName = store.storeName || "";
    }

    const assignee = await resolveAssignee(b.assignedToId);
    const me = actor(req.csdStaff);

    let job = null;
    for (let attempt = 0; attempt < 3 && !job; attempt++) {
      try {
        job = await CsdJob.create({
          jobId: await CsdJob.nextJobId(),
          title,
          description: str(b.description),
          storeId,
          restaurantName,
          priority,
          deadline,
          status: "open",
          createdById: me.id,
          createdByStaffId: me.staffId,
          createdByName: me.name,
          assignedToId: assignee?._id || null,
          assignedToStaffId: assignee?.staffId || "",
          assignedToName: assignee?.fullName || "",
          transitions: [{ from: "", to: "open", byId: me.id, byStaffId: me.staffId, byName: me.name }],
        });
      } catch (err) {
        // Concurrent create raced us to the same sequential id — retry.
        if (err?.code !== 11000) throw err;
      }
    }
    if (!job) return next(createHttpError(500, "Could not allocate a job ID. Please try again."));

    await csdAudit({
      req,
      staff: req.csdStaff,
      action: "CSD_JOB_CREATED",
      resource: "CsdJob",
      entityType: "CsdJob",
      entityId: job._id,
      storeId,
      description: `${job.jobId} created: ${title}`,
      newValue: { jobId: job.jobId, title, priority, storeId, assignedTo: assignee?.staffId || null },
    });

    res.status(201).json({ success: true, data: shapeFull(job.toObject()) });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/csd/jobs/:id — title, description, priority, deadline, assignee. */
const updateJob = async (req, res, next) => {
  try {
    const job = await CsdJob.findById(str(req.params.id));
    if (!job) return next(createHttpError(404, "Job not found."));

    const b = req.body || {};
    const before = {
      title: job.title,
      priority: job.priority,
      deadline: job.deadline,
      assignedTo: job.assignedToStaffId || null,
    };

    if (b.title !== undefined) {
      const title = str(b.title);
      if (title.length < 3) return next(createHttpError(400, "Give the job a title."));
      job.title = title;
    }
    if (b.description !== undefined) job.description = str(b.description);

    if (b.priority !== undefined) {
      if (!JOB_PRIORITIES.includes(str(b.priority))) return next(createHttpError(400, "Unknown priority."));
      job.priority = str(b.priority);
    }

    if (b.deadline !== undefined) {
      if (!str(b.deadline)) job.deadline = null;
      else {
        const d = new Date(b.deadline);
        if (Number.isNaN(d.getTime())) return next(createHttpError(400, "Invalid deadline."));
        job.deadline = d;
      }
    }

    if (b.assignedToId !== undefined) {
      if (!b.assignedToId) {
        job.assignedToId = null;
        job.assignedToStaffId = "";
        job.assignedToName = "";
      } else {
        const staff = await resolveAssignee(b.assignedToId);
        job.assignedToId = staff._id;
        job.assignedToStaffId = staff.staffId;
        job.assignedToName = staff.fullName;
      }
    }

    await job.save();

    await csdAudit({
      req,
      staff: req.csdStaff,
      action: "CSD_JOB_UPDATED",
      resource: "CsdJob",
      entityType: "CsdJob",
      entityId: job._id,
      storeId: job.storeId,
      description: `${job.jobId} updated`,
      previousValue: before,
      newValue: {
        title: job.title,
        priority: job.priority,
        deadline: job.deadline,
        assignedTo: job.assignedToStaffId || null,
      },
    });

    res.status(200).json({ success: true, data: shapeFull(job.toObject()) });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/csd/jobs/:id/status — Open → In Progress → Closed. */
const changeStatus = async (req, res, next) => {
  try {
    const job = await CsdJob.findById(str(req.params.id));
    if (!job) return next(createHttpError(404, "Job not found."));

    const to = str(req.body?.status);
    if (!JOB_STATUSES.includes(to)) return next(createHttpError(400, "Unknown status."));
    if (to === job.status) return next(createHttpError(400, `This job is already ${to.replace("_", " ")}.`));
    if (!NEXT[job.status]?.includes(to)) {
      return next(createHttpError(400, `Cannot move a ${job.status} job to ${to}.`));
    }

    const me = actor(req.csdStaff);
    const from = job.status;
    job.status = to;
    job.transitions.push({ from, to, byId: me.id, byStaffId: me.staffId, byName: me.name });

    if (to === "closed") {
      job.closedAt = new Date();
      job.closedById = me.id;
      job.closedByName = me.name;
    } else {
      // Reopening clears the closure stamp but keeps the transition history.
      job.closedAt = null;
      job.closedById = null;
      job.closedByName = "";
    }

    await job.save();

    await csdAudit({
      req,
      staff: req.csdStaff,
      action: to === "closed" ? "CSD_JOB_CLOSED" : "CSD_JOB_STATUS_CHANGED",
      resource: "CsdJob",
      entityType: "CsdJob",
      entityId: job._id,
      storeId: job.storeId,
      description: `${job.jobId} ${from} → ${to}`,
      previousValue: { status: from },
      newValue: { status: to },
    });

    res.status(200).json({ success: true, data: shapeFull(job.toObject()) });
  } catch (error) {
    next(error);
  }
};

/** POST /api/csd/jobs/:id/comments — append-only. */
const addComment = async (req, res, next) => {
  try {
    const body = str(req.body?.body);
    if (!body) return next(createHttpError(400, "Write something first."));
    if (body.length > 4000) return next(createHttpError(400, "Comment is too long (max 4000 characters)."));

    const job = await CsdJob.findById(str(req.params.id));
    if (!job) return next(createHttpError(404, "Job not found."));

    const me = actor(req.csdStaff);
    job.comments.push({
      body,
      authorId: me.id,
      authorStaffId: me.staffId,
      authorName: me.name,
      internal: true,
    });
    await job.save();

    await csdAudit({
      req,
      staff: req.csdStaff,
      action: "CSD_JOB_COMMENTED",
      resource: "CsdJob",
      entityType: "CsdJob",
      entityId: job._id,
      storeId: job.storeId,
      description: `${job.jobId} commented on`,
    });

    res.status(201).json({ success: true, data: shapeFull(job.toObject()) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/csd/jobs/meta/assignees — active staff, for the assignment picker. */
const listAssignees = async (req, res, next) => {
  try {
    const staff = await CsdStaff.find({ status: "active" }, { staffId: 1, fullName: 1, role: 1 })
      .sort({ staffId: 1 })
      .lean();
    res.status(200).json({
      success: true,
      data: staff.map((s) => ({
        id: String(s._id),
        staffId: s.staffId,
        fullName: s.fullName,
        role: s.role,
      })),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listJobs, getJob, createJob, updateJob, changeStatus, addComment, listAssignees,
};
