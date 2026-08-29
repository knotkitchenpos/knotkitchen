const mongoose = require("mongoose");

/**
 * CSD internal job / task.
 *
 * The spec is explicit: "Never permanently delete closed jobs from the
 * system." There is therefore NO delete route and no isDeleted flag — a job's
 * only terminal state is `closed`, and closed jobs stay queryable forever as
 * the record of who did what work, for which restaurant, and when.
 *
 * Comments and status transitions are append-only for the same reason: the
 * job document IS the audit trail the spec asks for, alongside the platform
 * AuditLog entries written by csdJobController.
 */

const commentSchema = new mongoose.Schema(
  {
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff", required: true },
    authorStaffId: { type: String, default: "" },
    authorName: { type: String, default: "" },
    // Marks a note as internal-only. Every job is internal today, but the
    // field exists so a future customer-visible thread doesn't require
    // rewriting historical comments.
    internal: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const attachmentSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    url: { type: String, required: true },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    uploadedById: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

/** Append-only record of every status transition. */
const transitionSchema = new mongoose.Schema(
  {
    from: { type: String, default: "" },
    to: { type: String, required: true },
    byId: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff" },
    byStaffId: { type: String, default: "" },
    byName: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const JOB_STATUSES = ["open", "in_progress", "closed"];
const JOB_PRIORITIES = ["low", "normal", "high", "urgent"];

const csdJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^KK-JOB-\d{4,}$/, "Job ID must look like KK-JOB-0001"],
    },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: "", trim: true, maxlength: 8000 },

    // Optional link to the restaurant the work concerns. Denormalised
    // alongside the name so a closed job still reads correctly years later
    // even if the store is renamed or removed.
    storeId: { type: String, default: "", index: true },
    restaurantName: { type: String, default: "" },

    status: { type: String, enum: JOB_STATUSES, default: "open", index: true },
    priority: { type: String, enum: JOB_PRIORITIES, default: "normal", index: true },
    deadline: { type: Date, default: null },

    createdById: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff", required: true },
    createdByStaffId: { type: String, default: "" },
    createdByName: { type: String, default: "" },

    // Nullable: a job can sit unassigned in the queue.
    assignedToId: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff", default: null, index: true },
    assignedToStaffId: { type: String, default: "" },
    assignedToName: { type: String, default: "" },

    closedAt: { type: Date, default: null },
    closedById: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff", default: null },
    closedByName: { type: String, default: "" },

    comments: { type: [commentSchema], default: [] },
    attachments: { type: [attachmentSchema], default: [] },
    transitions: { type: [transitionSchema], default: [] },
  },
  { timestamps: true }
);

csdJobSchema.index({ status: 1, createdAt: -1 });
csdJobSchema.index({ assignedToId: 1, status: 1 });
csdJobSchema.index({ title: "text", description: "text" });

/**
 * Next sequential job id (KK-JOB-0001, ...).
 * Zero-padded to 4 so lexical sort matches numeric order to 9999; the unique
 * index is the real guard against a concurrent-create collision.
 */
csdJobSchema.statics.nextJobId = async function () {
  const last = await this.findOne({}, { jobId: 1 }).sort({ jobId: -1 }).lean();
  const n = last ? parseInt(String(last.jobId).replace(/\D/g, ""), 10) + 1 : 1;
  return `KK-JOB-${String(n).padStart(4, "0")}`;
};

module.exports = mongoose.model("CsdJob", csdJobSchema);
module.exports.JOB_STATUSES = JOB_STATUSES;
module.exports.JOB_PRIORITIES = JOB_PRIORITIES;
