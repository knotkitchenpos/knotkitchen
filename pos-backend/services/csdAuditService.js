const { logActivity } = require("./auditService");

/**
 * Append a CSD/Admin-panel action to the shared AuditLog.
 *
 * logActivity() is shaped around a POS `User` (tenant-scoped, has restaurantId
 * and storeId). CSD staff are cross-tenant KnotKitchen employees, so this
 * adapts them onto that contract in one place rather than every caller
 * hand-rolling a pseudo-user:
 *
 *   - role is prefixed "csd:" so CSD entries are trivially separable from POS
 *     ones when reading the log back.
 *   - storeId is passed per-action (the store being acted on), not the actor's
 *     — a CSD employee doesn't belong to a store.
 *
 * Never throws: an audit failure must not break the operation it records, and
 * logActivity already swallows and logs its own errors.
 */
const csdAudit = ({
  req,
  staff,
  action,
  resource,
  entityType,
  entityId,
  storeId = "",
  description,
  previousValue,
  newValue,
  severity = "INFO",
}) =>
  logActivity({
    req,
    user: {
      _id: staff?._id,
      storeId,
      phone: staff?.phone || "",
      role: `csd:${staff?.role || "unknown"}`,
      name: staff ? `${staff.staffId} ${staff.fullName}` : "unknown",
    },
    action,
    resource,
    entityType,
    entityId,
    description,
    previousValue,
    newValue,
    severity,
  }).catch(() => null);

module.exports = { csdAudit };
