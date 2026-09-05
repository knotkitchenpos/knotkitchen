/**
 * Where a store's payment-gateway credentials actually live.
 *
 * There were two different answers to "can this store take money online?",
 * and they disagreed:
 *
 *   - paymentLinkController read WebsiteSettings.paymentGateways.<gw>, and
 *     fell back to the platform-wide RAZORPAY_* env keys when the store had
 *     not brought its own. That one works.
 *
 *   - the QR table page read `restaurant.razorpay.isConfigured`. The
 *     Restaurant model has no `razorpay` field at all, so that expression was
 *     `undefined && …` — permanently false for every store that will ever
 *     exist. "Pay online" could therefore never appear on a diner's phone,
 *     and the store looked un-configured even with working keys in the
 *     environment.
 *
 * This module is the single answer. Read it; do not re-derive the rule.
 *
 * Secrets never leave here: callers get `enabled`, the gateway name and the
 * PUBLIC key id (which the browser checkout legitimately needs). The secret is
 * returned only on the server-side resolve used for signing and verification.
 */

const config = require("../config/config");

const DEFAULT_GATEWAY = "razorpay";

const decodeSecret = (encoded) => {
  if (!encoded) return "";
  try {
    return Buffer.from(encoded, "base64").toString("utf-8");
  } catch {
    return "";
  }
};

/**
 * Resolve the effective gateway for a tenant.
 *
 * @returns {{enabled: boolean, gateway: string, keyId: string, secret: string, source: string}}
 *   `source` is "store" when the tenant brought its own credentials and
 *   "platform" when it is riding on the shared env keys — useful in logs when
 *   a payment fails and you need to know whose keys were used.
 */
const resolveGateway = async ({ restaurantId, storeId } = {}) => {
  const platform = {
    enabled: Boolean(config.razorpayKeyId && config.razorpaySecretKey),
    gateway: DEFAULT_GATEWAY,
    keyId: config.razorpayKeyId || "",
    secret: config.razorpaySecretKey || "",
    source: "platform",
  };

  if (!restaurantId && !storeId) return platform;

  try {
    const mongoose = require("mongoose");
    if (mongoose.connection?.readyState !== 1) return platform;

    const WebsiteSettings = require("../models/websiteSettingsModel");
    const or = [];
    if (restaurantId) or.push({ restaurantId });
    if (storeId) or.push({ storeId });

    const settings = await WebsiteSettings.findOne({
      $or: or,
      isDeleted: { $ne: true },
    })
      .select("paymentGateways")
      .lean();

    const active = String(settings?.paymentGateways?.activeGateway || DEFAULT_GATEWAY).toLowerCase();
    const gw = settings?.paymentGateways?.[active];
    if (!gw || !gw.isConfigured) return platform;

    if (active === "razorpay" && gw.keyId) {
      const secret = decodeSecret(gw.keySecretEncrypted);
      if (secret) {
        return { enabled: true, gateway: active, keyId: gw.keyId, secret, source: "store" };
      }
    }
    if (active === "cashfree" && gw.clientId) {
      const secret = decodeSecret(gw.clientSecretEncrypted);
      if (secret) {
        return { enabled: true, gateway: active, keyId: gw.clientId, secret, source: "store" };
      }
    }
    if (active === "phonepe" && gw.merchantId) {
      const secret = decodeSecret(gw.saltKeyEncrypted);
      if (secret) {
        return { enabled: true, gateway: active, keyId: gw.merchantId, secret, source: "store" };
      }
    }

    // Marked configured but the credentials are unusable. Falling back to the
    // platform keys is better than telling the diner to pay through nothing.
    return platform;
  } catch {
    return platform;
  }
};

/** Public half only — safe to hand to a customer's browser. */
const isOnlinePaymentEnabled = async (scope) => {
  const gw = await resolveGateway(scope);
  return gw.enabled;
};

module.exports = { resolveGateway, isOnlinePaymentEnabled, DEFAULT_GATEWAY };
