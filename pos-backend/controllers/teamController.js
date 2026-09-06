const createHttpError = require("http-errors");
const Team = require("../models/teamModel");
const User = require("../models/userModel");
const AuditLog = require("../models/auditLogModel");

// ===== Teams =====
const createTeam = async (req, res, next) => {
  try {
    const { name, description, permissions } = req.body;
    if (!name) {
      const error = createHttpError(400, "Team name is required!");
      return next(error);
    }
    // restaurantId/outletId are derived from the authenticated user — never from the body.
    const team = await Team.create({
      name,
      description,
      restaurantId: req.user.restaurantId,
      outletId: req.user.outletId,
      managerId: req.user._id,
      permissions: permissions || [],
    });
    res.status(201).json({ success: true, message: "Team created!", data: team });
  } catch (error) {
    next(error);
  }
};

const getTeams = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const teams = await Team.find({ restaurantId, isDeleted: false })
      .populate("members", "name email phone role")
      .populate("managerId", "name email role");
    res.status(200).json({ success: true, data: teams });
  } catch (error) {
    next(error);
  }
};

const updateTeam = async (req, res, next) => {
  try {
    const { teamId } = req.params;
    const team = await Team.findOneAndUpdate({ _id: teamId, restaurantId: req.user.restaurantId, isDeleted: false }, req.body, { new: true });
    if (!team) {
      const error = createHttpError(404, "Team not found!");
      return next(error);
    }
    res.status(200).json({ success: true, message: "Team updated!", data: team });
  } catch (error) {
    next(error);
  }
};

const deleteTeam = async (req, res, next) => {
  try {
    const { teamId } = req.params;
    const team = await Team.findOneAndUpdate({ _id: teamId, restaurantId: req.user.restaurantId }, { isDeleted: true }, { new: true });
    if (!team) {
      const error = createHttpError(404, "Team not found!");
      return next(error);
    }
    res.status(200).json({ success: true, message: "Team deleted!" });
  } catch (error) {
    next(error);
  }
};

const addMemberToTeam = async (req, res, next) => {
  try {
    const { teamId, userId } = req.params;
    // Verify the target user belongs to the same tenant before adding
    const targetUser = await User.findOne({ _id: userId, restaurantId: req.user.restaurantId, isDeleted: { $ne: true } });
    if (!targetUser) {
      const error = createHttpError(404, "User not found in your restaurant!");
      return next(error);
    }
    const team = await Team.findOneAndUpdate(
      { _id: teamId, restaurantId: req.user.restaurantId, isDeleted: false },
      { $addToSet: { members: userId } },
      { new: true }
    );
    if (!team) {
      const error = createHttpError(404, "Team not found!");
      return next(error);
    }
    await User.findByIdAndUpdate(userId, { teamId: team._id });
    res.status(200).json({ success: true, message: "Member added to team!", data: team });
  } catch (error) {
    next(error);
  }
};

const removeMemberFromTeam = async (req, res, next) => {
  try {
    const { teamId, userId } = req.params;
    const team = await Team.findOneAndUpdate(
      { _id: teamId, restaurantId: req.user.restaurantId, isDeleted: false },
      { $pull: { members: userId } },
      { new: true }
    );
    if (!team) {
      const error = createHttpError(404, "Team not found!");
      return next(error);
    }
    res.status(200).json({ success: true, message: "Member removed from team!", data: team });
  } catch (error) {
    next(error);
  }
};

// ===== Staff Management =====
const addStaff = async (req, res, next) => {
  try {
    const { name, email, phone, password, role, permissions } = req.body;

    // Both were referenced below but never declared, so adding a staff member
    // threw ReferenceError and answered 500. Taken from the authenticated user,
    // never from the body -- see the note on createTeam above.
    const { restaurantId, outletId } = req.user;

    if (!name || !phone || !password || !role) {
      const error = createHttpError(400, "Name, phone, password and role are required!");
      return next(error);
    }

    const existing = await User.findOne({ $or: [{ email }, { phone }] });
    if (existing) {
      const error = createHttpError(400, "User with this email or phone already exists!");
      return next(error);
    }

    const staff = await User.create({
      name,
      email,
      phone,
      password,
      role,
      restaurantId,
      outletId,
      managerId: req.user._id,
      permissions: permissions || [],
      emailVerified: !!email,
    });

    await AuditLog.create({
      userId: req.user._id,
      restaurantId,
      action: "STAFF.CREATE",
      resource: "User",
      resourceId: staff._id,
      description: `Staff member added: ${name} (${role})`,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(201).json({ success: true, message: "Staff member added!", data: staff.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

const getStaff = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    const staff = await User.find({ restaurantId, isDeleted: false })
      .select("-password -sessions -mfa -resetPasswordToken -resetPasswordTokenExpires")
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: staff });
  } catch (error) {
    next(error);
  }
};

const updateStaff = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { name, role, permissions, isActive, outletId } = req.body;
    const update = {};
    if (name) update.name = name;
    if (role) update.role = role;
    if (permissions) update.permissions = permissions;
    if (isActive !== undefined) update.isActive = isActive;
    if (outletId) update.outletId = req.user.outletId; // never trust body outletId

    const staff = await User.findOneAndUpdate(
      { _id: userId, restaurantId: req.user.restaurantId },
      update,
      { new: true }
    ).select("-password -sessions -mfa");

    if (!staff) {
      const error = createHttpError(404, "Staff member not found!");
      return next(error);
    }

    res.status(200).json({ success: true, message: "Staff member updated!", data: staff });
  } catch (error) {
    next(error);
  }
};

const deleteStaff = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const staff = await User.findOneAndUpdate(
      { _id: userId, restaurantId: req.user.restaurantId },
      { isDeleted: true, isActive: false },
      { new: true }
    );
    if (!staff) {
      const error = createHttpError(404, "Staff member not found!");
      return next(error);
    }
    res.status(200).json({ success: true, message: "Staff member deactivated!" });
  } catch (error) {
    next(error);
  }
};

// ===== Audit Logs =====
const getAuditLogs = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    const { page = 1, limit = 50, action } = req.query;
    const query = { restaurantId };
    if (action) query.action = action;

    const logs = await AuditLog.find(query)
      .populate("userId", "name email role")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await AuditLog.countDocuments(query);

    res.status(200).json({
      success: true,
      data: { logs, total, page: parseInt(page), totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

// ===== Role Permissions Definitions =====
const rolePermissions = {
  Owner: ["*"],
  Admin: ["*"],
  Manager: [
    "orders.read", "orders.write", "orders.split", "orders.refund",
    "menu.read", "menu.edit", "menu.publish",
    "inventory.read", "inventory.write",
    "staff.read", "staff.write",
    "reports.read", "analytics.read",
  ],
  Chef: [
    "orders.read", "kds.read", "kds.write",
    "menu.read", "inventory.read", "inventory.write",
  ],
  Waiter: [
    "orders.read", "orders.write",
    "tables.read", "tables.write",
    "menu.read", "customer.create",
  ],
  Cashier: [
    "orders.read", "payment.read", "payment.write",
    "reports.read",
  ],
  Staff: ["orders.read", "menu.read"],
};

const getRolePermissions = (req, res) => {
  res.status(200).json({ success: true, data: rolePermissions });
};

module.exports = {
  createTeam,
  getTeams,
  updateTeam,
  deleteTeam,
  addMemberToTeam,
  removeMemberFromTeam,
  addStaff,
  getStaff,
  updateStaff,
  deleteStaff,
  getAuditLogs,
  getRolePermissions,
};