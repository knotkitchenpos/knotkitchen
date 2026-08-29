const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const CsdStaff = require("../models/csdStaffModel");
const { normalizePhone } = require("../services/otpService");
const { isAdminPhone } = require("../middlewares/csdAuth");
const { csdAudit } = require("../services/csdAuditService");

const str = (v) => String(v ?? "").trim();
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Guard against locking the platform out of its own admin panel.
 *
 * Three rules, all enforced server-side:
 *   1. Nobody can disable or demote themselves — the classic way an operator
 *      accidentally removes their own access mid-session.
 *   2. The last remaining active admin cannot be demoted or disabled.
 *   3. A predefined CSD_ADMIN_PHONES number cannot be demoted or disabled at
 *      all. Those numbers are the documented recovery path: if every other
 *      admin is lost they can still self-provision on login, and that only
 *      works while their row is admin+active.
 */
const assertSafeChange = async (target, actor, { role, status } = {}) => {
  const demoting = role && role !== "admin" && target.role === "admin";
  const disabling = status === "disabled" && target.status !== "disabled";
  if (!demoting && !disabling) return;

  if (String(target._id) === String(actor._id)) {
    throw createHttpError(400, "You cannot disable or demote your own account.");
  }

  if (isAdminPhone(target.phone)) {
    throw createHttpError(
      400,
      "This is a predefined administrator number and must stay active — it is the recovery path if other admin accounts are lost."
    );
  }

  if (target.role === "admin") {
    const activeAdmins = await CsdStaff.countDocuments({ role: "admin", status: "active" });
    if (activeAdmins <= 1) {
      throw createHttpError(400, "This is the last active administrator. Promote someone else first.");
    }
  }
};

/** GET /api/csd/staff — admin only. */
const listStaff = async (req, res, next) => {
  try {
    const q = req.query || {};
    const filters = {};

    if (str(q.status)) filters.status = str(q.status);
    if (str(q.role)) filters.role = str(q.role);
    if (str(q.q)) {
      const rx = new RegExp(escapeRegex(str(q.q)), "i");
      filters.$or = [{ fullName: rx }, { staffId: rx }, { phone: rx }, { officialEmail: rx }];
    }

    const staff = await CsdStaff.find(filters).sort({ staffId: 1 }).lean();

    res.status(200).json({
      success: true,
      data: staff.map((s) => ({
        id: String(s._id),
        staffId: s.staffId,
        fullName: s.fullName,
        phone: s.phone,
        personalEmail: s.personalEmail,
        officialEmail: s.officialEmail,
        role: s.role,
        status: s.status,
        permissions: s.permissions || [],
        dateJoined: s.dateJoined,
        lastLoginAt: s.lastLoginAt,
        loginCount: (s.loginHistory || []).length,
        // Surfaced so the UI can explain why this row's controls are locked.
        isPredefinedAdmin: isAdminPhone(s.phone),
      })),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/csd/staff/:id — includes login history. */
const getStaff = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(400, "Invalid staff id."));

    const s = await CsdStaff.findById(id).lean();
    if (!s) return next(createHttpError(404, "Staff member not found."));

    res.status(200).json({
      success: true,
      data: {
        id: String(s._id),
        staffId: s.staffId,
        fullName: s.fullName,
        phone: s.phone,
        personalEmail: s.personalEmail,
        officialEmail: s.officialEmail,
        role: s.role,
        status: s.status,
        permissions: s.permissions || [],
        dateJoined: s.dateJoined,
        lastLoginAt: s.lastLoginAt,
        isPredefinedAdmin: isAdminPhone(s.phone),
        // Most recent first, capped — this is a convenience view, the
        // AuditLog holds the durable record.
        loginHistory: [...(s.loginHistory || [])].reverse().slice(0, 25),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/csd/staff — admin only.
 *
 * This is what makes anyone other than the two predefined numbers able to
 * sign in: csdAuthController refuses to send an OTP to a phone with no active
 * row here.
 */
const createStaff = async (req, res, next) => {
  try {
    const b = req.body || {};
    const fullName = str(b.fullName);
    const phone = normalizePhone(b.phone);
    const role = str(b.role) || "staff";
    const fieldErrors = {};

    if (fullName.length < 2) fieldErrors.fullName = "Enter the staff member's full name.";
    if (!/^\d{10}$/.test(phone)) fieldErrors.phone = "Phone must be a 10-digit number.";
    if (!["admin", "staff"].includes(role)) fieldErrors.role = "Role must be admin or staff.";
    if (str(b.personalEmail) && !EMAIL_RE.test(str(b.personalEmail)))
      fieldErrors.personalEmail = "Enter a valid email address.";
    if (str(b.officialEmail) && !EMAIL_RE.test(str(b.officialEmail)))
      fieldErrors.officialEmail = "Enter a valid email address.";

    if (Object.keys(fieldErrors).length) {
      return next(createHttpError(400, "Please correct the highlighted fields.", { fieldErrors }));
    }

    if (await CsdStaff.exists({ phone })) {
      return next(
        createHttpError(409, "A staff member with that phone number already exists.", {
          fieldErrors: { phone: "This number is already registered." },
        })
      );
    }

    let staff = null;
    for (let attempt = 0; attempt < 3 && !staff; attempt++) {
      try {
        staff = await CsdStaff.create({
          staffId: await CsdStaff.nextStaffId(),
          fullName,
          phone,
          personalEmail: str(b.personalEmail).toLowerCase(),
          officialEmail: str(b.officialEmail).toLowerCase(),
          // A predefined admin number is always admin regardless of what the
          // form said, so the row matches what login will grant anyway.
          role: isAdminPhone(phone) ? "admin" : role,
          status: "active",
          permissions: Array.isArray(b.permissions) ? b.permissions.map(str).filter(Boolean) : [],
          createdBy: req.csdStaff._id,
        });
      } catch (err) {
        if (err?.code !== 11000) throw err;
        // Either a staffId race (retry) or the phone (report properly).
        if (await CsdStaff.exists({ phone })) {
          return next(createHttpError(409, "A staff member with that phone number already exists."));
        }
      }
    }
    if (!staff) return next(createHttpError(500, "Could not allocate a Staff ID. Please try again."));

    await csdAudit({
      req,
      staff: req.csdStaff,
      action: "CSD_STAFF_CREATED",
      resource: "CsdStaff",
      entityType: "CsdStaff",
      entityId: staff._id,
      description: `Created ${staff.staffId} (${staff.fullName}) as ${staff.role}`,
      newValue: { staffId: staff.staffId, fullName, phone, role: staff.role },
      severity: staff.role === "admin" ? "WARNING" : "INFO",
    });

    res.status(201).json({ success: true, data: staff.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/csd/staff/:id — admin only. */
const updateStaff = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(400, "Invalid staff id."));

    const staff = await CsdStaff.findById(id);
    if (!staff) return next(createHttpError(404, "Staff member not found."));

    const b = req.body || {};
    const before = {
      fullName: staff.fullName,
      role: staff.role,
      status: staff.status,
      officialEmail: staff.officialEmail,
      permissions: [...(staff.permissions || [])],
    };

    const nextRole = b.role !== undefined ? str(b.role) : undefined;
    const nextStatus = b.status !== undefined ? str(b.status) : undefined;

    if (nextRole !== undefined && !["admin", "staff"].includes(nextRole)) {
      return next(createHttpError(400, "Role must be admin or staff."));
    }
    if (nextStatus !== undefined && !["active", "disabled"].includes(nextStatus)) {
      return next(createHttpError(400, "Status must be active or disabled."));
    }

    // Lockout guards run BEFORE anything is mutated.
    await assertSafeChange(staff, req.csdStaff, { role: nextRole, status: nextStatus });

    if (b.fullName !== undefined) {
      const fullName = str(b.fullName);
      if (fullName.length < 2) {
        return next(createHttpError(400, "Enter the staff member's full name.", {
          fieldErrors: { fullName: "Enter the staff member's full name." },
        }));
      }
      staff.fullName = fullName;
    }

    for (const key of ["personalEmail", "officialEmail"]) {
      if (b[key] !== undefined) {
        const val = str(b[key]).toLowerCase();
        if (val && !EMAIL_RE.test(val)) {
          return next(createHttpError(400, "Enter a valid email address.", {
            fieldErrors: { [key]: "Enter a valid email address." },
          }));
        }
        staff[key] = val;
      }
    }

    if (nextRole !== undefined) {
      staff.role = isAdminPhone(staff.phone) ? "admin" : nextRole;
    }
    if (nextStatus !== undefined) staff.status = nextStatus;
    if (b.permissions !== undefined && Array.isArray(b.permissions)) {
      staff.permissions = b.permissions.map(str).filter(Boolean);
    }

    // The login phone is the identity this account authenticates with and is
    // referenced by every audit entry — changing it would silently transfer
    // an account's history to a different person. Create a new record instead.
    if (b.phone !== undefined && normalizePhone(b.phone) !== staff.phone) {
      return next(
        createHttpError(400, "A staff member's login phone cannot be changed. Disable this record and create a new one.")
      );
    }

    await staff.save();

    const roleChanged = before.role !== staff.role;
    const statusChanged = before.status !== staff.status;

    await csdAudit({
      req,
      staff: req.csdStaff,
      action: statusChanged
        ? staff.status === "disabled" ? "CSD_STAFF_DISABLED" : "CSD_STAFF_REACTIVATED"
        : roleChanged ? "CSD_STAFF_ROLE_CHANGED" : "CSD_STAFF_UPDATED",
      resource: "CsdStaff",
      entityType: "CsdStaff",
      entityId: staff._id,
      description: `${staff.staffId} updated${roleChanged ? ` (${before.role} → ${staff.role})` : ""}${
        statusChanged ? ` (${before.status} → ${staff.status})` : ""
      }`,
      previousValue: before,
      newValue: {
        fullName: staff.fullName,
        role: staff.role,
        status: staff.status,
        officialEmail: staff.officialEmail,
        permissions: staff.permissions,
      },
      severity: roleChanged || statusChanged ? "WARNING" : "INFO",
    });

    res.status(200).json({ success: true, data: staff.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

module.exports = { listStaff, getStaff, createStaff, updateStaff };
