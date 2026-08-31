const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const CsdStaff = require("../models/csdStaffModel");
const { csdAudit } = require("../services/csdAuditService");

const str = (v) => String(v ?? "").trim();
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^\d{10}$/;
const normalizePhone = (v) => str(v).replace(/\D/g, "").slice(-10);

/**
 * Guard against locking the platform out of its own admin panel.
 *
 * Three rules, all enforced server-side:
 *   1. Nobody can disable or demote themselves — the classic way an operator
 *      accidentally removes their own access mid-session.
 *   2. The last remaining active admin cannot be demoted or disabled.
 *   3. The seeded (`isPredefined`) super-admin — bootstrapped from
 *      SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD — cannot be demoted or disabled
 *      at all. It is the recovery path if every other admin account is lost:
 *      RESET_SUPERADMIN_PASSWORD=true regenerates its password on next boot,
 *      but only while the row itself is still admin+active.
 */
const assertSafeChange = async (target, actor, { role, status } = {}) => {
  const demoting = role && role !== "admin" && target.role === "admin";
  const disabling = status === "disabled" && target.status !== "disabled";
  if (!demoting && !disabling) return;

  if (String(target._id) === String(actor._id)) {
    throw createHttpError(400, "You cannot disable or demote your own account.");
  }

  if (target.isPredefined) {
    throw createHttpError(
      400,
      "This is the seeded super-administrator account and must stay active — it is the recovery path if other admin accounts are lost."
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
      filters.$or = [{ fullName: rx }, { staffId: rx }, { email: rx }, { officialEmail: rx }];
    }

    const staff = await CsdStaff.find(filters).sort({ staffId: 1 }).lean();

    res.status(200).json({
      success: true,
      data: staff.map((s) => ({
        id: String(s._id),
        staffId: s.staffId,
        fullName: s.fullName,
        email: s.email,
        phone: s.phone || "",
        personalEmail: s.personalEmail,
        officialEmail: s.officialEmail,
        role: s.role,
        status: s.status,
        permissions: s.permissions || [],
        dateJoined: s.dateJoined,
        lastLoginAt: s.lastLoginAt,
        loginCount: (s.loginHistory || []).length,
        // Surfaced so the UI can explain why this row's controls are locked.
        isPredefinedAdmin: s.isPredefined === true,
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
        email: s.email,
        phone: s.phone || "",
        personalEmail: s.personalEmail,
        officialEmail: s.officialEmail,
        role: s.role,
        status: s.status,
        permissions: s.permissions || [],
        dateJoined: s.dateJoined,
        lastLoginAt: s.lastLoginAt,
        isPredefinedAdmin: s.isPredefined === true,
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
 * This is what makes anyone other than the seeded super-admin able to sign
 * in: csdAuthController.login refuses any email that has no active row here.
 */
const createStaff = async (req, res, next) => {
  try {
    const b = req.body || {};
    const fullName = str(b.fullName);
    const email = str(b.email).toLowerCase();
    const password = typeof b.password === "string" ? b.password : "";
    const phone = b.phone ? normalizePhone(b.phone) : "";
    const role = str(b.role) || "staff";
    const fieldErrors = {};

    if (fullName.length < 2) fieldErrors.fullName = "Enter the staff member's full name.";
    if (!EMAIL_RE.test(email)) fieldErrors.email = "Enter a valid email address.";
    if (password.length < 8) fieldErrors.password = "Password must be at least 8 characters.";
    if (phone && !PHONE_RE.test(phone)) fieldErrors.phone = "Phone must be a 10-digit number.";
    if (!["admin", "staff"].includes(role)) fieldErrors.role = "Role must be admin or staff.";
    if (str(b.personalEmail) && !EMAIL_RE.test(str(b.personalEmail)))
      fieldErrors.personalEmail = "Enter a valid email address.";
    if (str(b.officialEmail) && !EMAIL_RE.test(str(b.officialEmail)))
      fieldErrors.officialEmail = "Enter a valid email address.";

    if (Object.keys(fieldErrors).length) {
      return next(createHttpError(400, "Please correct the highlighted fields.", { fieldErrors }));
    }

    if (await CsdStaff.exists({ email })) {
      return next(
        createHttpError(409, "A staff member with that email already exists.", {
          fieldErrors: { email: "This email is already registered." },
        })
      );
    }
    if (phone && (await CsdStaff.exists({ phone }))) {
      return next(
        createHttpError(409, "A staff member with that phone number already exists.", {
          fieldErrors: { phone: "This number is already registered." },
        })
      );
    }

    let staff = null;
    for (let attempt = 0; attempt < 3 && !staff; attempt++) {
      try {
        const doc = new CsdStaff({
          staffId: await CsdStaff.nextStaffId(),
          fullName,
          email,
          password,
          phone: phone || null,
          personalEmail: str(b.personalEmail).toLowerCase(),
          officialEmail: str(b.officialEmail).toLowerCase(),
          role,
          status: "active",
          isPredefined: false,
          permissions: Array.isArray(b.permissions) ? b.permissions.map(str).filter(Boolean) : [],
          createdBy: req.csdStaff._id,
        });
        // .save() triggers the pre-save bcrypt hook. Retry loop is for the
        // (rare) staffId race; other duplicates are reported below.
        await doc.save();
        staff = doc;
      } catch (err) {
        if (err?.code !== 11000) throw err;
        if (await CsdStaff.exists({ email })) {
          return next(createHttpError(409, "A staff member with that email already exists."));
        }
        if (phone && (await CsdStaff.exists({ phone }))) {
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
      newValue: { staffId: staff.staffId, fullName, email, role: staff.role },
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

    if (nextRole !== undefined) staff.role = nextRole;
    if (nextStatus !== undefined) staff.status = nextStatus;
    if (b.permissions !== undefined && Array.isArray(b.permissions)) {
      staff.permissions = b.permissions.map(str).filter(Boolean);
    }

    // Login email is the identity this account authenticates with and is
    // referenced by every audit entry — changing it would silently transfer
    // an account's history to a different person. Create a new record instead.
    if (b.email !== undefined && str(b.email).toLowerCase() !== staff.email) {
      return next(
        createHttpError(400, "A staff member's login email cannot be changed. Disable this record and create a new one.")
      );
    }

    // Optional password reset. 8+ chars enforced consistently with create.
    if (typeof b.password === "string" && b.password.length > 0) {
      if (b.password.length < 8) {
        return next(createHttpError(400, "Password must be at least 8 characters.", {
          fieldErrors: { password: "Password must be at least 8 characters." },
        }));
      }
      staff.password = b.password; // pre-save hook hashes it
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
