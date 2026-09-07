/**
 * KnotKitchen's per-e-bill charge.
 *
 * Charged when a message is actually DELIVERED, never per attempt. A send that
 * failed cost the restaurant nothing and must cost them nothing -- billing for
 * a message the customer never received is the kind of charge that ends up in
 * a support conversation.
 *
 * Each delivered message is charged, including a deliberate re-send: a second
 * message is a second WhatsApp message and a second cost. The idempotency key
 * is therefore the provider's own request id for that message, not the order
 * -- keying on the order would make every re-send free.
 *
 * A shortfall never blocks the message. It has already been delivered by the
 * time this runs; refusing to record the charge would only lose the money
 * twice over. The debit is simply skipped and logged, and the account will
 * lock on its unpaid ORDER charges long before 25 paise a message matters.
 */

const Restaurant = require("../models/restaurantModel");
const { getPlatformConfig, resolveEBillCharge } = require("./pricing");
const { computeTax } = require("./tax");
const { debit, InsufficientBalanceError } = require("./ledger");

/**
 * One key per delivered message.
 *
 * `messageId` is what the provider returned for THIS send. Two sends of the
 * same bill produce two ids and two charges, which is correct -- they are two
 * messages.
 */
const idempotencyKeyFor = (messageId) => `ebill-${messageId}`;

const chargeForEBill = async ({ restaurantId, messageId, refType = "", refId = null, orderNumber = "" }) => {
  if (!restaurantId || !messageId) return { charged: false, reason: "Nothing to charge against." };

  const config = await getPlatformConfig();
  const charge = await resolveEBillCharge({ restaurantId, config });

  if (!charge.enabled) return { charged: false, reason: "E-bill charge is not enabled." };
  if (!charge.amountPaise) return { charged: false, reason: "E-bill charge is zero for this restaurant." };

  const restaurant = await Restaurant.findById(restaurantId).select("address").lean();
  const tax = charge.taxable
    ? computeTax({
        amountPaise: charge.amountPaise,
        gst: config.gst,
        restaurantState: restaurant?.address?.state,
      })
    : { totalTaxPaise: 0, totalPaise: charge.amountPaise, percent: 0 };

  try {
    const { entry, duplicate } = await debit({
      restaurantId,
      kind: "EBILL_CHARGE",
      amountPaise: tax.totalPaise,
      description: orderNumber ? `E-bill sent — #${orderNumber}` : "E-bill sent",
      idempotencyKey: idempotencyKeyFor(messageId),
      refType,
      refId,
      meta: { messageId, orderNumber },
    });
    return { charged: !duplicate, duplicate: Boolean(duplicate), entry };
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      // The message is already delivered. Nothing to undo, and nothing worth
      // blocking.
      console.warn(
        `[EBillCharge] ${restaurantId}: balance short by the time the e-bill was sent (${tax.totalPaise}p).`,
      );
      return { charged: false, reason: "Insufficient Business Balance." };
    }
    throw err;
  }
};

/** Fire-and-forget. A billing problem must never fail a message already sent. */
const fireEBillCharge = (args) => {
  chargeForEBill(args).catch((err) => {
    console.warn("[EBillCharge] failed:", err && err.message);
  });
};

module.exports = { chargeForEBill, fireEBillCharge, idempotencyKeyFor };
