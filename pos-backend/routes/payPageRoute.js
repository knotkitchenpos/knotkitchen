const express = require("express");
const WebsiteCheckout = require("../models/websiteCheckoutModel");
const { esc: escapeHtml } = require("../services/invoiceDocument");
const { tokenForCheckout, readToken } = require("../services/receiptLink");

/**
 * The one page every website payment opens on: pay.<base>/c/<checkoutId>.
 *
 * Cashfree only opens checkout on domains the merchant has whitelisted, and it
 * does not accept wildcards. Every restaurant website lives on its own host
 * (231146.knotkitchen.com, a custom domain...), so opening checkout there meant
 * one whitelist entry per store. Instead the store sends the customer here,
 * checkout opens on this single host, Cashfree returns here, and this sends
 * the customer back to their restaurant -- where the order is confirmed with
 * the gateway exactly as before. One whitelist entry covers every store.
 *
 * Nothing on this page decides that an order was paid. It only moves the
 * browser between the store and the gateway.
 */
const router = express.Router();

/**
 * A website checkout by its bare id; a Knot Eats checkout only by its signed
 * c_ token. backToStore hands that token back, so a bare id (guessable from
 * one's own checkouts) must never reach a Knot Eats checkout here.
 */
const findCheckout = async (id) => {
  const token = readToken(id);
  if (token?.isCheckout) return WebsiteCheckout.findById(token.id).lean();
  if (!/^[a-f0-9]{24}$/i.test(String(id || ""))) return null;
  const checkout = await WebsiteCheckout.findById(id).lean();
  return checkout?.orderData?.salesChannel === "KNOT_EATS" ? null : checkout;
};

/**
 * Back to the restaurant's own menu, carrying the checkout to confirm. A Knot
 * Eats checkout carries a signed c_ token instead of the bare id: Knot Eats
 * confirms only by token, so a guessed id can never place or reveal an order.
 */
const backToStore = (checkout) => {
  const url = new URL(checkout.returnUrl);
  const knotEats = checkout.orderData?.salesChannel === "KNOT_EATS";
  url.searchParams.set("checkout", knotEats ? tokenForCheckout(checkout._id) : String(checkout._id));
  return url.toString();
};

const page = (title, body) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a}
  .box{max-width:360px;padding:28px;text-align:center}
  .spin{width:36px;height:36px;margin:0 auto 16px;border:3px solid #e2e8f0;border-top-color:#0f172a;border-radius:50%;animation:s 1s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  a{color:#0f172a;font-weight:600}
  p{color:#475569}
</style></head><body><div class="box">${body}</div></body></html>`;

router.get("/:checkoutId", async (req, res) => {
  const checkout = await findCheckout(req.params.checkoutId).catch(() => null);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (!checkout || !checkout.returnUrl) {
    return res.status(404).send(page("Payment not found", "<h1>Payment not found</h1><p>This payment link is no longer valid.</p>"));
  }
  // Already paid (or being placed): nothing to pay, go back and show the order.
  if (checkout.status !== "PENDING" || !checkout.paymentSessionId) return res.redirect(302, backToStore(checkout));

  const config = JSON.stringify({ paymentSessionId: checkout.paymentSessionId, mode: checkout.mode || "sandbox" }).replace(/</g, "\\u003c");
  const back = escapeHtml(backToStore(checkout));
  // The last screen before money moves, so a platform fee is spelled out here.
  const rs = (n) => `₹${escapeHtml(Number(n).toFixed(2))}`;
  const fee = Number(checkout.orderData?.bills?.platformFee) || 0;
  const amountLine = fee > 0
    ? `Order ${rs(checkout.orderData.bills.totalWithTax)} + Platform fee ${rs(fee)} = ${rs(checkout.amount)}`
    : `Amount: ${rs(checkout.amount)}`;
  res.status(200).send(
    page(
      "Secure payment",
      `<div class="spin" aria-hidden="true"></div>
<h1 style="font-size:1.2rem">Opening secure payment…</h1>
<p>${amountLine}</p>
<p id="err" hidden>The payment page could not be opened. <a href="${back}">Return to the restaurant</a>.</p>
<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
<script>
  (function () {
    var cfg = ${config};
    function fail() { document.getElementById("err").hidden = false; }
    try {
      if (!window.Cashfree) return fail();
      window.Cashfree({ mode: cfg.mode }).checkout({ paymentSessionId: cfg.paymentSessionId, redirectTarget: "_self" });
    } catch (e) { fail(); }
  })();
</script>`,
    ),
  );
});

/** Cashfree's return_url. Always back to the store, which asks the gateway what happened. */
router.get("/:checkoutId/done", async (req, res) => {
  const checkout = await findCheckout(req.params.checkoutId).catch(() => null);
  res.setHeader("Cache-Control", "no-store");
  if (!checkout || !checkout.returnUrl) {
    return res.status(404).send(page("Payment not found", "<h1>Payment not found</h1><p>This payment link is no longer valid.</p>"));
  }
  res.redirect(302, backToStore(checkout));
});

module.exports = router;
