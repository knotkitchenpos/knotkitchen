import { sendEBill } from "../https";

/**
 * Send the e-bill for a table session that has just been settled.
 *
 * A table order had no way to send one at all: the only Send E-Bill button
 * lives in the counter invoice, which is never rendered for a table session.
 * That left out every QR order — which is exactly where a customer's phone
 * number IS reliably on file.
 *
 * Called AFTER the payment succeeds and never gating it. The money is already
 * recorded by then, so a messaging failure is reported on its own, as a
 * warning, rather than making a settled table look unsettled.
 *
 * Shared by the Orders and Tables screens so the two report it identically.
 */
export const sendTableEBill = async ({ sessionId, phone, notify }) => {
  try {
    const res = await sendEBill({ tableSessionId: sessionId, phone });
    if (res?.data?.sent) {
      notify(`E-bill sent to ${phone}.`, { variant: "success" });
      return true;
    }
    notify(res?.data?.message || "Paid, but the e-bill could not be delivered.", {
      variant: "warning",
    });
    return false;
  } catch (err) {
    notify(err?.response?.data?.message || "Paid, but the e-bill could not be delivered.", {
      variant: "warning",
    });
    return false;
  }
};

export default sendTableEBill;
