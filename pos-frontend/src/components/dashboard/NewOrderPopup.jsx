import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { enqueueSnackbar } from "notistack";
import { listAwaitingOrders, updateOnlineOrderStatus } from "../../https/storefrontApi";
import { AWAITING_ACCEPTANCE, PREPARING } from "../../constants/orderStatus";
import useAlertBeep from "../../hooks/useAlertBeep";
import { tableLabel as labelForTable } from "../../utils/orderLabels";
import { acquireSocket, releaseSocket } from "../../socket";
import { timeIN } from "../../utils";


/**
 * "New order" — one popup for every channel a customer orders through.
 *
 * There used to be a popup for QR table orders and nothing at all for website
 * orders: the backend emitted `onlineOrder:created` for both, but the only
 * listener filtered on `source === "QR"` and dropped everything else on the
 * floor. A website order reached the till silently, and was seen whenever
 * somebody next reloaded the Orders page.
 *
 * This replaces that listener and accepts every customer-placed source. POS
 * orders are deliberately NOT included: a member of staff typed those in, and
 * alerting them about their own keystrokes is noise.
 *
 * It floats rather than covering the screen. A modal backdrop stops the till
 * working while a customer is standing at the counter, so the card can be
 * dragged out of the way by its header and left there — the alert keeps
 * sounding until somebody accepts or cancels, which is the part that must not
 * be dismissable by accident.
 *
 * Every till at the counter must ring, and one decision must silence them
 * all. The card used to exist only as a live socket event: a phone whose
 * screen was off, or whose browser had been switched away from, had no
 * socket at that moment and simply never saw the order, while the computer
 * next to it did. So on every (re)connect, and whenever the page comes back
 * into view, the till asks for the orders still awaiting a decision; and a
 * status change from any till drops the card on the others.
 */

/** Still nobody's decision: a website order starts Pending, a QR order Preparing. */
const UNDECIDED = new Set([AWAITING_ACCEPTANCE, PREPARING]);

/** Channels a CUSTOMER ordered through. POS is staff typing, and never alerts. */
const ALERTING_SOURCES = new Set(["QR", "WEBSITE"]);

const SOURCE_LABEL = {
  QR: "New Table Order · Scanned QR",
  WEBSITE: "New Website Order",
};

const NewOrderPopup = () => {
  const navigate = useNavigate();
  const restaurantId = useSelector((s) => s.user?.restaurantId);
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);

  // Drag offset from the centred resting position, in pixels. Kept for the
  // whole session so a till that shoved the card aside once is not fighting
  // it back across the screen on every order.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  useAlertBeep(queue.length > 0);

  useEffect(() => {
    if (!restaurantId) return undefined;

    const socket = acquireSocket(restaurantId);

    // A retried emit, or a catch-up that overlaps a live event, must not
    // stack two cards for one order.
    const add = (payload) =>
      setQueue((prev) => {
        const id = String(payload?.orderId || "");
        if (id && prev.some((p) => String(p.orderId) === id)) return prev;
        return [...prev, payload];
      });

    const catchUp = async () => {
      try {
        const { data } = await listAwaitingOrders();
        (data?.data || [])
          .filter((o) => ALERTING_SOURCES.has(String(o?.source || "").toUpperCase()))
          .forEach(add);
      } catch {
        /* the live event still works without this */
      }
    };

    const join = () => catchUp();
    // A phone's browser pauses in the background and may keep a socket that
    // missed events; re-check when it is looked at again.
    const onVisible = () => {
      if (document.visibilityState === "visible") catchUp();
    };

    const onCreated = (payload) => {
      const source = String(payload?.source || "").toUpperCase();
      if (!ALERTING_SOURCES.has(source)) return;
      add(payload);
      try {
        enqueueSnackbar(
          source === "WEBSITE" ? "New website order" : "New table order",
          { variant: "info" },
        );
      } catch {
        /* a failed toast must not break the alert */
      }
    };

    // Decided on another till (or by the diner cancelling): stop ringing here.
    const onStatus = (payload) => {
      if (UNDECIDED.has(payload?.orderStatus)) return;
      const id = String(payload?.orderId || "");
      if (id) setQueue((prev) => prev.filter((p) => String(p.orderId) !== id));
    };

    socket.on("connect", join);
    socket.on("onlineOrder:created", onCreated);
    socket.on("onlineOrder:status", onStatus);
    if (socket.connected) join();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      socket.off("connect", join);
      socket.off("onlineOrder:created", onCreated);
      socket.off("onlineOrder:status", onStatus);
      document.removeEventListener("visibilitychange", onVisible);
      releaseSocket();
    };
  }, [restaurantId]);

  // Dragging by the header. Pointer events rather than mouse events so this
  // works on the touchscreen tills, and pointer capture so the card keeps
  // following a finger that slides outside it.
  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, from: offset };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset({
      x: d.from.x + (e.clientX - d.startX),
      y: d.from.y + (e.clientY - d.startY),
    });
  };

  const endDrag = (e) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  if (queue.length === 0) return null;
  const current = queue[0];
  const drop = () => setQueue((prev) => prev.slice(1));

  const decide = async (action) => {
    // emitOrderCreated sends `orderId`. Reading `_id` here found nothing and
    // silently dismissed the card without touching the order.
    const orderId = current?.orderId || current?._id || current?.id;
    if (!orderId) {
      drop();
      return;
    }
    setBusy(true);
    try {
      await updateOnlineOrderStatus(orderId, action);
      enqueueSnackbar(action === "accept" ? "Order accepted." : "Order cancelled.", {
        variant: action === "accept" ? "success" : "info",
      });
      drop();
    } catch (e) {
      enqueueSnackbar(e?.response?.data?.message || "Could not update the order.", {
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const source = String(current.source || "").toUpperCase();
  const isWebsite = source === "WEBSITE";
  const heading = SOURCE_LABEL[source] || "New Order";

  const where = isWebsite
    ? current.orderType === "delivery"
      ? "Delivery"
      : current.orderType === "collection"
        ? "Collection"
        : "Website"
    : labelForTable(current.table, null) ||
      (current.tableNumber != null ? `Table ${current.tableNumber}` : "Table —");

  const items = Array.isArray(current.items) ? current.items : [];
  const total = Number(current.bills?.totalWithTax || current.bills?.total || 0);
  const customer = current.customerDetails || current.customer || {};

  return (
    <div
      className="fixed left-1/2 top-1/2 z-[70] w-[min(92vw,28rem)]"
      style={{ transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)` }}
      role="dialog"
      aria-label={heading}
    >
      <div className="rounded-2xl bg-white shadow-2xl overflow-hidden border border-[#E2E8F0] ring-4 ring-black/5">
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={`px-5 py-4 text-white flex items-center justify-between cursor-grab active:cursor-grabbing touch-none select-none ${
            isWebsite
              ? "bg-gradient-to-r from-[#2563EB] to-[#1E40AF]"
              : "bg-gradient-to-r from-[#FD5302] to-[#C2410C]"
          }`}
        >
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/80 truncate">
              {heading}
            </p>
            <h2 className="text-[20px] font-extrabold mt-0.5 leading-tight truncate">{where}</h2>
          </div>
          <span className="shrink-0 text-white/60 text-[11px] font-bold uppercase">Drag</span>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-[#94A3B8] uppercase tracking-wide">Customer</p>
              <p className="text-[15px] font-extrabold text-[#0F172A] truncate">
                {customer.name || "Guest"}
              </p>
              {customer.phone && (
                <p className="text-[12px] text-[#64748B] truncate">{customer.phone}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-[11px] font-bold text-[#94A3B8] uppercase tracking-wide">Total</p>
              <p className="text-[22px] font-extrabold text-[#C2410C]">
                ₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {isWebsite ? (
            <div className="rounded-xl border border-[#FED7AA] bg-[#FFF7ED] px-3 py-2 text-[13px] font-bold text-[#9A3412] flex items-center justify-between gap-2">
              <span>
                {String(current.orderType || "").toLowerCase() === "delivery"
                  ? "Delivery"
                  : current.scheduledFor
                  ? `Pickup at ${timeIN(current.scheduledFor)}`
                  : "Pickup now"}
              </span>
              {current.paymentStatus === "paid" || current.payments?.[0]?.status === "paid" ? (
                <span className="text-[11px] font-bold text-[#15803D]">Paid online</span>
              ) : null}
            </div>
          ) : null}

          <div className="max-h-[220px] overflow-y-auto rounded-xl border border-[#E2E8F0] divide-y divide-[#E2E8F0]">
            {items.length === 0 ? (
              <div className="px-3 py-4 text-[12.5px] text-[#94A3B8] text-center">No line items.</div>
            ) : (
              items.map((it, i) => (
                <div key={i} className="px-3 py-2 flex items-start justify-between gap-3 text-[13px]">
                  <div className="min-w-0">
                    <p className="font-bold text-[#0F172A] truncate">
                      {it.quantity || 1}× {it.name || "Item"}
                    </p>
                    {Array.isArray(it.modifiers) && it.modifiers.length > 0 && (
                      <p className="text-[11.5px] text-[#64748B] truncate">
                        + {it.modifiers.map((m) => m.name).filter(Boolean).join(", ")}
                      </p>
                    )}
                    {it.note && (
                      <p className="text-[11px] text-[#C2410C] font-semibold truncate">Note: {it.note}</p>
                    )}
                  </div>
                  <span className="shrink-0 font-extrabold text-[#0F172A]">
                    ₹{Number((it.total ?? it.price * (it.quantity || 1)) || 0).toFixed(2)}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => decide("cancel")}
              disabled={busy}
              className="h-[44px] rounded-xl border border-[#FECACA] bg-[#FEF2F2] text-[#DC2626] text-[13.5px] font-bold hover:bg-[#FEE2E2] disabled:opacity-60"
            >
              Cancel Order
            </button>
            <button
              type="button"
              onClick={() => decide("accept")}
              disabled={busy}
              className="h-[44px] rounded-xl bg-[#22C55E] text-white text-[13.5px] font-extrabold hover:bg-[#16A34A] disabled:opacity-60"
            >
              {busy ? "Working…" : "Accept Order"}
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              drop();
              navigate("/orders");
            }}
            className="w-full text-[12.5px] font-bold text-[#64748B] hover:text-[#0F172A]"
          >
            View in Orders
          </button>

          {queue.length > 1 && (
            <p className="text-[11px] font-bold text-[#94A3B8] text-center">
              {queue.length - 1} more order(s) waiting…
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default NewOrderPopup;
