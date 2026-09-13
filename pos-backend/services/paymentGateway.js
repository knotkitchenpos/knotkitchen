/**
 * Where a store's payment-gateway credentials actually live.
 *
 * This module is the single answer. Read it; do not re-derive the rule --
 * four places used to, and they disagreed with each other. One of them read
 * `restaurant.razorpay.isConfigured` from a model that has no such field, so
 * online payment was permanently off for every store that would ever exist.
 *
 * Resolution order, per tenant:
 *   1. the store's own credentials in WebsiteSettings, if isConfigured and
 *      the secret actually decrypts;
 *   2. the platform-wide env credentials.
 *
 * Secrets never leave here except on the server-side `secret` field. Callers
 * that hand something to a browser must use a `payment_session_id` minted by
 * the provider -- never `secret`.
 */

const config = require("../config/config");

const PROVIDERS = Object.freeze({ CASHFREE: "cashfree", PHONEPE: "phonepe" });

// Stored credentials are encrypted at rest when CREDENTIALS_SECRET is set,
// and plain Base64 when it is not. secretBox reads both, so this keeps
// working across the changeover with no migration.
const { open: decodeSecret } = require("./secretBox");

/** The platform's own credentials, for stores that have not brought theirs. */
const platformGateway = () => {
  if (config.cashfreeAppId && config.cashfreeSecretKey) {
    return {
      enabled: true,
      provider: PROVIDERS.CASHFREE,
      gateway: PROVIDERS.CASHFREE,
      keyId: config.cashfreeAppId,
      secret: config.cashfreeSecretKey,
      environment: String(config.cashfreeEnv || "TEST").toUpperCase(),
      webhookSecret: config.cashfreeWebhookSecret || config.cashfreeSecretKey || "",
      source: "platform",
    };
  }
  return {
    enabled: false,
    provider: PROVIDERS.CASHFREE,
    gateway: PROVIDERS.CASHFREE,
    keyId: "",
    secret: "",
    environment: "TEST",
    webhookSecret: "",
    source: "platform",
  };
};

/**
 * Pull a usable credential pair out of a stored gateway block, or null if it
 * is marked configured but unusable (blank id, secret that will not decode).
 * "Configured" in the database is a claim; this is the check.
 */
const fromStoredGateway = (name, gw) => {
  if (!gw || !gw.isConfigured) return null;
  const environment = String(gw.environment || "TEST").toUpperCase();

  if (name === PROVIDERS.CASHFREE && gw.clientId) {
    const secret = decodeSecret(gw.clientSecretEncrypted);
    if (secret) {
      return {
        enabled: true,
        provider: PROVIDERS.CASHFREE,
        gateway: PROVIDERS.CASHFREE,
        keyId: gw.clientId,
        secret,
        // Cashfree signs its webhooks with the same client secret.
        webhookSecret: secret,
        environment,
        source: "store",
      };
    }
  }
  if (name === PROVIDERS.PHONEPE && gw.merchantId) {
    const secret = decodeSecret(gw.saltKeyEncrypted);
    if (secret) {
      return {
        enabled: true,
        provider: PROVIDERS.PHONEPE,
        gateway: PROVIDERS.PHONEPE,
        keyId: gw.merchantId,
        secret,
        webhookSecret: secret,
        environment,
        saltIndex: gw.saltIndex || "1",
        source: "store",
      };
    }
  }
  return null;
};

/**
 * Resolve the effective gateway for a tenant.
 *
 * @returns {{enabled, provider, gateway, keyId, secret, webhookSecret, environment, source}}
 *   `source` is "store" when the tenant brought its own credentials and
 *   "platform" when it is riding on the shared env keys — useful in logs when
 *   a payment fails and you need to know whose keys were used.
 */
const resolveGateway = async ({ restaurantId, storeId } = {}) => {
  // A diner's payment is the RESTAURANT'S money and must only ever settle to
  // the restaurant's own gateway account. This used to fall back to the
  // platform (KnotKitchen) keys whenever a store had none, which would have
  // collected every such restaurant's takings into KnotKitchen's bank account.
  // No store gateway now means no online payment, never someone else's
  // account. Money KnotKitchen itself bills uses resolvePlatformGateway.
  const none = { ...platformGateway(), enabled: false, keyId: "", secret: "", webhookSecret: "", source: "none" };
  if (!restaurantId && !storeId) return none;

  try {
    const mongoose = require("mongoose");
    if (mongoose.connection?.readyState !== 1) return none;

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

    const gateways = settings?.paymentGateways;
    if (!gateways) return none;

    const active = String(gateways.activeGateway || PROVIDERS.CASHFREE).toLowerCase();

    // The store's chosen provider first.
    const chosen = fromStoredGateway(active, gateways[active]);
    if (chosen) return chosen;

    // Then any other provider it has configured — an operator who set up
    // Cashfree and forgot to mark it active should still be able to trade.
    for (const name of Object.values(PROVIDERS)) {
      if (name === active) continue;
      const other = fromStoredGateway(name, gateways[name]);
      if (other) return other;
    }

    // Marked configured but unusable, or nothing configured.
    return none;
  } catch {
    return none;
  }
};

/** Public half only — safe to hand to a customer's browser. */
const isOnlinePaymentEnabled = async (scope) => {
  const gw = await resolveGateway(scope);
  return gw.enabled;
};

module.exports = {
  PROVIDERS,
  resolveGateway,
  /**
   * KnotKitchen's OWN credentials, never a store's.
   *
   * resolveGateway deliberately prefers a store's own gateway so a diner's
   * money reaches the restaurant directly. That is exactly wrong for money
   * the PLATFORM collects: a Business Balance recharge run through the
   * restaurant's own Cashfree account would pay the restaurant its own money
   * and still credit its balance here -- free balance, funded by nobody.
   *
   * Anything KnotKitchen bills for resolves through this instead.
   */
  resolvePlatformGateway: platformGateway,
  isOnlinePaymentEnabled,
  DEFAULT_GATEWAY: PROVIDERS.CASHFREE,
};
