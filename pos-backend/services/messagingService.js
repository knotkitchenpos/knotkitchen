/**
 * Outbound SMS: payment links, e-bills and "your order is ready".
 *
 * All three used to carry their own inline copy of the Fast2SMS HTTP call --
 * same URL, same headers, same success test, three chances to drift -- while
 * services/fast2smsProvider.js sat next to them with a proper client
 * (timeout, retry, an error taxonomy) used only for OTP. They now share it.
 *
 * DLT
 * ---
 * Transactional SMS to Indian numbers has to go out against a template
 * registered on the DLT platform: you send the approved TEMPLATE ID and the
 * values that fill its `{#var#}` placeholders, in the template's own order.
 * The old code sent free text on route "v3", which is not compliant and which
 * operators are entitled to drop -- so those messages may simply never have
 * arrived, with the provider still answering 200.
 *
 * Each message below therefore declares its template id (from the
 * environment) and, next to it, the ORDER of the variables that template
 * expects. That order is the one thing here that cannot be inferred: get it
 * wrong and the customer is told their bill is "1042" and their order number
 * is "Rs 450". It is written next to the template id on purpose.
 *
 * With no template id configured a message falls back to free text, so a
 * store mid-DLT-registration keeps working exactly as it did.
 */

const { sendDlt, sendText, Fast2SmsError } = require("./fast2smsProvider");

const apiKey = () => process.env.FAST2SMS_API_KEY || process.env.SMS_API_KEY || "";
const senderId = () => process.env.FAST2SMS_SENDER_ID || "";

/**
 * The message catalogue.
 *
 * `variables` returns the values in the template's placeholder order. When
 * you register a template with DLT you choose that order; mirror it here.
 */
const MESSAGES = {
  paymentLink: {
    templateId: () => process.env.FAST2SMS_PAYMENT_LINK_TEMPLATE_ID || "",
    // Placeholder order: {#var#} restaurant, {#var#} order no, {#var#} amount, {#var#} link
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
    templateId: () => process.env.FAST2SMS_EBILL_TEMPLATE_ID || "",
    // Placeholder order: {#var#} restaurant, {#var#} order no, {#var#} total, {#var#} receipt link
    //
    // PROVISIONAL -- this must be re-ordered to match the DLT template that is
    // actually registered before e-bills are switched to the DLT route. A
    // mismatched order does not error anywhere: the customer just receives a
    // bill with the numbers in the wrong holes.
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
    // Placeholder order: {#var#} order no, {#var#} restaurant
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

  const templateId = spec.templateId();
  const sender = senderId();

  try {
    const result =
      templateId && sender
        ? await sendDlt({
            phone,
            senderId: sender,
            templateId,
            variables: spec.variables(payload),
            apiKey: key,
          })
        : await sendText({ phone, message: body, senderId: sender, apiKey: key });

    return {
      success: true,
      sent: true,
      deliveryStatus: "DELIVERED",
      provider: "Fast2SMS",
      route: templateId && sender ? "dlt" : "v3",
      messageId: result.requestId || `msg_${Date.now()}`,
    };
  } catch (err) {
    // Fast2SMS' own message is the useful one for an operator ("Invalid
    // Message ID", "Insufficient balance"); it never contains the API key.
    const message =
      err instanceof Fast2SmsError ? err.message : err?.message || "SMS delivery failed.";
    console.warn(`[Messaging] ${kind} failed:`, message);
    return {
      success: false,
      sent: false,
      deliveryStatus: "FAILED",
      provider: "Fast2SMS",
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
  sendPaymentLinkMessage,
  sendEBillMessage,
  sendOrderReadyMessage,
};
