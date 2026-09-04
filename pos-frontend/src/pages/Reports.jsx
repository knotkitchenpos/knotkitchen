import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { getOrdersReport } from "../https";
import { getMyRestaurant } from "../https/newModules";
import { getWebsiteSettings } from "../https/storefrontApi";
import { printHtmlDocument } from "../utils/printDocument";
import { isPreparing, isReady, isCancelled, statusLabel } from "../constants/orderStatus";

/**
 * Module 5 — Reports.
 *
 * Everything on this page comes from REAL orders in the database via
 * /api/order/report. No fake / seeded numbers.
 *
 * State model:
 *  - `mode` is either "single" (one calendar day) or "range" (from → to).
 *    Even "Today" is really `mode = single` with today's date, so all the
 *    filtering / labelling code has only two branches to reason about.
 *  - `apiParams` is what actually goes to the backend. When the user
 *    picks a date via a quick-select or the calendar we update `apiParams`
 *    immediately so react-query refetches. This keeps the URL / server
 *    payload as the single source of truth for "which period am I viewing".
 *  - Default on every mount is TODAY (Module 5 §4) — no persistence.
 */

/* ---------- Small helpers ---------- */

const money = (n) => `₹${Number(n || 0).toFixed(2)}`;

/** LOCAL-timezone YYYY-MM-DD. `.toISOString()` would drift for non-UTC tz. */
const localDay = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const fmtTime = (d) =>
  new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

/** e.g. "17 November, Monday" — matches the Module 5 §3 example format. */
const fmtQuickDate = (d) => {
  const day = d.getDate();
  const month = d.toLocaleDateString("en-GB", { month: "long" });
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  return { day, month, weekday };
};

const orderTypeLabel = (t) => {
  const k = String(t || "").toLowerCase();
  if (k === "delivery") return "Delivery";
  if (k === "dine-in") return "Table";
  if (k === "collection" || k === "takeaway") return "Collection";
  return t || "Other";
};

const sourceLabel = (src) => {
  const s = String(src || "").toUpperCase();
  if (s === "POS") return "System";
  if (s === "WEBSITE") return "Website";
  if (!s) return "Outside";
  // MARKETPLACE / QR / PHONE all fall into "Outside" per the spec.
  return "Outside";
};

/**
 * Build a horizontal strip of dates centred on the currently-viewed day
 * (or the range end, so the user always has some context to scroll from).
 * We render 14 days back through 3 days ahead — enough to cover a normal
 * fortnight review without an infinite scroller.
 */
/**
 * Build a horizontal strip of dates ending on Today (or the active date if
 * earlier, capped at Today). The user explicitly requested that Today / current
 * date MUST be the LAST (rightmost) item in the strip — no future dates.
 */
const buildQuickDates = (anchor) => {
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);

  const anchorDay = anchor ? new Date(anchor) : new Date(todayDate);
  anchorDay.setHours(0, 0, 0, 0);

  const endDay = anchorDay > todayDate ? new Date(todayDate) : new Date(anchorDay);

  const days = [];
  // Render 14 days back through 0 (where offset 0 = endDay = Today)
  for (let offset = -14; offset <= 0; offset += 1) {
    const d = new Date(endDay);
    d.setDate(d.getDate() + offset);
    days.push(d);
  }
  return days;
};

/* ---------- Calendar modal ---------- */

/**
 * Very small dependency-free calendar. Written inline so we don't pull
 * a big date picker into the bundle for a single screen. Supports
 * single-day and inclusive range selection.
 */
const CalendarModal = ({ initialMode, initialFrom, initialTo, onClose, onProceed }) => {
  const [mode, setMode] = useState(initialMode);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  // Which month is displayed in the grid. Independent of the selection so
  // the user can scroll to April without losing a February pick.
  const [cursor, setCursor] = useState(() => {
    const seed = new Date(initialFrom);
    seed.setDate(1);
    return seed;
  });

  const monthLabel = cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const shiftMonth = (delta) => {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + delta);
    setCursor(next);
  };

  // Grid cells for the visible month, padded so the first row lines up
  // with the weekday header (Mon–Sun).
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const dayOfWeek = (first.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const out = [];
    for (let i = 0; i < dayOfWeek; i += 1) out.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) {
      out.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor]);

  const isSelected = (d) => {
    if (!d) return false;
    const s = localDay(d);
    if (mode === "single") return s === from;
    if (!from || !to) return s === from;
    return s >= from && s <= to;
  };

  const onCellClick = (d) => {
    if (!d) return;
    const s = localDay(d);
    if (mode === "single") {
      setFrom(s);
      setTo(s);
      return;
    }
    // range: first click sets from + clears to; second click sets to.
    if (!from || (from && to && from !== to)) {
      setFrom(s);
      setTo(s);
      return;
    }
    if (s < from) {
      setTo(from);
      setFrom(s);
    } else {
      setTo(s);
    }
  };

  const proceed = () => {
    if (mode === "single") onProceed({ mode: "single", date: from });
    else onProceed({ mode: "range", from, to });
  };

  return (
    <div className="fixed inset-0 z-[95] bg-black/45 flex items-center justify-center p-4">
      <div className="w-full max-w-[420px] bg-white rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <h3 className="text-[16px] font-extrabold text-[#0F172A]">Select Date</h3>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg text-[20px] leading-none text-[#94A3B8] hover:bg-[#FEF2F2] hover:text-[#DC2626]"
            aria-label="Close date picker"
          >×</button>
        </div>

        <div className="px-5 py-3 flex items-center gap-2">
          {[
            { key: "single", label: "Single Day" },
            { key: "range", label: "Date Range" },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                setMode(opt.key);
                if (opt.key === "single") setTo(from);
              }}
              className={`h-[34px] px-3 rounded-lg text-[12.5px] font-bold border ${
                mode === opt.key
                  ? "bg-[#FD5302] text-white border-[#FD5302]"
                  : "bg-white text-[#475569] border-[#E2E8F0] hover:border-[#CBD5E1]"
              }`}
            >{opt.label}</button>
          ))}
        </div>

        <div className="px-5 pb-2 flex items-center justify-between">
          <button
            onClick={() => shiftMonth(-1)}
            className="w-8 h-8 rounded-lg border border-[#E2E8F0] text-[#475569] hover:border-[#FD5302] hover:text-[#C2410C]"
            aria-label="Previous month"
          >‹</button>
          <span className="text-[13.5px] font-extrabold text-[#0F172A]">{monthLabel}</span>
          <button
            onClick={() => shiftMonth(1)}
            className="w-8 h-8 rounded-lg border border-[#E2E8F0] text-[#475569] hover:border-[#FD5302] hover:text-[#C2410C]"
            aria-label="Next month"
          >›</button>
        </div>

        <div className="px-5 pb-2 grid grid-cols-7 gap-1 text-center text-[10.5px] font-bold text-[#94A3B8]">
          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>

        <div className="px-5 pb-4 grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            const s = d ? localDay(d) : null;
            const on = isSelected(d);
            const isRangeEndpoint = mode === "range" && (s === from || s === to);
            const isTodayCell = s === localDay();
            return (
              <button
                key={i}
                onClick={() => onCellClick(d)}
                disabled={!d}
                className={`h-9 rounded-lg text-[13px] font-bold flex flex-col items-center justify-center relative transition-colors ${
                  !d
                    ? "opacity-0"
                    : on
                    ? isRangeEndpoint
                      ? "bg-[#FD5302] text-white"
                      : "bg-[#FFF1E8] text-[#C2410C]"
                    : isTodayCell
                    ? "border-2 border-[#FD5302] text-[#C2410C] bg-[#FFF6F0] font-extrabold"
                    : "text-[#334155] hover:bg-[#F8FAFC]"
                }`}
              >
                <span>{d?.getDate() || ""}</span>
                {isTodayCell && (
                  <span className={`w-1 h-1 rounded-full mt-0.5 ${on && isRangeEndpoint ? "bg-white" : "bg-[#FD5302]"}`} />
                )}
              </button>
            );
          })}
        </div>

        <div className="px-5 pb-4 text-[12px] text-[#64748B]">
          {mode === "single"
            ? `Report will be generated for ${fmtDate(from)}.`
            : `Report will be generated from ${fmtDate(from)} to ${fmtDate(to)}.`}
        </div>

        <div className="px-5 pb-5 grid grid-cols-2 gap-2.5">
          <button
            onClick={onClose}
            className="h-[44px] rounded-xl border border-[#E2E8F0] text-[#334155] text-[13.5px] font-bold hover:bg-[#F8FAFC]"
          >Cancel</button>
          <button
            onClick={proceed}
            className="h-[44px] rounded-xl bg-[#FD5302] text-white text-[13.5px] font-bold hover:bg-[#D64502]"
          >Proceed</button>
        </div>
      </div>
    </div>
  );
};

/* ---------- Order details modal (Module 5 §7) ---------- */

const DetailRow = ({ label, value }) => (
  <div>
    <p className="text-[11.5px] font-bold text-[#94A3B8]">{label}</p>
    <p className="text-[13px] font-bold text-[#0F172A] mt-0.5 break-words">{value ?? "—"}</p>
  </div>
);

const OrderDetailsModal = ({ order, onClose }) => {
  if (!order) return null;
  const payment = order.payments?.[0];
  const address =
    order.customerDetails?.address ||
    order.deliveryAddress?.line1 ||
    "";
  const city =
    order.customerDetails?.city ||
    order.deliveryAddress?.city ||
    "";
  const pin =
    order.customerDetails?.pinCode ||
    order.deliveryAddress?.postalCode ||
    "";

  return (
    <div className="fixed inset-0 z-[95] bg-black/45 flex items-center justify-center p-4">
      <div className="w-full max-w-[560px] max-h-[85vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <div>
            <h3 className="text-[16px] font-extrabold text-[#0F172A]">
              Order #{order.orderNumber || order._id.slice(-6).toUpperCase()}
            </h3>
            <p className="text-[11.5px] text-[#94A3B8] mt-0.5">
              {fmtDate(order.createdAt)} · {fmtTime(order.createdAt)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg text-[20px] leading-none text-[#94A3B8] hover:bg-[#FEF2F2] hover:text-[#DC2626]"
            aria-label="Close details"
          >×</button>
        </div>

        <div className="px-5 py-4 grid grid-cols-2 gap-4">
          <DetailRow label="Customer" value={order.customerDetails?.name || "Walk-in customer"} />
          <DetailRow label="Phone" value={order.customerDetails?.phone || "—"} />
          <div className="col-span-2">
            <DetailRow
              label="Address"
              value={[address, city, pin].filter(Boolean).join(", ") || "—"}
            />
          </div>
        </div>

        <div className="px-5 pb-4">
          <p className="text-[12.5px] font-extrabold text-[#0F172A] mb-2">Items</p>
          <div className="space-y-2">
            {(order.items || []).map((it, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-[#0F172A] truncate">
                    {it.name}
                    {it.variant?.name ? ` (${it.variant.name})` : ""}
                  </p>
                  {Array.isArray(it.addons) && it.addons.length > 0 && (
                    <p className="text-[11px] text-[#64748B] truncate">
                      + {it.addons.map((a) => a.name).join(", ")}
                    </p>
                  )}
                  {Array.isArray(it.modifierSelections) && it.modifierSelections.length > 0 && (
                    <p className="text-[11px] text-[#64748B] truncate">
                      {it.modifierSelections.map((m) => m.optionName).join(", ")}
                    </p>
                  )}
                </div>
                <span className="text-[12px] font-bold text-[#334155] shrink-0">x {it.quantity}</span>
                <span className="text-[12.5px] font-extrabold text-[#0F172A] w-[68px] text-right shrink-0">
                  {money(it.total || it.price * it.quantity)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 pb-4 border-t border-[#E2E8F0] pt-3">
          <p className="text-[12.5px] font-extrabold text-[#0F172A] mb-2">Summary</p>
          <div className="space-y-1.5 text-[12.5px]">
            <div className="flex justify-between"><span className="text-[#475569]">Subtotal</span><span className="font-bold">{money(order.bills?.subtotal || order.bills?.total)}</span></div>
            <div className="flex justify-between"><span className="text-[#475569]">Discount</span><span className="font-bold text-[#16A34A]">− {money(order.bills?.discount)}</span></div>
            <div className="flex justify-between"><span className="text-[#475569]">GST</span><span className="font-bold">{money(order.bills?.tax)}</span></div>
            <div className="flex justify-between"><span className="text-[#475569]">Packing charge</span><span className="font-bold">{money(order.bills?.packagingFee)}</span></div>
            <div className="flex justify-between"><span className="text-[#475569]">Delivery charge</span><span className="font-bold">{money(order.bills?.deliveryFee)}</span></div>
            <div className="flex justify-between pt-2 mt-1 border-t border-[#E2E8F0]">
              <span className="text-[14px] font-extrabold text-[#0F172A]">Total</span>
              <span className="text-[15px] font-extrabold text-[#C2410C]">
                {money(order.bills?.totalWithTax || order.bills?.total)}
              </span>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 grid grid-cols-2 gap-3 border-t border-[#E2E8F0] pt-3">
          <DetailRow label="Source" value={sourceLabel(order.source)} />
          <DetailRow label="Order Type" value={orderTypeLabel(order.orderType)} />
          <DetailRow label="Payment Method" value={(order.paymentMethod || payment?.method || "Cash").toString()} />
          <DetailRow label="Payment Status" value={(payment?.status || "pending").toString()} />
          <DetailRow label="Payment ID" value={payment?.transactionId || order.paymentData?.razorpay_payment_id || "—"} />
          <DetailRow label="Status" value={statusLabel(order.orderStatus)} />
        </div>
      </div>
    </div>
  );
};

/* ---------- Printed report renderer (Module 5 §8) ---------- */

const buildPrintHtml = ({ header, summary, orders, windowLabel }) => {
  const row = (label, value) => `
    <tr>
      <td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;font-weight:600;">${label}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;text-align:right;font-weight:700;">${value}</td>
    </tr>`;
  const bkt = (b) => `${b?.count || 0} · ${money(b?.amount)}`;

  const orderRows = (orders || []).map((o) => `
    <tr>
      <td style="padding:4px 8px;border-bottom:1px solid #F1F5F9;">#${o.orderNumber || o._id.slice(-6).toUpperCase()}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #F1F5F9;">${fmtTime(o.createdAt)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #F1F5F9;">${orderTypeLabel(o.orderType)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #F1F5F9;">${sourceLabel(o.source)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #F1F5F9;text-align:right;">${money(o.bills?.totalWithTax || o.bills?.total)}</td>
    </tr>`).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Report — ${header.name}</title>
<style>
  body { font-family: Arial, sans-serif; color:#0F172A; margin:24px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .muted { color:#64748B; font-size:12px; }
  .section { margin-top:20px; }
  .section h2 { font-size:14px; margin:0 0 8px; border-bottom:2px solid #0F172A; padding-bottom:4px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  .kv td { font-size:12.5px; }
  .list th { text-align:left; padding:4px 8px; background:#F8FAFC; border-bottom:1px solid #E2E8F0; font-size:11.5px; }
  .list td:last-child { text-align:right; }
</style></head>
<body>
  <div>
    <h1>${header.name || "Restaurant"}</h1>
    <div class="muted">${header.address || ""}</div>
    <div class="muted" style="margin-top:6px;"><strong>Period:</strong> ${windowLabel}</div>
    <div class="muted">Generated: ${new Date().toLocaleString("en-GB")}</div>
  </div>

  <div class="section">
    <h2>Summary</h2>
    <table class="kv">
      ${row("All Orders", `${summary.total.count} · ${money(summary.total.amount)}`)}
      ${row("System Orders", bkt(summary.system))}
      ${row("Website Orders", bkt(summary.website))}
      ${row("Outside Orders", bkt(summary.outside))}
      ${row("Paid Orders", bkt(summary.paid))}
      ${row("Unpaid / Cash Orders", bkt(summary.unpaidCash))}
      ${row("Waiting / Preparing Orders", bkt(summary.preparing))}
      ${row("Collection Orders", bkt(summary.collection))}
      ${row("Delivery Orders", bkt(summary.delivery))}
      ${row("Table Orders", bkt(summary.table))}
      ${row("Cash Orders", bkt(summary.cash))}
      ${row("Pay by Link Orders", bkt(summary.payByLink))}
    </table>
  </div>

  <div class="section">
    <h2>Orders (${(orders || []).length})</h2>
    <table class="list">
      <thead><tr><th>ID</th><th>Time</th><th>Type</th><th>Source</th><th>Amount</th></tr></thead>
      <tbody>${orderRows || `<tr><td colspan="5" style="padding:8px;text-align:center;color:#94A3B8;">No orders in this period.</td></tr>`}</tbody>
    </table>
  </div>
</body></html>`;
};

/* ---------- Summary card ---------- */

const SummaryCard = ({ label, count, amount, tint }) => (
  <div className="bg-white border border-[#E2E8F0] rounded-xl px-4 py-3">
    <p className="text-[11.5px] font-bold text-[#94A3B8] uppercase tracking-wide">{label}</p>
    <div className="flex items-baseline gap-2 mt-1">
      <span className="text-[22px] font-extrabold" style={{ color: tint || "#0F172A" }}>
        {count ?? 0}
      </span>
      <span className="text-[12.5px] font-bold text-[#64748B]">orders</span>
    </div>
    <p className="text-[13.5px] font-extrabold text-[#334155] mt-0.5">{money(amount)}</p>
  </div>
);

/* ================================================================
 *  Main Reports component
 * ================================================================ */

const Reports = () => {
  useEffect(() => {
    document.title = "KnotKitchen | Reports";
  }, []);

  // --- Filter state (defaults to TODAY every mount — Module 5 §4) ---
  const today = localDay();
  const [mode, setMode] = useState("single"); // "single" | "range"
  const [selectedDate, setSelectedDate] = useState(today);
  const [rangeFrom, setRangeFrom] = useState(today);
  const [rangeTo, setRangeTo] = useState(today);
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  // Params sent to /api/order/report.
  const apiParams = useMemo(() => {
    if (mode === "range") return { from: rangeFrom, to: rangeTo };
    // Sending date=YYYY-MM-DD keeps the server the authority — the
    // frontend never has to compute midnight boundaries.
    return { date: selectedDate };
  }, [mode, selectedDate, rangeFrom, rangeTo]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["orders-report", apiParams],
    queryFn: () => getOrdersReport(apiParams),
    refetchOnWindowFocus: true,
  });

  const summary = data?.data?.data?.summary;
  const orders = data?.data?.data?.orders || [];
  const responseWindow = data?.data?.data?.window;

  // Restaurant name + address are already used by other screens (Invoice,
  // OrderPanel, ...) so we reuse the same authenticated endpoints instead
  // of inventing new ones — keeps the printed header consistent with the
  // POS receipts.
  const { data: restaurantRes } = useQuery({
    queryKey: ["restaurant", "me"],
    queryFn: getMyRestaurant,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const { data: websiteRes } = useQuery({
    queryKey: ["website", "settings"],
    queryFn: getWebsiteSettings,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const restaurant = restaurantRes?.data?.data;
  const websiteSettings = websiteRes?.data?.data?.settings;
  /*
   * Report header MUST show the RESTAURANT/STORE name — never the
   * logged-in user's name. Previously this fell through to `user.name`
   * which surfaced staff/owner names ("raja") in place of the store
   * name on both the on-screen report AND the printed report (see
   * BUG 3 & BUG 6 in the QA report). `restaurant?.name` is
   * authoritative and tenant-scoped by /api/restaurant/me.
   */
  const restaurantName =
    restaurant?.name ||
    websiteSettings?.branding?.siteTitle ||
    websiteSettings?.branding?.storeName ||
    "KnotKitchen Store";
  const restaurantAddress = useMemo(() => {
    const parts = [
      restaurant?.address?.line1,
      restaurant?.address?.line2,
      restaurant?.address?.city,
      restaurant?.address?.state,
      restaurant?.address?.postalCode,
    ]
      .filter(Boolean);
    if (parts.length) return parts.join(", ");
    const web = websiteSettings?.contact;
    const w = [
      web?.addressLine1,
      web?.addressLine2,
      web?.city,
      web?.postalCode,
    ].filter(Boolean);
    return w.join(", ");
  }, [restaurant, websiteSettings]);

  const windowLabel = useMemo(() => {
    if (!responseWindow) return "";
    const from = new Date(responseWindow.from);
    const to = new Date(responseWindow.to);
    if (responseWindow.source === "today") return `Today · ${fmtDate(from)}`;
    if (responseWindow.source === "single") return fmtDate(from);
    return `${fmtDate(from)} → ${fmtDate(to)}`;
  }, [responseWindow]);

  // Anchor the quick-date strip on the latest chosen day so scrolling
  // "back" (older dates) reveals more history without hunting.
  const quickDates = useMemo(
    () => buildQuickDates(mode === "range" ? rangeTo : selectedDate),
    [mode, selectedDate, rangeTo]
  );

  // Mouse drag-to-scroll support for the quick date selector (Module 5 §3)
  const dateStripRef = useRef(null);
  const isMouseDown = useRef(false);
  const startX = useRef(0);
  const scrollLeftVal = useRef(0);
  const dragMoved = useRef(false);

  const handleMouseDown = (e) => {
    isMouseDown.current = true;
    dragMoved.current = false;
    startX.current = e.pageX - (dateStripRef.current?.offsetLeft || 0);
    scrollLeftVal.current = dateStripRef.current?.scrollLeft || 0;
  };

  const handleMouseMove = (e) => {
    if (!isMouseDown.current || !dateStripRef.current) return;
    const x = e.pageX - dateStripRef.current.offsetLeft;
    const walk = (x - startX.current) * 1.5;
    if (Math.abs(walk) > 3) {
      dragMoved.current = true;
    }
    dateStripRef.current.scrollLeft = scrollLeftVal.current - walk;
  };

  const handleMouseUpOrLeave = () => {
    isMouseDown.current = false;
  };

  // Scroll helper for quick date strip
  const scrollStrip = (direction) => {
    if (dateStripRef.current) {
      const amount = direction === "left" ? -260 : 260;
      dateStripRef.current.scrollBy({ left: amount, behavior: "smooth" });
    }
  };

  // Scroll to the far right (where Today is located) when dates render/update
  useEffect(() => {
    if (dateStripRef.current) {
      dateStripRef.current.scrollLeft = dateStripRef.current.scrollWidth;
    }
  }, [quickDates]);

  const doPrint = () => {
    if (!summary) return;
    const html = buildPrintHtml({
      header: { name: restaurantName, address: restaurantAddress },
      summary,
      orders,
      windowLabel,
    });
    printHtmlDocument(html);
  };

  const selectedOrder = useMemo(
    () => orders.find((o) => o._id === selectedOrderId) || null,
    [orders, selectedOrderId]
  );

  const empty = { count: 0, amount: 0 };
  const s = summary || {
    total: empty, system: empty, website: empty, outside: empty,
    paid: empty, unpaidCash: empty, delivery: empty, collection: empty,
    table: empty, payByLink: empty, preparing: empty, cancelled: empty,
    completed: empty, cash: empty,
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-[#F8FAFC]">
      <div className="max-w-[1400px] mx-auto px-7 py-6">

        {/* ===== Header (Module 5 §1) ===== */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold text-[#0F172A] tracking-tight">Reports</h1>
            <p className="text-[13.5px] text-[#94A3B8] mt-1">
              {restaurantName}
              {restaurantAddress ? ` · ${restaurantAddress}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={doPrint}
              disabled={!summary || isLoading}
              className="h-[40px] px-4 rounded-xl border border-[#E2E8F0] text-[#334155] text-[13px] font-bold flex items-center gap-1.5 hover:bg-white disabled:opacity-40"
              title="Print the currently-selected period"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="7" rx="1" />
              </svg>
              Print
            </button>
            <button
              onClick={() => setShowCalendar(true)}
              className="h-[40px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold flex items-center gap-1.5 hover:bg-[#D64502]"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              Date
            </button>
          </div>
        </div>

        {/* ===== Quick date selector & Presets ===== */}
        <div className="mt-4 space-y-2">
          {/* Quick preset buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-2 rounded-xl border border-[#E2E8F0] shadow-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setMode("single");
                  setSelectedDate(today);
                  setRangeFrom(today);
                  setRangeTo(today);
                }}
                className={`h-[34px] px-3 rounded-lg text-[12.5px] font-extrabold border transition-all flex items-center gap-1.5 ${
                  mode === "single" && selectedDate === today
                    ? "bg-[#FD5302] text-white border-[#FD5302] shadow-xs"
                    : "bg-[#F8FAFC] text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${mode === "single" && selectedDate === today ? "bg-white animate-pulse" : "bg-[#FD5302]"}`} />
                Today
              </button>

              <button
                type="button"
                onClick={() => {
                  const y = localDay(new Date(Date.now() - 86400000));
                  setMode("single");
                  setSelectedDate(y);
                  setRangeFrom(y);
                  setRangeTo(y);
                }}
                className={`h-[34px] px-3 rounded-lg text-[12.5px] font-bold border transition-all ${
                  mode === "single" && selectedDate === localDay(new Date(Date.now() - 86400000))
                    ? "bg-[#FD5302] text-white border-[#FD5302] shadow-xs"
                    : "bg-[#F8FAFC] text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
                }`}
              >
                Yesterday
              </button>

              <button
                type="button"
                onClick={() => {
                  const s = localDay(new Date(Date.now() - 6 * 86400000));
                  setMode("range");
                  setRangeFrom(s);
                  setRangeTo(today);
                  setSelectedDate(s);
                }}
                className={`h-[34px] px-3 rounded-lg text-[12.5px] font-bold border transition-all ${
                  mode === "range" && rangeTo === today && rangeFrom === localDay(new Date(Date.now() - 6 * 86400000))
                    ? "bg-[#FD5302] text-white border-[#FD5302] shadow-xs"
                    : "bg-[#F8FAFC] text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
                }`}
              >
                Last 7 Days
              </button>

              <button
                type="button"
                onClick={() => {
                  const s = localDay(new Date(Date.now() - 29 * 86400000));
                  setMode("range");
                  setRangeFrom(s);
                  setRangeTo(today);
                  setSelectedDate(s);
                }}
                className={`h-[34px] px-3 rounded-lg text-[12.5px] font-bold border transition-all ${
                  mode === "range" && rangeTo === today && rangeFrom === localDay(new Date(Date.now() - 29 * 86400000))
                    ? "bg-[#FD5302] text-white border-[#FD5302] shadow-xs"
                    : "bg-[#F8FAFC] text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
                }`}
              >
                Last 30 Days
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowCalendar(true)}
              className="h-[34px] px-3 rounded-lg bg-[#F1F5F9] text-[#334155] hover:bg-[#FFF1E8] hover:text-[#C2410C] text-[12.5px] font-bold flex items-center gap-1.5 transition-colors"
            >
              <span>Select Date / Range</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            </button>
          </div>

          {/* Horizontal scroll strip with navigation */}
          <div className="relative flex items-center group">
          <button
            type="button"
            onClick={() => scrollStrip("left")}
            className="absolute left-1 z-10 w-7 h-7 rounded-full bg-white/90 border border-[#CBD5E1] shadow-md flex items-center justify-center text-[#334155] hover:bg-[#FD5302] hover:text-white hover:border-[#FD5302] transition-all opacity-80 group-hover:opacity-100"
            aria-label="Scroll left"
          >
            ‹
          </button>

          <div
            ref={dateStripRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUpOrLeave}
            onMouseLeave={handleMouseUpOrLeave}
            className="flex items-center gap-2 overflow-x-auto py-1 px-8 select-none cursor-grab active:cursor-grabbing scrollbar-none w-full"
          >
            {quickDates.map((d) => {
              const s = localDay(d);
              const isSelected =
                (mode === "single" && s === selectedDate) ||
                (mode === "range" && s >= rangeFrom && s <= rangeTo);
              const isToday = s === today;
              const parts = fmtQuickDate(d);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    if (dragMoved.current) return;
                    setMode("single");
                    setSelectedDate(s);
                    setRangeFrom(s);
                    setRangeTo(s);
                  }}
                  className={`shrink-0 h-[48px] px-3.5 rounded-xl border text-left transition-all flex items-center gap-2.5 ${
                    isSelected
                      ? "bg-[#FD5302] text-white border-[#FD5302] shadow-xs"
                      : isToday
                      ? "bg-[#FFF6F0] text-[#C2410C] border-[#FD5302] shadow-xs ring-1 ring-[#FD5302]/40 font-bold"
                      : "bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
                  }`}
                >
                  <div>
                    <p className={`text-[13px] font-extrabold leading-tight ${isSelected ? "text-white" : isToday ? "text-[#C2410C]" : "text-[#0F172A]"}`}>
                      {parts.day} {parts.month}
                    </p>
                    <p className={`text-[10.5px] font-medium leading-none mt-0.5 ${isSelected ? "text-white/80" : isToday ? "text-[#C2410C]/80" : "text-[#94A3B8]"}`}>
                      {parts.weekday}
                    </p>
                  </div>
                  {isToday && (
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full uppercase tracking-wider ${
                      isSelected ? "bg-white/25 text-white" : "bg-[#FD5302] text-white shadow-xs"
                    }`}>
                      Today
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => scrollStrip("right")}
            className="absolute right-1 z-10 w-7 h-7 rounded-full bg-white/90 border border-[#CBD5E1] shadow-md flex items-center justify-center text-[#334155] hover:bg-[#FD5302] hover:text-white hover:border-[#FD5302] transition-all opacity-80 group-hover:opacity-100"
            aria-label="Scroll right"
          >
            ›
          </button>
        </div>
      </div>

        {/* Range / window label */}
        {windowLabel && (
          <p className="mt-3 text-[12.5px] font-semibold text-[#64748B]">
            Showing: <span className="text-[#334155]">{windowLabel}</span>
            {isFetching && !isLoading ? " · updating…" : ""}
            <button
              onClick={() => refetch()}
              className="ml-3 text-[12px] font-bold text-[#C2410C] hover:underline"
            >Refresh</button>
          </p>
        )}

        {/* ===== Summary (Module 5 §5) ===== */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <SummaryCard label="Total Orders" count={s.total.count} amount={s.total.amount} tint="#FD5302" />
          <SummaryCard label="System Orders" count={s.system.count} amount={s.system.amount} />
          <SummaryCard label="Website Orders" count={s.website.count} amount={s.website.amount} />
          <SummaryCard label="Outside Orders" count={s.outside.count} amount={s.outside.amount} />
          <SummaryCard label="Paid Orders" count={s.paid.count} amount={s.paid.amount} tint="#16A34A" />
          <SummaryCard label="Unpaid / Cash Orders" count={s.unpaidCash.count} amount={s.unpaidCash.amount} tint="#EA580C" />
          <SummaryCard label="Delivery Orders" count={s.delivery.count} amount={s.delivery.amount} tint="#2563EB" />
          <SummaryCard label="Collection Orders" count={s.collection.count} amount={s.collection.amount} />
          <SummaryCard label="Table Orders" count={s.table.count} amount={s.table.amount} />
          <SummaryCard label="Pay by Link Orders" count={s.payByLink.count} amount={s.payByLink.amount} tint="#0891B2" />
        </div>

        {/* ===== Order list (Module 5 §6) ===== */}
        <div className="mt-6 bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#E2E8F0] flex items-center justify-between">
            <h2 className="text-[15px] font-extrabold text-[#0F172A]">
              Orders in this period ({orders.length})
            </h2>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 rounded-full border-[3px] border-[#FD5302] border-t-transparent animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <p className="text-center text-[13.5px] text-[#94A3B8] py-14">
              No orders were placed in the selected period.
            </p>
          ) : (
            <div className="divide-y divide-[#F1F5F9]">
              {orders.map((o) => (
                <button
                  key={o._id}
                  onClick={() => setSelectedOrderId(o._id)}
                  className="w-full text-left flex items-center gap-4 px-5 py-3 hover:bg-[#F8FAFC] transition-colors"
                >
                  <span className="text-[13px] font-extrabold text-[#0F172A] w-[110px] shrink-0">
                    #{o.orderNumber || o._id.slice(-6).toUpperCase()}
                  </span>
                  <span className="text-[12.5px] text-[#64748B] w-[70px] shrink-0">
                    {fmtTime(o.createdAt)}
                  </span>
                  <span className="text-[12px] font-bold px-2 py-[3px] rounded-md bg-[#F1F5F9] text-[#334155] shrink-0">
                    {orderTypeLabel(o.orderType)}
                  </span>
                  <span className="text-[11.5px] font-bold px-2 py-[3px] rounded-md bg-[#FFF1E8] text-[#C2410C] shrink-0">
                    {sourceLabel(o.source)}
                  </span>
                  <span className="text-[11.5px] text-[#64748B] flex-1 truncate">
                    {o.customerDetails?.name || "Walk-in"}
                    {o.customerDetails?.phone ? ` · ${o.customerDetails.phone}` : ""}
                  </span>
                  <span
                    className={`text-[11px] font-bold px-2 py-[3px] rounded-md shrink-0 ${
                      isCancelled(o.orderStatus)
                        ? "bg-[#FEF2F2] text-[#DC2626]"
                        : isReady(o.orderStatus)
                        ? "bg-[#DCFCE7] text-[#15803D]"
                        : isPreparing(o.orderStatus)
                        ? "bg-[#FFEDD5] text-[#C2410C]"
                        : "bg-[#F0FDF4] text-[#15803D]"
                    }`}
                  >{statusLabel(o.orderStatus)}</span>
                  <span className="text-[13.5px] font-extrabold text-[#0F172A] w-[90px] text-right shrink-0">
                    {money(o.bills?.totalWithTax || o.bills?.total)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ===== Calendar modal (Module 5 §2) ===== */}
      {showCalendar && (
        <CalendarModal
          initialMode={mode}
          initialFrom={mode === "range" ? rangeFrom : selectedDate}
          initialTo={mode === "range" ? rangeTo : selectedDate}
          onClose={() => setShowCalendar(false)}
          onProceed={(sel) => {
            if (sel.mode === "single") {
              setMode("single");
              setSelectedDate(sel.date);
              setRangeFrom(sel.date);
              setRangeTo(sel.date);
            } else {
              setMode("range");
              setRangeFrom(sel.from);
              setRangeTo(sel.to);
              setSelectedDate(sel.from);
            }
            setShowCalendar(false);
          }}
        />
      )}

      {/* ===== Order details modal (Module 5 §7) ===== */}
      {selectedOrder && (
        <OrderDetailsModal
          order={selectedOrder}
          onClose={() => setSelectedOrderId(null)}
        />
      )}
    </div>
  );
};

export default Reports;
