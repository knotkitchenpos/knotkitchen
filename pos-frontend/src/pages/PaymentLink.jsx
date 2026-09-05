import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { paymentLinkGet, paymentLinkVerify } from "../https/publicApi";

/**
 * Load a gateway SDK once and hand back whatever global it defines.
 *
 * Resolves null rather than rejecting: a customer whose network blocks the
 * gateway CDN should get "could not be loaded", not a blank screen.
 */
function loadScript(src, pick) {
  return new Promise((resolve) => {
    const existing = pick();
    if (existing) return resolve(existing);
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve(pick() || null);
    s.onerror = () => resolve(null);
    document.body.appendChild(s);
  });
}

function loadRazorpay() {
  return loadScript("https://checkout.razorpay.com/v1/checkout.js", () => window.Razorpay);
}

function loadCashfree() {
  return loadScript("https://sdk.cashfree.com/js/v3/cashfree.js", () => window.Cashfree);
}

export default function PaymentLink() {
  const { token } = useParams();
  const [link, setLink] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    paymentLinkGet(token)
      .then(({ data }) => setLink(data.data))
      .catch((e) => setErr(e.response?.data?.message || "Invalid payment link."))
      .finally(() => setLoading(false));
  }, [token]);

  const pay = async () => {
    setProcessing(true);
    setErr("");

    /**
     * Ask our own server what really happened, and reflect its answer.
     *
     * For Cashfree there is nothing in `payload` worth sending -- the server
     * asks Cashfree directly about the order it opened. For Razorpay the
     * signature triple is required, and the capture endpoint refuses without
     * it.
     */
    const confirm = async (payload) => {
      try {
        await paymentLinkVerify(token, {
          ...(payload || {}),
          // Sent explicitly rather than relying on the server default: that
          // default was "RAZORPAY", a provider name the PaymentTransaction
          // method enum rejects, so every genuine capture used to abort with
          // a ValidationError.
          paymentMethod: "ONLINE",
        });
        setDone(true);
      } catch (e) {
        setErr(
          e.response?.data?.message ||
            "We could not confirm that payment. Please contact the restaurant.",
        );
      }
    };

    try {
      if (String(link.gatewayName || "").toUpperCase() === "CASHFREE") {
        const Cashfree = await loadCashfree();
        if (!Cashfree) {
          setErr("Payment gateway could not be loaded.");
          return;
        }
        const cashfree = Cashfree({ mode: link.gatewayMode || "sandbox" });
        // Whatever the modal resolves with, we still ask our server. That
        // covers the diner who paid and then closed it before it reported.
        await cashfree.checkout({
          paymentSessionId: link.paymentSessionId,
          redirectTarget: "_modal",
        });
        await confirm();
      } else {
        const Razorpay = await loadRazorpay();
        if (!Razorpay) {
          setErr("Payment gateway could not be loaded.");
          return;
        }
        await new Promise((resolve) => {
          const r = new Razorpay({
            // The link carries its store's own public key id. This used to
            // read a build-time env var, so a store paying through its OWN
            // Razorpay account had the PLATFORM key put in front of the
            // customer and the order id would not match it.
            key: link.gatewayKeyId || import.meta.env.VITE_RAZORPAY_KEY_ID,
            order_id: link.gatewayOrderId,
            amount: Math.round(link.amount * 100),
            currency: link.currency || "INR",
            name: link.restaurantName || "Knot Kitchen",
            description: `Bill ${link.billNumber || ""}`,
            handler: async (res) => {
              await confirm({
                ...res,
                idempotencyKey: `${res.razorpay_order_id}_${res.razorpay_payment_id}`,
              });
              resolve();
            },
            modal: { ondismiss: () => resolve() },
          });
          r.on("payment.failed", () => {
            setErr("Payment failed. Please try again.");
            resolve();
          });
          r.open();
        });
      }
    } catch {
      setErr("Payment could not be completed.");
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  if (err && !link) return <div className="min-h-screen flex items-center justify-center p-6 text-red-600">{err}</div>;

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-2xl shadow p-8 max-w-sm w-full text-center">
          <div className="text-5xl mb-3">✅</div>
          <h1 className="text-xl font-bold mb-2">Payment Successful!</h1>
          <p className="text-sm text-gray-600">Thank you for dining with Knot Kitchen.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-2xl shadow p-8 max-w-sm w-full">
        <h1 className="text-xl font-bold text-gray-900 text-center mb-1">Knot Kitchen</h1>
        <p className="text-sm text-gray-500 text-center mb-6">
          {link.billNumber ? `Bill ${link.billNumber}` : "Pay for your order"}
        </p>

        <div className="bg-gray-50 rounded-xl p-4 flex justify-between items-center mb-6">
          <span className="text-gray-500">Amount Due</span>
          <span className="text-2xl font-bold text-gray-900">
            {link.currency || "₹"}{link.amount}
          </span>
        </div>

        {err && <p className="text-red-600 text-sm mb-4 text-center">{err}</p>}

        <button
          onClick={pay}
          disabled={processing}
          className="w-full bg-gray-900 text-white py-3 rounded-xl font-bold disabled:opacity-50"
        >
          {processing ? "Processing…" : "Pay Now"}
        </button>
        <p className="text-xs text-gray-400 text-center mt-4">
          Secured by Razorpay · You will receive a confirmation after payment.
        </p>
      </div>
    </div>
  );
}