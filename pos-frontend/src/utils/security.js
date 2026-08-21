import { verifyPin } from "../https";

export const isOwner = (user) => {
  if (!user || !user.role) return false;
  const r = String(user.role).toLowerCase();
  return r === "owner" || r === "superadmin";
};

export const isStaff = (user) => {
  if (!user || !user.role) return false;
  const r = String(user.role).toLowerCase();
  return r === "staff" || r === "cashier" || r === "waiter";
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

export const clearPinSession = () => {
  sessionStorage.removeItem("staffPinToken");
  sessionStorage.removeItem("staffPinTokenExpiry");
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
