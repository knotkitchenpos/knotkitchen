import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useParams } from "react-router-dom";
import ProductOptionsSheet from "../components/qr/ProductOptionsSheet";
import {
  qrGetTable,
  qrPlaceOrder,
  qrRequestBill,
  qrCallWaiter,
  qrGetPaymentIntent,
  qrVerifyPayment,
} from "../https/publicApi";
import { loadCashfree } from "../utils/cashfree";
import { money as formatMoney } from "../utils";

/**
 * Customer-facing table-QR menu (mobile-first).
 *
 * URL: /order?table=<token>  or  /t/<token>
 *
 * Flow:
 *  1. Server resolves the table + restaurant + menu + any active session
 *     from the QR token (never trusts URL/body tenant ids — see qrRoute).
 *  2. Customer browses, taps + to add to cart, taps "Send to kitchen".
 *  3. Order is attached to a per-table session; POS gets a realtime pop-up
 *     with the table number.
 *  4. "Request Bill" transitions the session to BILL_REQUESTED (staff
 *     settles at the counter). "Call Waiter" pings the table.
 */

const ITEM_STATUS_STYLE = {
  pending: "bg-slate-100 text-slate-600",
  preparing: "bg-amber-50 text-amber-700",
  ready: "bg-emerald-50 text-emerald-700",
  served: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-50 text-red-600 line-through",
  refunded: "bg-red-100 text-red-700 line-through",
};

/** The kitchen's status for the whole table, mirrored from the POS. */
const ORDER_STATUS_STYLE = {
  Preparing: "bg-amber-50 text-amber-700",
  Ready: "bg-emerald-100 text-emerald-800",
  Completed: "bg-slate-200 text-slate-700",
  Served: "bg-emerald-100 text-emerald-800",
  Delivered: "bg-emerald-100 text-emerald-800",
  Cancelled: "bg-red-50 text-red-600",
  paid: "bg-slate-200 text-slate-700",
};

export default function OrderOnline() {
  const { token: routeToken } = useParams();
  const [params, setParams] = useSearchParams();
  const token = routeToken || params.get("table") || "";

  // The claim on ONE session, kept in the URL as `?s=`.
  //
  // The QR printed on the table never changes, so the link it opens never
  // changes either -- a diner from last week still has it. Without a claim
  // that link opened whatever session was live at the table: it showed the
  // current party's name, phone and running bill, and could add dishes to it.
  //
  // The server mints this token per session and refuses any request naming a
  // session that is no longer running. It lives in the URL so a reload, a
  // locked phone and a bookmark all stay in the same order -- and so a link
  // saved by an earlier diner carries a claim that is already dead.
  const claimRef = useRef(params.get("s") || "");
  // Once the claim is spent the page STOPS. It must never quietly re-scan and
  // adopt whichever party is sitting at that table now -- that is the bug.
  const [expired, setExpired] = useState(false);
  const expiredRef = useRef(false);

  const [table, setTable] = useState(null);
  const [restaurant, setRestaurant] = useState(null);
  const [menu, setMenu] = useState([]);
  const [session, setSession] = useState(null);
  const [cat, setCat] = useState("all");
  const [query, setQuery] = useState("");
  // { [lineKey]: { key, item, qty, variant, modifiers, unitPrice } } — keyed by
  // product AND chosen options, so two configurations of the same product are
  // two lines.
  const [cart, setCart] = useState({});
  // The product whose options the customer is currently choosing, if any.
  const [optionsItem, setOptionsItem] = useState(null);
  // Number of people is not asked for: the diner does not reliably know it,
  // it was never used for anything the customer sees, and the till can set a
  // real count. The server defaults it to 1.
  const [cust, setCust] = useState({ name: "", phone: "" });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // The restaurant is locked for non-payment: the menu shows, a seated party
  // can still call a waiter and pay, but nothing new can be ordered.
  const [paused, setPaused] = useState("");
  const [banner, setBanner] = useState(""); // in-page success/info banner
  const [callingWaiter, setCallingWaiter] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState(null);
  const [loadingPayment, setLoadingPayment] = useState(false);
  const [paying, setPaying] = useState(false);
  // Declared with the other hooks: the loading and error early returns are
  // below, and a hook after one of those runs conditionally.
  const menuRef = useRef(null);

  /** Hold on to the claim the server issued, and put it in the address bar. */
  const rememberClaim = (issued) => {
    if (!issued || issued === claimRef.current) return;
    claimRef.current = issued;
    const next = new URLSearchParams(window.location.search);
    next.set("s", issued);
    // replace, not push: the claim-less URL must not be left in history for a
    // back button (or a saved link) to return to.
    setParams(next, { replace: true });
  };

  /** The session this page was in is over. Stop, and say so. */
  const endSession = (message) => {
    expiredRef.current = true;
    claimRef.current = "";
    setExpired(true);
    setSession(null);
    setCartOpen(false);
    setPaymentInfo(null);
    setErr(message || "");
  };

  const refetch = () => {
    if (!token || expiredRef.current) return;
    return qrGetTable(token, claimRef.current)
      .then(({ data }) => {
        const d = data.data;
        if (d.sessionExpired) return endSession(d.message);
        setTable(d.table);
        setRestaurant(d.restaurant);
        setMenu(d.menu || []);
        setPaused(d.orderingPaused ? d.orderingPausedMessage || "Ordering is paused right now." : "");
        setSession(d.activeSession || null);
        rememberClaim(d.sessionToken);
        setErr("");
      })
      .catch((e) => {
        if (e.response?.status === 409) return endSession(e.response?.data?.message);
        setErr(e.response?.data?.message || "Unable to load menu.");
      });
  };

  useEffect(() => {
    if (!token) {
      setErr("Invalid QR code — the table link is missing its token.");
      setLoading(false);
      return;
    }
    refetch().finally(() => setLoading(false));
    // Light polling so the customer sees kitchen-status updates on their
    // items without needing to refresh.
    const t = setInterval(refetch, 12000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Menu can arrive as flat items OR as { systemSnapshot: { items: [...] } }.
  const flatMenu = useMemo(() => {
    const out = [];
    for (const m of menu || []) {
      if (Array.isArray(m?.items)) {
        for (const i of m.items) out.push({ ...i, category: i.category || m.name || "Menu" });
      } else if (Array.isArray(m?.systemSnapshot?.items)) {
        for (const i of m.systemSnapshot.items)
          out.push({ ...i, category: i.category || m.systemSnapshot.name || "Menu" });
      } else if (m?._id && m?.name && m?.price != null) {
        out.push(m);
      }
    }
    return out.filter((i) => i && i.isAvailable !== false);
  }, [menu]);

  const cats = useMemo(
    () => Array.from(new Set(flatMenu.map((m) => m.category).filter(Boolean))),
    [flatMenu]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return flatMenu.filter((m) => {
      if (cat !== "all" && m.category !== cat) return false;
      if (q && !`${m.name || ""} ${m.description || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [flatMenu, cat, query]);

  const cartList = useMemo(() => Object.values(cart), [cart]);
  const cartCount = cartList.reduce((s, x) => s + x.qty, 0);
  // Each line carries its own unitPrice, because a chosen size or paid extra
  // changes what the line costs — item.price alone under-charged them.
  const cartTotal = cartList.reduce(
    (s, line) => s + Number(line.unitPrice ?? line.item.price ?? 0) * line.qty,
    0,
  );

  const sessionTotal = session?.bills?.totalWithTax || 0;
  const sessionItems = session?.items || [];
  const sessionItemCount = sessionItems.reduce((s, i) => s + (i.quantity || 0), 0);

  const currency = restaurant?.currency === "USD" ? "$" : "₹";
  const money = (n) => formatMoney(n, currency);

  /** A product needs a choice before it can be ordered. */
  const hasOptions = (item) =>
    (Array.isArray(item?.variants) && item.variants.length > 0) ||
    (Array.isArray(item?.modifierGroups) &&
      item.modifierGroups.filter((g) => g?.isActive !== false).length > 0);

  /**
   * Cart lines are keyed by the product AND its chosen options, so "Large, no
   * onion" and "Small, extra cheese" are two lines rather than one that
   * silently overwrites the other.
   */
  const lineKeyFor = (item, variant, modifiers) => {
    if (!variant && (!modifiers || modifiers.length === 0)) return String(item._id);
    const mods = (modifiers || [])
      .map((m) => `${m.groupName || ""}:${m.optionName || m.optionId || ""}`)
      .sort()
      .join("|");
    return `${item._id}::${variant?.variantId || ""}::${mods}`;
  };

  const addLine = ({ item, qty = 1, variant = null, modifiers = [], unitPrice }) => {
    const key = lineKeyFor(item, variant, modifiers);
    setCart((p) => ({
      ...p,
      [key]: {
        key,
        item,
        variant,
        modifiers,
        unitPrice: unitPrice ?? (Number(item.price) || 0),
        qty: (p[key]?.qty || 0) + qty,
      },
    }));
  };

  // Tapping a product with options opens the chooser; a plain product still
  // goes straight in, exactly as before.
  const add = (item) => {
    if (hasOptions(item)) {
      setOptionsItem(item);
      return;
    }
    addLine({ item, qty: 1, unitPrice: Number(item.price) || 0 });
  };

  const sub = (key) =>
    setCart((p) => {
      const n = { ...p };
      if (!n[key]) return p;
      const q = n[key].qty - 1;
      if (q <= 0) delete n[key];
      else n[key] = { ...n[key], qty: q };
      return n;
    });

  /** Total across every line of this product, however it was configured. */
  const qtyOfItem = (itemId) =>
    cartList.reduce((s, l) => (String(l.item._id) === String(itemId) ? s + l.qty : s), 0);

  const checkout = async () => {
    setErr("");
    if (cartList.length === 0) return;

    // Details are asked for ONCE, when this scan opens the table. A later
    // scan joins the session that is already running, and the diner who
    // opened it has already given them.
    if (!session) {
      if (!String(cust.name).trim()) {
        setErr("Please enter your name.");
        return;
      }
      if (!/^\d{10}$/.test(String(cust.phone).replace(/\D/g, "").slice(-10))) {
        setErr("Please enter a valid 10-digit phone number.");
        return;
      }
    }
    setPlacing(true);
    try {
      const items = cartList.map(({ item, qty, variant, modifiers, unitPrice }) => ({
        menuItemId: item._id,
        name: item.name,
        price: unitPrice ?? item.price,
        quantity: qty,
        // The server re-prices from these and rejects a missing required
        // choice, so they must travel with the line, not be inferred.
        ...(variant ? { variantId: variant.variantId } : {}),
        ...(modifiers && modifiers.length ? { modifierSelections: modifiers } : {}),
      }));
      await qrPlaceOrder(token, {
        items,
        // Sent only when opening the table. Adding to a running session must
        // not overwrite whoever opened it with a later diner's details.
        ...(session
          ? {}
          : {
              customerName: String(cust.name).trim(),
              customerPhone: String(cust.phone).replace(/\D/g, "").slice(-10),
            }),
        requestId: `${token.slice(0, 8)}-${Date.now()}`,
      }, claimRef.current);
      setCart({});
      setCartOpen(false);
      setBanner(`Sent to kitchen · ${tableName}`);
      setTimeout(() => setBanner(""), 4000);
      await refetch();
    } catch (e) {
      // 409 is specifically "that session is over". Stop here: re-scanning
      // automatically would put this cart onto the next party's bill, which
      // is the very thing the claim exists to prevent.
      if (e.response?.status === 409) {
        return endSession(e.response?.data?.message);
      }
      setErr(e.response?.data?.message || "Could not send the order. Please try again.");
    } finally {
      setPlacing(false);
    }
  };

  // Rings the till: the POS raises an alert naming this table and beeps until
  // a staff member acknowledges it. Needs no open order -- a diner who has
  // just sat down may want someone before they have ordered anything.
  const callWaiter = async () => {
    setCallingWaiter(true);
    try {
      await qrCallWaiter(token);
      setBanner("Waiter called — someone will be with you shortly.");
      setTimeout(() => setBanner(""), 5000);
    } catch (e) {
      setErr(e.response?.data?.message || "Could not call the waiter. Please try again.");
    } finally {
      setCallingWaiter(false);
    }
  };

  const requestBill = async () => {
    try {
      await qrRequestBill(token, claimRef.current);
      setBanner("Bill requested — your server will be with you shortly.");
      setTimeout(() => setBanner(""), 5000);
      await refetch();
    } catch (e) {
      if (e.response?.status === 409) return endSession(e.response?.data?.message);
      setErr(e.response?.data?.message || "Could not request the bill.");
    }
  };

  /**
   * "Pay" goes straight to the gateway: the server opens the Cashfree order
   * against the table's own bill and the checkout opens on the same tap, with
   * no summary screen in between. The summary card is only what is left
   * behind: a store with no gateway (ask for the bill instead), or a diner
   * who closed the checkout and wants to try again.
   */
  const preparePayment = async () => {
    setLoadingPayment(true);
    try {
      const { data } = await qrGetPaymentIntent(token, claimRef.current);
      setPaymentInfo(data.data);
      if (data.data?.checkout?.paymentSessionId) await payOnline(data.data.checkout);
      else await refetch();
    } catch (e) {
      if (e.response?.status === 409) return endSession(e.response?.data?.message);
      setErr(e.response?.data?.message || "Could not prepare payment.");
    } finally {
      setLoadingPayment(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-orange-500 rounded-full animate-spin" />
          <p className="text-sm font-medium">Loading menu…</p>
        </div>
      </div>
    );
  }

  // The claim this page held is spent: the table has been settled and whoever
  // is sitting there now has a session of their own. There is deliberately no
  // "continue" button -- the diner must scan the physical QR again, which is
  // the only thing that proves they are at the table.
  if (expired) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-2xl">
            ✓
          </div>
          <h1 className="text-lg font-bold text-slate-900 mb-1">This order has ended</h1>
          <p className="text-sm text-slate-600">
            {err || "This table's order has been settled. Please scan the QR code on your table to start a new order."}
          </p>
          <p className="text-xs text-slate-400 mt-4">
            Saved links stop working once a table is settled, so nobody else can see your order.
          </p>
        </div>
      </div>
    );
  }

  if (err && !table) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-red-50 text-red-500 flex items-center justify-center text-2xl">!</div>
          <h1 className="text-lg font-bold text-slate-900 mb-1">Couldn't open this table</h1>
          <p className="text-sm text-slate-600">{err}</p>
          <p className="text-xs text-slate-400 mt-4">Ask your server to reprint the QR code.</p>
        </div>
      </div>
    );
  }

  const brandName = restaurant?.name || "KnotKitchen";
  const brandLogo = String(restaurant?.branding?.logo || "").trim();
  const primary = restaurant?.branding?.primaryColor || "#FD5302";
  // What the restaurant calls this table ("GF1"), not its row number. The
  // diner sees the same name the staff use when they come over.
  const tableName =
    String(table?.displayId || table?.tableName || "").trim() ||
    (table?.tableNumber != null ? `Table ${table.tableNumber}` : "Your table");
  /**
   * Pay the table's bill through whichever gateway the store uses.
   *
   * The amount is never sent from here: the server opened the gateway order
   * against the session's own bill, and re-checks with the gateway before it
   * settles anything. This browser only says "checkout finished, please look".
   */
  const payOnline = async (opened) => {
    // Called with the checkout the server just opened, or (from the retry
    // button, which passes a click event) with the one already on screen.
    const checkout = opened?.paymentSessionId ? opened : paymentInfo?.checkout;
    if (!checkout) {
      setErr("Online payment is not available for this table right now.");
      return;
    }

    setPaying(true);
    setErr("");

    /** Ask the server what really happened, and reflect its answer. */
    const confirm = async (payload) => {
      try {
        await qrVerifyPayment(token, payload || {}, claimRef.current);
        setPaymentInfo(null);
        setBanner("Payment received. Thank you!");
        await refetch();
      } catch (e) {
        setErr(
          e.response?.data?.message ||
            "We could not confirm that payment. Please show this screen to a member of staff.",
        );
      }
    };

    try {
      const Cashfree = await loadCashfree();
      if (!Cashfree) {
        setErr("The payment page could not be loaded. Please check your connection.");
        return;
      }
      const cashfree = Cashfree({ mode: checkout.mode || "sandbox" });
      // Cashfree hands back nothing we would trust anyway, so whatever the
      // modal resolves with we just ask our own server to check the order.
      // That covers the case where the diner paid and then closed the modal
      // before it could report back.
      const result = await cashfree.checkout({
        paymentSessionId: checkout.paymentSessionId,
        redirectTarget: "_modal",
      });
      if (result?.error && !result?.paymentDetails) {
        // A genuine refusal from the gateway (declined card, cancelled).
        // Still worth a server check -- but say something if it comes back
        // unpaid, rather than leaving the diner staring at the bill.
        await confirm();
        return;
      }
      await confirm();
    } catch {
      setErr("Payment could not be completed.");
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      {/* ── Sticky brand header ─────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 text-white shadow-sm"
        style={{ background: `linear-gradient(135deg, ${primary} 0%, #021E49 130%)` }}
      >
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-3">
          {/* Logo, store name with the table under it, and Call Waiter.
              Asking for the bill lives with the order card's Pay step. */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {brandLogo ? (
                <img
                  src={brandLogo}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-full bg-white/15 object-cover"
                />
              ) : null}
              <div className="min-w-0">
                <h1 className="text-lg font-extrabold leading-tight truncate">{brandName}</h1>
                {table ? (
                  <p className="text-xs font-semibold text-white/80 truncate">{tableName}</p>
                ) : null}
              </div>
            </div>
            {table && (
              <button
                onClick={callWaiter}
                disabled={callingWaiter}
                className="shrink-0 text-[11px] font-semibold bg-white text-slate-900 rounded-full px-3 py-1.5 disabled:opacity-60"
              >
                🔔 {callingWaiter ? "Calling…" : "Call Waiter"}
              </button>
            )}
          </div>

          {paused ? (
            <p role="status" className="mt-3 rounded-xl bg-amber-100 px-3 py-2 text-[12.5px] font-semibold text-amber-900">
              {paused}
            </p>
          ) : null}

          {/* Search + tabs */}
          <div className="mt-3 relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search dishes…"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/95 text-slate-900 placeholder:text-slate-400 text-sm outline-none"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          </div>
        </div>

        {/* Category chips */}
        <nav className="max-w-3xl mx-auto px-4 pb-3 flex gap-2 overflow-x-auto no-scrollbar">
          <CatChip active={cat === "all"} onClick={() => setCat("all")}>All</CatChip>
          {cats.map((c) => (
            <CatChip key={c} active={cat === c} onClick={() => setCat(c)}>
              {c}
            </CatChip>
          ))}
        </nav>
      </header>

      {/* ── Transient info banner ───────────────────────────────────── */}
      {banner && (
        <div className="max-w-3xl mx-auto px-4 pt-3">
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium px-4 py-2.5">
            ✓ {banner}
          </div>
        </div>
      )}

      {/* ── Active session summary ──────────────────────────────────── */}
      {session && (
        <section className="max-w-3xl mx-auto px-4 pt-4">
          <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Your Table Order
                </p>
                {/* The kitchen's own status for this table. It used to be
                    invisible here: the page showed each item as "pending"
                    forever while the POS had long since marked the order
                    Ready. */}
                {session.orderStatus ? (
                  <span
                    className={`inline-block mt-1 mb-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 ${
                      ORDER_STATUS_STYLE[session.orderStatus] || "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {session.orderStatus}
                  </span>
                ) : null}
                {/* Guest count is no longer collected from the diner, so
                    showing "1 guest(s)" here would just be a wrong number. */}
                <p className="text-sm font-bold text-slate-900">
                  {sessionItemCount} item(s)
                  {session.customerName ? (
                    <span className="font-medium text-slate-500"> · {session.customerName}</span>
                  ) : null}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Total</p>
                <p className="text-lg font-extrabold text-slate-900">{money(sessionTotal)}</p>
              </div>
            </div>
            <ul className="divide-y divide-slate-100">
              {sessionItems.map((it) => (
                <li key={it._id} className="flex justify-between items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p
                      className={`font-semibold truncate ${
                        it.status === "cancelled" ? "text-slate-400 line-through" : "text-slate-800"
                      }`}
                    >
                      {it.name} <span className="text-slate-400 font-normal">× {it.quantity}</span>
                    </p>
                    <span
                      className={`inline-block mt-0.5 text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 ${
                        ITEM_STATUS_STYLE[it.status] || "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {it.status || "pending"}
                    </span>
                    {/* Why the kitchen pulled it, if they said. Without this
                        a dish just disappeared off the total with no
                        explanation. */}
                    {it.status === "cancelled" && it.cancelReason ? (
                      <span className="ml-1.5 text-[11px] text-red-600">{it.cancelReason}</span>
                    ) : null}
                  </div>
                  <span
                    className={`font-bold shrink-0 ${
                      it.status === "cancelled" ? "text-slate-400 line-through" : "text-slate-900"
                    }`}
                  >
                    {money(it.total)}
                  </span>
                </li>
              ))}
            </ul>
            {session.status === "BILL_REQUESTED" && (
              <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-100 text-amber-800 text-xs font-semibold flex items-center gap-1.5">
                🧾 Bill requested — your server will be with you shortly.
              </div>
            )}
            {/* Two things a diner can do once they have ordered: eat more, or
                settle up. "View Payment Summary" told them neither. */}
            <div className="p-3 space-y-2">
              {!paymentInfo ? (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() =>
                      menuRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                    className="text-sm py-2.5 rounded-xl font-semibold border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                  >
                    + Add more items
                  </button>
                  <button
                    onClick={preparePayment}
                    disabled={loadingPayment}
                    className="text-sm py-2.5 rounded-xl font-bold text-white disabled:opacity-50"
                    style={{ background: primary }}
                  >
                    {loadingPayment ? "Opening payment…" : "Pay"}
                  </button>
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm space-y-2">
                  <div className="flex justify-between font-semibold">
                    <span>Payable</span>
                    <span>{money(paymentInfo.amount)}</span>
                  </div>

                  {/* A QR order is paid through the gateway. Cash and UPI are
                      counter methods that only a member of staff can confirm,
                      so offering them to the diner as buttons let them mark
                      their own bill settled. They are not choices here. */}
                  {paymentInfo.onlinePaymentEnabled ? (
                    <>
                      <button
                        onClick={payOnline}
                        disabled={paying}
                        className="w-full text-sm py-2.5 rounded-xl font-bold text-white disabled:opacity-50"
                        style={{ background: primary }}
                      >
                        {paying ? "Opening payment…" : `Pay ${money(paymentInfo.amount)}`}
                      </button>
                      <p className="text-[11px] text-slate-400 text-center">
                        Secured by Cashfree · your table is settled
                        automatically once payment succeeds.
                      </p>
                    </>
                  ) : (
                    <>
                      {/* No gateway on this store: the diner cannot pay from
                          their phone at all, so the honest action is to ask
                          for the bill rather than to offer a payment method
                          they cannot complete. */}
                      <button
                        onClick={requestBill}
                        className="w-full text-sm py-2.5 rounded-xl font-bold text-white"
                        style={{ background: primary }}
                      >
                        Ask for the bill
                      </button>
                      <p className="text-[11px] text-slate-400 text-center">
                        This store takes payment at the counter.
                      </p>
                    </>
                  )}

                  <button
                    onClick={() => {
                      setPaymentInfo(null);
                      menuRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className="w-full text-[12px] text-slate-500 font-semibold py-1"
                  >
                    Actually, add more items
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Menu grid ───────────────────────────────────────────────── */}
      <main
        ref={menuRef}
        className="max-w-3xl mx-auto px-4 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {filtered.length === 0 ? (
          <div className="col-span-full text-center text-slate-400 py-16">
            <p className="text-sm font-semibold">No dishes match your search.</p>
          </div>
        ) : (
          filtered.map((item) => {
            const qty = qtyOfItem(item._id);
            const itemHasOptions = hasOptions(item);
            return (
              <article
                key={item._id}
                className="bg-white border border-slate-200 rounded-2xl p-3 flex gap-3 shadow-sm hover:shadow-md transition-shadow"
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="w-20 h-20 rounded-xl object-cover shrink-0 bg-slate-100"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-slate-100 shrink-0 flex items-center justify-center text-2xl text-slate-400">
                    🍽️
                  </div>
                )}
                <div className="min-w-0 flex-1 flex flex-col">
                  <h3 className="font-bold text-slate-900 text-sm leading-snug line-clamp-2">
                    {item.name}
                  </h3>
                  {item.description && (
                    <p className="text-[11.5px] text-slate-500 mt-0.5 line-clamp-2">
                      {item.description}
                    </p>
                  )}
                  <div className="mt-auto pt-1.5 flex justify-between items-center">
                    <span className="font-extrabold text-slate-900 text-sm">{money(item.price)}</span>
                    {qty > 0 && !itemHasOptions ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => sub(String(item._id))}
                          className="w-7 h-7 rounded-full bg-slate-100 text-slate-700 font-bold"
                          aria-label={`Remove one ${item.name}`}
                        >
                          −
                        </button>
                        <span className="min-w-[16px] text-center font-bold text-slate-900 text-sm">
                          {qty}
                        </span>
                        <button
                          onClick={() => add(item)}
                          className="w-7 h-7 rounded-full text-white font-bold"
                          style={{ background: primary }}
                          aria-label={`Add one more ${item.name}`}
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => add(item)}
                        className="text-[12px] font-bold text-white rounded-full px-3 py-1"
                        style={{ background: primary }}
                      >
                        {itemHasOptions ? (qty > 0 ? `Add more · ${qty}` : "Choose") : "+ Add"}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </main>

      {/* ── Sticky cart pill (opens the bottom sheet) ───────────────── */}
      {cartCount > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full px-5 py-3 shadow-2xl text-white font-bold"
          style={{ background: primary }}
        >
          <span className="bg-white/25 rounded-full px-2 py-0.5 text-xs">{cartCount}</span>
          <span>Review & Send · {money(cartTotal)}</span>
        </button>
      )}

      {/* ── Bottom-sheet cart ───────────────────────────────────────── */}
      {cartOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setCartOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-wider font-bold text-slate-500">
                  Your order · {tableName}
                </p>
                <h2 className="text-lg font-extrabold text-slate-900">{cartCount} item(s) · {money(cartTotal)}</h2>
              </div>
              <button
                onClick={() => setCartOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 font-bold"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100 px-5">
              {cartList.map((line) => {
                const { key, item, qty, variant, modifiers, unitPrice } = line;
                // Spell the chosen options out, so the customer can tell two
                // lines of the same product apart before they pay for them.
                const chosen = [
                  variant?.name,
                  ...(modifiers || []).map((m) => m.optionName).filter(Boolean),
                ].filter(Boolean);
                return (
                  <li key={key} className="py-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-slate-900 truncate">{item.name}</p>
                      {chosen.length > 0 && (
                        <p className="text-[11px] text-slate-500 truncate">{chosen.join(" · ")}</p>
                      )}
                      <p className="text-[11px] text-slate-500">{money(unitPrice)} each</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => sub(key)}
                        className="w-7 h-7 rounded-full bg-slate-100 text-slate-700 font-bold"
                        aria-label={`Remove one ${item.name}`}
                      >
                        −
                      </button>
                      <span className="min-w-[18px] text-center font-bold text-sm">{qty}</span>
                      <button
                        onClick={() =>
                          addLine({ item, qty: 1, variant, modifiers, unitPrice })
                        }
                        className="w-7 h-7 rounded-full text-white font-bold"
                        style={{ background: primary }}
                        aria-label={`Add one more ${item.name}`}
                      >
                        +
                      </button>
                    </div>
                    <span className="font-bold text-sm w-16 text-right">{money(unitPrice * qty)}</span>
                  </li>
                );
              })}
            </ul>

            <div className="p-5 pt-3 border-t border-slate-100 space-y-3">
              {/* Asked once, on the scan that OPENS the table. A later scan
                  joins the running session and goes straight to ordering. */}
              {session ? (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-slate-400 text-sm">🪑</span>
                  <p className="text-[12.5px] text-slate-600">
                    Adding to the open order on{" "}
                    <span className="font-bold text-slate-800">
                      {tableName}
                    </span>
                    {session.customerName ? (
                      <span className="text-slate-500"> · {session.customerName}</span>
                    ) : null}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[12.5px] font-semibold text-slate-700">
                    Your details
                    <span className="font-normal text-slate-400">
                      {" "}· asked once, when you open the table
                    </span>
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      placeholder="Name"
                      autoComplete="name"
                      value={cust.name}
                      onChange={(e) => setCust({ ...cust, name: e.target.value })}
                      className="px-3 py-2.5 rounded-xl bg-slate-100 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-slate-200"
                    />
                    <input
                      placeholder="Phone"
                      inputMode="numeric"
                      autoComplete="tel"
                      maxLength={10}
                      value={cust.phone}
                      onChange={(e) =>
                        setCust({ ...cust, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })
                      }
                      className="px-3 py-2.5 rounded-xl bg-slate-100 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-slate-200"
                    />
                  </div>
                </div>
              )}
              {err && (
                <p className="text-red-600 text-xs font-semibold">{err}</p>
              )}
              <button
                onClick={checkout}
                disabled={placing || Boolean(paused)}
                className="w-full py-3 rounded-2xl font-extrabold text-white text-sm disabled:opacity-60"
                style={{ background: primary }}
              >
                {paused
                  ? "Ordering is paused"
                  : placing
                  ? "Sending…"
                  : session
                    ? `Add to ${tableName} · ${money(cartTotal)}`
                    : `Send to Kitchen · ${money(cartTotal)}`}
              </button>
              <p className="text-[11px] text-center text-slate-400">
                Your order goes to the kitchen instantly. Pay at the counter when you're done.
              </p>
            </div>
          </div>
        </div>
      )}

      {optionsItem && (
        <ProductOptionsSheet
          item={optionsItem}
          currency={currency}
          primary={primary}
          onClose={() => setOptionsItem(null)}
          onAdd={(line) => {
            addLine(line);
            setOptionsItem(null);
          }}
        />
      )}

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { scrollbar-width: none; }
      `}</style>
    </div>
  );
}

const CatChip = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`whitespace-nowrap px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition ${
      active ? "bg-white text-slate-900" : "bg-white/20 text-white hover:bg-white/30"
    }`}
  >
    {children}
  </button>
);
