/**
 * Outbound customer messaging: payment links, e-bills and "your order is ready".
 *
 * All three used to carry their own inline copy of the Fast2SMS HTTP call --
 * same URL, same headers, same success test, three chances to drift -- while
 * services/fast2smsProvider.js sat next to them with a proper client
 * (timeout, retry, an error taxonomy) used only for OTP. They now share it.
 *
 * Three channels, tried in order
 * ------------------------------
 *   1. WhatsApp  -- an approved Meta template, sent through Fast2SMS' WhatsApp
 *                   Business API. Preferred where a template is registered:
 *                   it carries a clickable link and formatting that SMS cannot.
 *   2. DLT SMS   -- an approved DLT template on the "dlt" route.
 *   3. Plain SMS -- free text on route v3. Not DLT-compliant, so Indian
 *                   operators are entitled to drop it; kept only so a store
 *                   mid-registration is not left with nothing.
 *
 * Template variables
 * ------------------
 * Both template systems fill numbered placeholders, and BOTH fail silently
 * when the order is wrong: the provider answers 200 and the customer reads
 * their order number where the total should be. So each message below writes
 * its variable order down next to the template it belongs to. That order is
 * the one thing here that cannot be inferred from anything else in the code.
 *
 * WhatsApp numbers HEADER and BODY variables separately -- a template may have
 * a header {{1}} and a body {{1}} meaning different things -- but the API
 * takes one flat pipe-separated list. Header values go first. That is the
 * documented-nowhere part of the contract and must be confirmed against a real
 * delivered message before a store is switched on.
 */

const { sendDlt, sendText, sendWhatsAppTemplate, Fast2SmsError } = require("./fast2smsProvider");

const apiKey = () => process.env.FAST2SMS_API_KEY || process.env.SMS_API_KEY || "";
const senderId = () => process.env.FAST2SMS_SENDER_ID || "";

/** One WhatsApp Business number serves every template on the account. */
const whatsAppPhoneNumberId = () => process.env.FAST2SMS_WHATSAPP_PHONE_NUMBER_ID || "";

/**
 * The message catalogue.
 *
 * `variables` returns values in the template's placeholder order; mirror the
 * order you chose when you registered the template.
 */
const MESSAGES = {
  paymentLink: {
    templateId: () => process.env.FAST2SMS_PAYMENT_LINK_TEMPLATE_ID || "",
    // DLT placeholder order: restaurant, order no, amount, link
    variables: ({ restaurantName, orderNumber, amount, linkUrl }) => [
      restaurantName || "Knot Kitchen",
      orderNumber || "",
      amount || "",
      linkUrl || "",
    ],
    text: ({ restaurantName, orderNumber, amount, linkUrl }) =>
      `Payment link for ${restaurantName || "Knot Kitchen"} (Order #${orderNumber}): ${amount} INR. Pay securely here: ${linkUrl}`,
  },

  eBill: {
    /**
     * WhatsApp template `knotkitchen_ebill` (Utility, en).
     *
     *   HEADER  Order E-Bill from {{1}}     -> restaurant name
     *   BODY    Order No: {{1}}             -> order number
     *           Total: Rs {{2}}             -> total
     *           View Bill: {{3}}            -> public receipt link
     *
     * Flattened header-first, so: restaurant | order no | total | link.
     */
    whatsapp: {
      messageId: () => process.env.FAST2SMS_EBILL_WHATSAPP_MESSAGE_ID || "",
      variables: ({ restaurantName, orderNumber, total, receiptUrl }) => [
        restaurantName || "Knot Kitchen",
        orderNumber || "",
        total || "",
        receiptUrl || "",
      ],
    },

    templateId: () => process.env.FAST2SMS_EBILL_TEMPLATE_ID || "",
    // DLT placeholder order: restaurant, order no, total, receipt link.
    // Unverified against a registered SMS template -- WhatsApp is the live
    // channel for e-bills; this is the fallback and should be checked before
    // anyone relies on it.
    variables: ({ restaurantName, orderNumber, total, receiptUrl }) => [
      restaurantName || "Knot Kitchen",
      orderNumber || "",
      total || "",
      receiptUrl || "",
    ],
    text: ({ restaurantName, orderNumber, total, itemsCount, receiptUrl }) =>
      `E-Bill from ${restaurantName || "Knot Kitchen"} (Order #${orderNumber}): Total ${total} INR (${itemsCount} items). View receipt: ${receiptUrl || "N/A"}`,
  },

  orderReady: {
    templateId: () => process.env.FAST2SMS_ORDER_READY_TEMPLATE_ID || "",
    // DLT placeholder order: order no, restaurant
    variables: ({ orderNumber, restaurantName }) => [
      orderNumber || "",
      restaurantName || "KnotKitchen",
    ],
    text: ({ orderNumber, restaurantName, orderType }) => {
      const typeLabel =
        String(orderType || "").toLowerCase() === "delivery"
          ? "is on the way"
          : "is ready for collection";
      return `Good news! Your order #${orderNumber || ""} at ${restaurantName || "KnotKitchen"} ${typeLabel}. Thank you for ordering with us.`;
    },
  },
};

/** Which channel this message can actually go out on, given the environment. */
const channelFor = (spec) => {
  if (spec.whatsapp && spec.whatsapp.messageId() && whatsAppPhoneNumberId()) return "whatsapp";
  if (spec.templateId() && senderId()) return "dlt";
  return "v3";
};

/**
 * Send one catalogue message.
 *
 * Always reports what actually happened -- there is no "pretend it sent"
 * branch. A caller that stores `deliveryStatus` is storing the truth.
 */
const deliver = async (kind, payload) => {
  const spec = MESSAGES[kind];
  const phone = String(payload.phone || "").replace(/\D/g, "");

  if (!phone || phone.length < 10) {
    return {
      success: false,
      sent: false,
      deliveryStatus: "FAILED",
      error: `Invalid customer phone number for ${kind}.`,
    };
  }

  const key = apiKey();
  const body = spec.text(payload);

  if (!key) {
    // Dev / unconfigured. Log the intended wording so QA can check it without
    // spending credits, and say plainly that nothing was sent.
    console.log(`[Messaging] (no API key, ${kind}) To: ${phone} | ${body}`);
    return {
      success: false,
      sent: false,
      deliveryStatus: "FAILED",
      provider: "Console/Unconfigured",
      error: "SMS provider API key not configured.",
      devMessage: body,
    };
  }

  const route = channelFor(spec);

  try {
    let result;
    if (route === "whatsapp") {
      result = await sendWhatsAppTemplate({
        phone,
        messageId: spec.whatsapp.messageId(),
        phoneNumberId: whatsAppPhoneNumberId(),
        variables: spec.whatsapp.variables(payload),
        apiKey: key,
      });
    } else if (route === "dlt") {
      result = await sendDlt({
        phone,
        senderId: senderId(),
        templateId: spec.templateId(),
        variables: spec.variables(payload),
        apiKey: key,
      });
    } else {
      result = await sendText({ phone, message: body, senderId: senderId(), apiKey: key });
    }

    return {
      success: true,
      sent: true,
      deliveryStatus: "DELIVERED",
      provider: route === "whatsapp" ? "Fast2SMS WhatsApp" : "Fast2SMS",
      route,
      messageId: result.requestId || `msg_${Date.now()}`,
    };
  } catch (err) {
    // Fast2SMS' own message is the useful one for an operator ("Invalid
    // Message ID", "Insufficient balance"); it never contains the API key.
    const message =
      err instanceof Fast2SmsError ? err.message : err?.message || "SMS delivery failed.";
    console.warn(`[Messaging] ${kind} failed on ${route}:`, message);
    return {
      success: false,
      sent: false,
      deliveryStatus: "FAILED",
      provider: route === "whatsapp" ? "Fast2SMS WhatsApp" : "Fast2SMS",
      route,
      error: message,
    };
  }
};

const sendPaymentLinkMessage = (payload) => deliver("paymentLink", payload);
const sendEBillMessage = (payload) => deliver("eBill", payload);
const sendOrderReadyMessage = async (payload) => {
  const phone = String(payload.phone || "").replace(/\D/g, "");
  if (!phone || phone.length < 10) {
    // A walk-in collection order legitimately has no phone. That is not a
    // failure, and reporting it as one made the Orders list look broken.
    return {
      success: false,
      sent: false,
      deliveryStatus: "SKIPPED",
      error: "No customer phone number on file — notification skipped.",
    };
  }
  return deliver("orderReady", payload);
};

module.exports = {
  MESSAGES,
  channelFor,
  sendPaymentLinkMessage,
  sendEBillMessage,
  sendOrderReadyMessage,
};
