const AuditLog = require("../models/auditLogModel");

/**
 * Creates an immutable, append-only activity log record (§Activity Log Module).
 * Sanitizes sensitive credentials (passwords, PINs, secret keys) automatically so they are never logged.
 */
const logActivity = async ({
  req,
  user,
  action,
  resource,
  entityType,
  entityId,
  previousValue,
  newValue,
  description,
  severity = "INFO",
}) => {
  try {
    const activeUser = user || req?.user;
    if (!activeUser) return null;

    const now = new Date();
    const dateFormatted = now.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const timeFormatted = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const sanitizeValue = (val) => {
      if (val === null || val === undefined) return "";
      if (typeof val === "object") {
        const copy = JSON.parse(JSON.stringify(val));
        const maskSecrets = (obj) => {
          if (!obj || typeof obj !== "object") return;
          for (const key of Object.keys(obj)) {
            if (/password|pin|secret|saltkey|keysecret|clientsecret/i.test(key)) {
              obj[key] = "••••••••";
            } else if (typeof obj[key] === "object") {
              maskSecrets(obj[key]);
            }
          }
        };
        maskSecrets(copy);
        return copy;
      }
      return String(val);
    };

    const cleanPrev = sanitizeValue(previousValue);
    const cleanNew = sanitizeValue(newValue);

    const mongoose = require("mongoose");
    const validRestId = mongoose.Types.ObjectId.isValid(activeUser.restaurantId) ? activeUser.restaurantId : null;
    const validUserId = mongoose.Types.ObjectId.isValid(activeUser._id) ? activeUser._id : null;

    const doc = await AuditLog.create({
      storeId: activeUser.storeId || "",
      restaurantId: validRestId,
      userId: validUserId,
      phone: activeUser.phone || "",
      role: activeUser.role || "Staff",
      action: action || "SETTINGS_UPDATE",
      resource: resource || entityType || "General",
      entityType: entityType || resource || "General",
      entityId: entityId || null,
      resourceId: entityId || null,
      description: description || `${action} by ${activeUser.name || activeUser.phone || "User"}`,
      previousValue: cleanPrev,
      newValue: cleanNew,
      dateFormatted,
      timeFormatted,
      timestamp: now,
      ipAddress: req?.ip || "",
      userAgent: req?.get ? req.get("user-agent") : "",
      severity,
    });

    return doc;
  } catch (err) {
    console.error("[AuditLog Error]", err.message);
    return null;
  }
};

module.exports = { logActivity };
