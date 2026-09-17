import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { paymentLinkGet, paymentLinkVerify } from "../https/publicApi";
import { loadCashfree } from "../utils/cashfree";

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
     * asks Cashfree directly about the order it opened, so there is nothing
     * from the browser in that decision at all.
     */
    const confirm = async (payload) => {
      try {
        await paymentLinkVerify(token, {
          ...(payload || {}),
          // Sent explicitly rather than relying on a server default: a
          // provider NAME is not an instrument, and the PaymentTransaction
          // method enum rejects one, so every genuine capture used to abort
          // with a ValidationError.
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
          Secured by Cashfree · You will receive a confirmation after payment.
        </p>
      </div>
    </div>
  );
}