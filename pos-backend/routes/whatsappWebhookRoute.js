const express = require("express");
const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const { myoperatorWebhook, metaVerify, metaWebhook } = require("../controllers/csdWhatsappController");

/**
 * Public: WhatsApp providers post customer messages and delivery receipts
 * here for the CSD support inbox. MyOperator signs nothing, so its URL carries
 * a secret (WHATSAPP_WEBHOOK_TOKEN); Meta's is checked by signature.
 */
const router = express.Router();

const limiter = rateLimit({ windowMs: 60 * 1000, max: 600, keyGenerator: (req) => "wa-webhook:" + clientIp(req) });

router.post("/webhook/myoperator/:token", limiter, myoperatorWebhook);
router.get("/webhook/meta", limiter, metaVerify);
router.post("/webhook/meta", limiter, metaWebhook);

module.exports = router;
