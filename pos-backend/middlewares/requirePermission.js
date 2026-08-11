const createHttpError = require("http-errors");

/**
 * RBAC guard — checks the authenticated user (attached by isVerifiedUser)
 * against the required permission.
 *
 * Effective permissions = User.permissions (owner/individual) plus any
 * permissions granted via the Team membership of the user's role.
 *
 * Usage: router.get("/", isVerifiedUser, requirePermission("TABLE_VIEW"), handler)
 */
const requirePermission = (permission) => async (req, res, next) => {
  try {
    if (!req.user) return next(createHttpError(401, "Authentication required."));

    // Super role bypass (roles are stored as "Owner", e.g. from userController)
    if (req.user.role === "owner" || req.user.role === "Owner" || req.user.role === "superadmin") return next();

    const own = req.user.permissions || [];
    if (own.includes("*") || own.includes(permission)) return next();

    // Team-scoped permissions: load the user's active team membership
    const Team = require("../models/teamModel");
    const team = await Team.findOne({
      restaurantId: req.user.restaurantId,
      outletId: req.user.outletId,
      userId: req.user._id,
      isActive: true,
    });
    if (team?.permissions?.includes("*") || team?.permissions?.includes(permission)) {
      return next();
    }

    return next(createHttpError(403, `Forbidden: requires '${permission}' permission.`));
  } catch (error) {
    next(error);
  }
};

module.exports = { requirePermission };