/**
 * KnotKitchen's per-e-bill charge.
 *
 * Charged when a message is actually DELIVERED, never per attempt. A send that
 * failed cost the restaurant nothing and must cost them nothing -- billing for
 * a message the customer never received is the kind of charge that ends up in
 * a support conversation.
 *
 * It is priced per BILL: the first delivered e-bill for an order (or a table
 * session, whose orders share one bill) is charged, and a re-send of the same
 * bill -- the settle modal and the auto-send both firing, or the operator
 * pressing the button again -- costs nothing more.
 *
 * A shortfall never blocks the message. It has already been delivered by the
 * time this runs; refusing to record the charge would only lose the money
 * twice over. The debit is simply skipped and logged, and the account will
 * lock on its unpaid platform fees long before 25 paise a message matters.
 */

const Restaurant = require("../models/restaurantModel");
const { getPlatformConfig, resolveEBillCharge } = require("./pricing");
const { computeTax } = require("./tax");
const { debit, InsufficientBalanceError } = require("./ledger");

/**
 * One key per bill: `billRef` is the table session, or the order when it has
 * none. A send with no bill to point at falls back to the provider's id for
 * that one message.
 */
const idempotencyKeyFor = ({ billRef, messageId }) => (billRef ? `ebill-bill-${billRef}` : `ebill-${messageId}`);

const chargeForEBill = async ({ restaurantId, messageId, billRef = null, refType = "", refId = null, orderNumber = "" }) => {
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
        // Always tax-exclusive: GST goes on top, like the plan lines. Only
        // printer lines are GST-inclusive; gst.mode is not consulted.
        mode: "exclusive",
      })
    : { totalTaxPaise: 0, totalPaise: charge.amountPaise, percent: 0 };

  try {
    const { entry, duplicate } = await debit({
      restaurantId,
      kind: "EBILL_CHARGE",
      amountPaise: tax.totalPaise,
      description: orderNumber ? `E-bill — #${orderNumber}` : "E-bill",
      idempotencyKey: idempotencyKeyFor({ billRef, messageId }),
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
