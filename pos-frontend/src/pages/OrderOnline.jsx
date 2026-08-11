import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  qrGetTable,
  qrGetSession,
  qrPlaceOrder,
  qrRequestBill,
  qrCallWaiter,
  qrGetPaymentIntent,
} from "../https/publicApi";

const ITEM_STATUS_LABEL = {
  pending: "Pending",
  preparing: "Preparing",
  ready: "Ready",
  served: "Served",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export default function OrderOnline() {
  const [params] = useSearchParams();
  const token = params.get("table") || "";

  const [table, setTable] = useState(null);
  const [restaurant, setRestaurant] = useState(null);
  const [menu, setMenu] = useState([]);
  const [session, setSession] = useState(null);
  const [cat, setCat] = useState("all");
  const [cart, setCart] = useState({});
  const [cust, setCust] = useState({ name: "", phone: "", guests: 1 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placingMsg, setPlacingMsg] = useState("");
  const [paymentInfo, setPaymentInfo] = useState(null);
  const [loadingPayment, setLoadingPayment] = useState(false);

  // Load table + restaurant + menu + active session detail (server-side
  // resolved from the secure QR token — the client never supplies ids).
  useEffect(() => {
    if (!token) {
      setErr("Invalid QR code.");
      setLoading(false);
      return;
    }
    qrGetTable(token)
      .then(({ data }) => {
        setTable(data.data.table);
        setRestaurant(data.data.restaurant);
        setMenu(data.data.menu || []);
        setSession(data.data.activeSession || null);
      })
      .catch((e) => setErr(e.response?.data?.message || "Unable to load menu."))
      .finally(() => setLoading(false));
  }, [token]);

  const cats = useMemo(() => [...new Set(menu.map((m) => m.category).filter(Boolean))], [menu]);
  const filtered = useMemo(() => (cat === "all" ? menu : menu.filter((m) => m.category === cat)), [menu, cat]);
  const cartList = useMemo(() => Object.values(cart), [cart]);
  const cartTotal = cartList.reduce((s, { item, qty }) => s + item.price * qty, 0);

  // Running session totals (existing + currently pending in cart)
  const sessionSubtotal = session?.bills?.subtotal || 0;
  const sessionTax = session?.bills?.tax || 0;
  const sessionTotal = session?.bills?.totalWithTax || 0;
  const sessionItems = session?.items || [];
  const sessionItemCount = sessionItems.reduce((s, i) => s + (i.quantity || 0), 0);

  const add = (item) => setCart((p) => ({ ...p, [item._id]: { item, qty: (p[item._id]?.qty || 0) + 1 } }));
  const sub = (item) =>
    setCart((p) => {
      const n = { ...p };
      if (!n[item._id]) return p;
      n[item._id] = { item, qty: n[item._id].qty - 1 };
      if (n[item._id].qty <= 0) delete n[item._id];
      return n;
    });

  const refreshSession = async () => {
    try {
      const { data } = await qrGetSession(token);
      setSession(data.data.session);
    } catch {
      // If no active session (e.g. settled meanwhile), keep current state
    }
  };

  // Send items to the kitchen. If a session already exists for this table
  // (e.g. this is the third scan / "add a Water" moment), the backend appends
  // to the SAME active session — it never creates a second session.
  const checkout = async () => {
    if (!cust.phone || cust.phone.length < 10) {
      setErr("Enter a valid phone number.");
      return;
    }
    setPlacing(true);
    setErr("");
    setPlacingMsg("");
    try {
      const { data } = await qrPlaceOrder(token, {
        items: cartList.map(({ item, qty }) => ({ menuItemId: item._id, quantity: qty })),
        customerName: cust.name,
        customerPhone: cust.phone,
        customerCount: Number(cust.guests) || 1,
        requestId: crypto.randomUUID(),
      });
      setSession(data.data.session);
      setCart({});
      setPlacingMsg("Order sent to the kitchen!");
      // Refresh session to show updated items/running total
      await refreshSession();
    } catch (e) {
      setErr(e.response?.data?.message || "Order failed.");
    } finally {
      setPlacing(false);
    }
  };

  // Token-scoped bill request — the backend resolves the active session from
  // the QR token's table. The customer cannot pass an arbitrary sessionId.
  const requestBill = async () => {
    try {
      const { data } = await qrRequestBill(token);
      setSession(data.data.session);
      setPlacingMsg("Bill requested — a staff member will assist you.");
    } catch {
      setPlacingMsg("Could not request bill.");
    }
  };

  const callWaiter = async () => {
    try {
      await qrCallWaiter(token);
      setPlacingMsg("Waiter called!");
    } catch {
      setPlacingMsg("Could not call waiter.");
    }
  };

  // Payment UI preparation ONLY — this does NOT complete the payment.
  // The table stays OCCUPIED/PROCESSING/BILL_REQUESTED and the bill stays open.
  const preparePayment = async () => {
    setLoadingPayment(true);
    setErr("");
    try {
      const { data } = await qrGetPaymentIntent(token);
      setPaymentInfo(data.data);
    } catch (e) {
      setErr(e.response?.data?.message || "Could not prepare payment.");
    } finally {
      setLoadingPayment(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading menu…</div>;
  if (err && !table) return <div className="min-h-screen flex items-center justify-center p-6 text-red-600">{err}</div>;

  const brandName = restaurant?.name || "Knot Kitchen";
  const currency = restaurant?.currency === "USD" ? "$" : "₹";

  return (
    <div className="min-h-screen bg-gray-50 pb-40">
      <header className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex justify-between items-center">
        <div>
          <h1 className="font-bold">{brandName}</h1>
          <p className="text-xs text-gray-500">Table {table?.tableNumber} · Capacity {table?.capacity}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={callWaiter} className="text-xs px-3 py-1.5 rounded-full border text-gray-700">Call Waiter</button>
          {session && (
            <button onClick={requestBill} className="text-xs px-3 py-1.5 rounded-full bg-gray-900 text-white">Request Bill</button>
          )}
        </div>
      </header>

      {placingMsg && (
        <div className="bg-green-50 border-b border-green-200 px-4 py-2 text-sm text-green-700">
          {placingMsg}
        </div>
      )}

      {/* ===== Active table session (existing items, quantities, running total) ===== */}
      {session && (
        <section className="bg-white border-b px-4 py-3">
          <div className="flex justify-between items-center mb-2">
            <h2 className="font-semibold text-sm">Your Table Order</h2>
            <span className="text-xs text-gray-500">
              {sessionItemCount} item(s) · {session.customerCount || 1} guest(s)
            </span>
          </div>

          <ul className="divide-y divide-gray-100 mb-2">
            {sessionItems.map((it) => (
              <li key={it._id} className="flex justify-between py-1.5 text-sm">
                <div>
                  <span className="font-medium">{it.name}</span>
                  <span className="text-gray-400"> × {it.quantity}</span>
                  <span className="ml-2 text-xs text-gray-400">{ITEM_STATUS_LABEL[it.status] || it.status}</span>
                </div>
                <span className="font-medium">{currency}{it.total}</span>
              </li>
            ))}
          </ul>

          <div className="text-sm space-y-0.5 border-t pt-2">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>{currency}{sessionSubtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Tax</span>
              <span>{currency}{sessionTax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{currency}{sessionTotal.toFixed(2)}</span>
            </div>
          </div>

          {session.status === "BILL_REQUESTED" && (
            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
              <span>🧾</span> Bill requested — your server will be with you shortly.
            </p>
          )}

          {/* Payment UI section — prepare only; does NOT settle the table */}
          <div className="mt-3">
            {!paymentInfo ? (
              <button
                onClick={preparePayment}
                disabled={loadingPayment}
                className="w-full text-sm bg-gray-100 border border-gray-200 text-gray-800 py-2 rounded-xl font-semibold disabled:opacity-50"
              >
                {loadingPayment ? "Preparing…" : "View Payment Summary"}
              </button>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm">
                <div className="flex justify-between font-semibold mb-1">
                  <span>Payable Amount</span>
                  <span>{currency}{paymentInfo.amount.toFixed(2)}</span>
                </div>
                <p className="text-xs text-gray-500">
                  Status: {session.status} · Payment: {paymentInfo.paymentStatus}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Payment capture is handled by staff at the counter.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      <nav className="sticky top-[57px] z-10 bg-white border-b px-3 py-2 flex gap-2 overflow-x-auto">
        <button key="all" onClick={() => setCat("all")}
          className={`whitespace-nowrap px-3 py-1 rounded-full text-sm ${cat === "all" ? "bg-amber-500 text-white" : "bg-gray-100"}`}>All</button>
        {cats.map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className={`whitespace-nowrap px-3 py-1 rounded-full text-sm ${cat === c ? "bg-amber-500 text-white" : "bg-gray-100"}`}>{c}</button>
        ))}
      </nav>

      <main className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((item) => (
          <div key={item._id} className="bg-white border rounded-xl p-4">
            <div className="flex justify-between gap-2">
              <div>
                <h3 className="font-semibold">{item.name}</h3>
                {item.description && <p className="text-xs text-gray-500 mt-1">{item.description}</p>}
              </div>
              <button onClick={() => add(item)} className="w-8 h-8 rounded-full bg-amber-500 text-white font-bold">+</button>
            </div>
            <div className="flex justify-between items-center mt-2">
              <span className="font-semibold">{currency}{item.price}</span>
              {cart[item._id]?.qty > 0 && (
                <div className="flex items-center gap-2">
                  <button onClick={() => sub(item)} className="w-7 h-7 rounded-full bg-gray-200 font-bold">−</button>
                  <span className="font-semibold">{cart[item._id].qty}</span>
                  <button onClick={() => add(item)} className="w-7 h-7 rounded-full bg-gray-200 font-bold">+</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </main>

      {cartList.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 p-4 bg-gradient-to-t from-white to-transparent">
          <div className="max-w-2xl mx-auto bg-gray-900 text-white rounded-2xl p-4">
            <div className="flex justify-between mb-3">
              <span className="font-semibold">{cartList.length} item(s) · {currency}{cartTotal}</span>
              <button onClick={() => setCart({})} className="text-xs text-gray-400">Clear</button>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <input placeholder="Name" value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })}
                className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm" />
              <input placeholder="Phone*" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })}
                className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm" />
              <input placeholder="Guests" type="number" min="1" value={cust.guests} onChange={(e) => setCust({ ...cust, guests: e.target.value })}
                className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm" />
            </div>
            {err && <p className="text-red-300 text-xs mb-2">{err}</p>}
            <button onClick={checkout} disabled={placing}
              className="w-full bg-amber-500 py-3 rounded-xl font-bold disabled:opacity-50">
              {placing ? "Sending…" : session ? "Send Order to Kitchen (adds to table)" : "Send Order to Kitchen"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}