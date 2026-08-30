import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { paymentLinkGet, paymentLinkVerify } from "../https/publicApi";

function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(window.Razorpay);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(window.Razorpay);
    s.onerror = () => resolve(null);
    document.body.appendChild(s);
  });
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
    const Razorpay = await loadRazorpay();
    if (!Razorpay) { setErr("Payment gateway could not be loaded."); setProcessing(false); return; }
    try {
      const rzp = await new Promise((resolve, reject) => {
        const r = new Razorpay({
          key: import.meta.env.VITE_RAZORPAY_KEY_ID,
          order_id: link.gatewayOrderId,
          amount: Math.round(link.amount * 100),
          currency: link.currency || "INR",
          name: "Knot Kitchen",
          description: `Bill ${link.billNumber || ""}`,
          handler: async (res) => {
            // `res` carries razorpay_order_id / _payment_id / _signature. All
            // three are now REQUIRED by the capture endpoint — it no longer
            // settles a link on unverified input.
            //
            // paymentMethod is sent explicitly rather than relying on the
            // server default: that default was "RAZORPAY", a provider name the
            // PaymentTransaction.method enum rejects, so every genuine capture
            // used to abort with a ValidationError.
            await paymentLinkVerify(token, {
              ...res,
              paymentMethod: "ONLINE",
              idempotencyKey: `${res.razorpay_order_id}_${res.razorpay_payment_id}`,
            });
            setDone(true);
            resolve(r);
          },
          modal: { ondismiss: () => resolve(r) },
        });
        r.on("payment.failed", () => { setErr("Payment failed. Please try again."); resolve(r); });
        r.open();
      });
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