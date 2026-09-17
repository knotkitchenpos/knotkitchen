import { verifyPin } from "../https";

export const isOwner = (user) => {
  if (!user || !user.role) return false;
  const r = String(user.role).toLowerCase();
  return r === "owner" || r === "superadmin";
};

/** Owner, Admin or Manager: the people who may move money (refunds). */
export const isManager = (user) => {
  if (isOwner(user)) return true;
  const r = String(user?.role || "").toLowerCase();
  return r === "admin" || r === "manager";
};

export const hasActivePinSession = () => {
  const token = sessionStorage.getItem("staffPinToken");
  const expiry = sessionStorage.getItem("staffPinTokenExpiry");
  return Boolean(token && expiry && Number(expiry) > Date.now());
};

export const setPinSession = (pinToken, expiresAt) => {
  if (pinToken) {
    sessionStorage.setItem("staffPinToken", pinToken);
    sessionStorage.setItem(
      "staffPinTokenExpiry",
      String(expiresAt || Date.now() + 15 * 60 * 1000)
    );
  }
};

/**
 * Centralized Action Authorization Resolver.
 *
 * Owner → ALLOW
 * Staff + Owner Only Action → DENIED_OWNER_ONLY
 * Staff + Protected Action + Active PIN Session → ALLOW
 * Staff + Protected Action + No PIN Session → REQUIRE_PIN
 */
export const checkActionAuthorization = (user, { isOwnerOnly = false }) => {
  if (isOwner(user)) return { allowed: true, status: "ALLOW" };
  if (isOwnerOnly) {
    return {
      allowed: false,
      status: "DENIED_OWNER_ONLY",
      message: "Action Restricted: Only the Store Owner can perform this action.",
    };
  }
  if (hasActivePinSession()) return { allowed: true, status: "ALLOW" };

  return {
    allowed: false,
    status: "REQUIRE_PIN",
    message: "Security PIN verification required.",
  };
};

export const verifyStaffPin = async (pinInput) => {
  const res = await verifyPin(pinInput);
  if (res.data?.success && res.data?.pinToken) {
    setPinSession(res.data.pinToken, res.data.expiresAt);
  }
  return res.data;
};
