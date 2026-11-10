const express = require("express");
const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const { myoperatorWebhook, fast2smsWebhook, metaVerify, metaWebhook } = require("../controllers/csdWhatsappController");

/**
 * Public: WhatsApp providers post customer messages and delivery receipts
 * here for the CSD support inbox. MyOperator signs nothing, so its URL carries
 * a secret (WHATSAPP_WEBHOOK_TOKEN); Fast2SMS sends a fixed secret header;
 * Meta's is checked by signature.
 */
const router = express.Router();

const limiter = rateLimit({ windowMs: 60 * 1000, max: 600, keyGenerator: (req) => "wa-webhook:" + clientIp(req) });

router.post("/webhook/myoperator/:token", limiter, myoperatorWebhook);
router.post("/webhook/fast2sms", limiter, fast2smsWebhook);
router.get("/webhook/meta", limiter, metaVerify);
router.post("/webhook/meta", limiter, metaWebhook);

module.exports = router;
