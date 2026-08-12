const config = require("../config/config");

/**
 * Messaging service abstraction for SMS / WhatsApp payment link delivery.
 * Accurately reports sending success/failure without faking delivery.
 */
const sendPaymentLinkMessage = async ({ phone, linkUrl, orderNumber, restaurantName, amount }) => {
  const normalizedPhone = String(phone || "").replace(/\D/g, "");
  
  if (!normalizedPhone || normalizedPhone.length < 10) {
    return {
      success: false,
      error: "Invalid customer phone number for messaging.",
    };
  }

  const messageText = `Payment link for ${restaurantName || "Knot Kitchen"} (Order #${orderNumber}): ${amount} INR. Pay securely here: ${linkUrl}`;

  const apiKey =
    process.env.FAST2SMS_API_KEY ||
    process.env.SMS_API_KEY;

  if (apiKey) {
    try {
      const response = await fetch("https://www.fast2sms.com/dev/bulkV2", {
        method: "POST",
        headers: {
          authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          route: "v3",
          sender_id: "TXTIND",
          message: messageText,
          language: "english",
          numbers: normalizedPhone,
        }),
      });

      const data = await response.json();
      if (data && (data.return === true || data.status_code === 200)) {
        return {
          success: true,
          provider: "Fast2SMS",
          messageId: data.request_id || `msg_${Date.now()}`,
        };
      } else {
        return {
          success: false,
          provider: "Fast2SMS",
          error: data.message || "SMS delivery failed from provider.",
        };
      }
    } catch (err) {
      return {
        success: false,
        provider: "Fast2SMS",
        error: err.message,
      };
    }
  }

  // Development fallback or unconfigured provider:
  // Explicitly return that SMS provider is not configured so the system accurately reports status.
  console.log(`[Messaging Provider] (Dev/No API Key) To: ${normalizedPhone} | Content: ${messageText}`);
  return {
    success: false,
    provider: "Console/Unconfigured",
    error: "SMS provider API key not configured.",
    devMessage: messageText,
  };
};

const sendEBillMessage = async ({ phone, orderNumber, restaurantName, total, itemsCount, receiptUrl }) => {
  const normalizedPhone = String(phone || "").replace(/\D/g, "");

  if (!normalizedPhone || normalizedPhone.length < 10) {
    return {
      success: false,
      sent: false,
      deliveryStatus: "FAILED",
      error: "Invalid customer phone number for e-bill.",
    };
  }

  const messageText = `E-Bill from ${restaurantName || "Knot Kitchen"} (Order #${orderNumber}): Total ${total} INR (${itemsCount} items). View receipt: ${receiptUrl || "N/A"}`;

  const apiKey =
    process.env.FAST2SMS_API_KEY ||
    process.env.SMS_API_KEY;

  if (apiKey) {
    try {
      const response = await fetch("https://www.fast2sms.com/dev/bulkV2", {
        method: "POST",
        headers: {
          authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          route: "v3",
          sender_id: "TXTIND",
          message: messageText,
          language: "english",
          numbers: normalizedPhone,
        }),
      });

      const data = await response.json();
      if (data && (data.return === true || data.status_code === 200)) {
        return {
          success: true,
          sent: true,
          deliveryStatus: "DELIVERED",
          provider: "Fast2SMS",
          messageId: data.request_id || `msg_${Date.now()}`,
        };
      } else {
        return {
          success: false,
          sent: false,
          deliveryStatus: "FAILED",
          provider: "Fast2SMS",
          error: data.message || "E-bill SMS delivery failed from provider.",
        };
      }
    } catch (err) {
      return {
        success: false,
        sent: false,
        deliveryStatus: "FAILED",
        provider: "Fast2SMS",
        error: err.message,
      };
    }
  }

  // Development / Unconfigured fallback
  console.log(`[Messaging Provider] (Dev/No API Key E-Bill) To: ${normalizedPhone} | Content: ${messageText}`);
  return {
    success: false,
    sent: false,
    deliveryStatus: "FAILED",
    provider: "Console/Unconfigured",
    error: "SMS provider API key not configured.",
    devMessage: messageText,
  };
};

module.exports = {
  sendPaymentLinkMessage,
  sendEBillMessage,
};
