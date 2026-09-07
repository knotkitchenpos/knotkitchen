import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { enqueueSnackbar } from "notistack";
import KnotLogo from "../components/shared/KnotLogo";
import {
  getOrders,
  getStoreProperties,
  getTableSessionById,
  markOrderReady,
  recordTableSessionPayment,
  updateOrderStatus,
} from "../https";
import TableSettleModal from "../components/tables/TableSettleModal";
import { getMyRestaurant } from "../https/newModules";
import { printReceipt } from "../utils/printReceipt";
import { isPreparing, isReady, isSettled, isCancelled, statusLabel, COMPLETED, CANCELLED } from "../constants/orderStatus";
import { sourceLabel, tableLabel } from "../utils/orderLabels";
import { sendTableEBill } from "../utils/sendTableEBill";
import { receiptAddress } from "../utils/address";

/* ---------- Icons ---------- */
const I = {
  bag: (p) => (
    <svg width={p?.s || 18} height={p?.s || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  ),
  scooter: (p) => (
    <svg width={p?.s || 18} height={p?.s || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18.5" cy="17.5" r="3" /><circle cx="5.5" cy="17.5" r="3" /><path d="M15 6h3l3 7M9 17.5h6M5.5 17.5V13a3 3 0 0 1 3-3H12" />
    </svg>
  ),
  table: (p) => (
    <svg width={p?.s || 18} height={p?.s || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9h18M5 9v11M19 9v11M8 9V5M16 9V5M2 5h20" />
    </svg>
  ),
  clock: (p) => (
    <svg width={p?.s || 18} height={p?.s || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  check: (p) => (
    <svg width={p?.s || 18} height={p?.s || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  ),
  x: (p) => (
    <svg width={p?.s || 18} height={p?.s || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" />
    </svg>
  ),
  wallet: (p) => (
    <svg width={p?.s || 18} height={p?.s || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18M17 14.5h.01" />
    </svg>
  ),
  search: () => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
  ),
  print: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="7" rx="1" />
    </svg>
  ),
  user: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
  ),
  phone: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" /></svg>
  ),
  refresh: () => (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" /></svg>
  ),
  calendar: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
  ),
};

/* ---------- Helpers ---------- */
const money = (n) => `₹${Number(n || 0).toFixed(2)}`;
const timeOf = (d) =>
  new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
const minsAgo = (d) => Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));

const typeMeta = (t) => {
  const k = String(t || "").toLowerCase();
  if (k === "delivery") return { label: "Delivery", Icon: I.scooter, bg: "#EFF6FF", fg: "#2563EB" };
  if (k === "dine-in") return { label: "Table", Icon: I.table, bg: "#FFF7ED", fg: "#EA580C" };
  return { label: "Collection", Icon: I.bag, bg: "#FFF6F0", fg: "#FD5302" };
};

/**
 * Module 4 §1 — canonical status tabs.
 *
 * "Preparing" is the new canonical name (formerly "Pending" / "In Progress").
 * The backend now returns canonical strings, but we still include the legacy
 * aliases here as a defence-in-depth measure so orders written by pre-Module 4
 * code paths (KDS, marketplace, historical data) still show up under Preparing.
 *
 * Tabs order matches the lifecycle:  Preparing → Ready → Completed → Cancelled
 */
const TABS = [
  { key: "All", statuses: null },
  { key: "Preparing", statuses: ["Preparing", "Pending", "In Progress"] },
  { key: "Ready", statuses: ["Ready"] },
  // "paid" is what a settled table session writes onto its kitchen orders.
  // Without it a table the operator had just completed vanished from the
  // one tab they would look in for it.
  { key: "Completed", statuses: ["Completed", "Served", "Delivered", "paid"] },
  { key: "Cancelled", statuses: ["Cancelled"] },
];


const isFinished = (s) => ["Completed", "Cancelled"].includes(s);

/**
 * Convert a Date → YYYY-MM-DD in the LOCAL timezone.
 * `.toISOString()` is UTC and would silently shift the picker for anyone
 * east/west of Greenwich, so we build the string manually.
 */
const localDateInput = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/* ---------- Module 4 §6 — Date filter modes ---------- */
const DATE_MODES = [
  { key: "today", label: "Today" },
  { key: "single", label: "Date" },
  { key: "range", label: "Date Range" },
];

const Orders = () => {
  useEffect(() => {
    document.title = "KnotKitchen | Orders";
  }, []);

  const qc = useQueryClient();
  const user = useSelector((s) => s.user);

  /*
   * Store-branding queries — reused from OrderPanel so the Orders page
   * side header shows the same RESTAURANT/STORE name and logo the POS
   * uses. Previously this header fell back to `user.name` which surfaced
   * the logged-in staff/owner ("raja") in place of the store name — see
   * BUG 3 in the QA report.
   *
   * All three sources are tenant-scoped by the backend, so a staff user
   * from Store A can never see Store B's branding here.
   */
  const { data: restaurantRes } = useQuery({
    queryKey: ["restaurant", "me"],
    queryFn: getMyRestaurant,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const { data: storePropsRes } = useQuery({
    queryKey: ["store-properties"],
    queryFn: getStoreProperties,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const storeProps = storePropsRes?.data?.data || {};
  const restaurant = restaurantRes?.data?.data;
  const storeDisplayName =
    storeProps.storeName ||
    restaurant?.name ||
    "KnotKitchen Store";
  const storeDisplayLogo =
    storeProps.restaurantLogo ||
    restaurant?.branding?.logo ||
    restaurant?.logo ||
    "";

  const [tab, setTab] = useState("All");
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [clock, setClock] = useState(new Date());

  /**
   * Date filter state (Module 4 §6).
   *
   * We deliberately reset this to "today" on every mount of the Orders
   * page — the spec says "When reopening Orders, default back to Today".
   * If we persisted the range in Redux / localStorage the user would land
   * on last week's data after coming back from Menu / POS.
   */
  const [dateMode, setDateMode] = useState("today");
  const [singleDate, setSingleDate] = useState(localDateInput());
  const [fromDate, setFromDate] = useState(localDateInput());
  const [toDate, setToDate] = useState(localDateInput());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Build the exact params object the backend expects.
  // - today mode omits date/from/to so the server picks its own "today"
  //   window (guaranteed to line up with server-side auto-ready timers).
  // - single date mode uses `date`.
  // - range mode uses `from` / `to`.
  const orderParams = useMemo(() => {
    if (dateMode === "single" && singleDate) return { date: singleDate };
    if (dateMode === "range" && fromDate && toDate) return { from: fromDate, to: toDate };
    return undefined;
  }, [dateMode, singleDate, fromDate, toDate]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["orders", orderParams],
    queryFn: () => getOrders(orderParams),
    // Refetch when the window regains focus so a Ready that fired via the
    // server-side auto-ready timer (Module 4 §4) surfaces without needing
    // a manual click.
    refetchOnWindowFocus: true,
  });
  const orders = data?.data?.data || [];
  const responseWindow = data?.data?.window;

  const readyMutation = useMutation({
    mutationFn: (orderId) => markOrderReady(orderId),
    onSuccess: (res) => {
      const notif = res?.data?.notification;
      if (notif?.sent) {
        enqueueSnackbar("Order marked Ready. Customer notified via SMS.", { variant: "success" });
      } else if (notif?.reason === "no_phone") {
        enqueueSnackbar("Order marked Ready. No phone on file — SMS skipped.", { variant: "info" });
      } else if (notif?.reason === "duplicate") {
        enqueueSnackbar("Order already marked Ready. Customer was previously notified.", { variant: "info" });
      } else {
        enqueueSnackbar("Order marked Ready.", { variant: "success" });
      }
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Failed to mark ready", { variant: "error" }),
  });

  const statusMutation = useMutation({
    mutationFn: (d) => updateOrderStatus(d),
    onSuccess: () => {
      enqueueSnackbar("Order updated", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Failed to update order", { variant: "error" }),
  });

  /* ---------- Completing a TABLE order ----------
   *
   * A table order is not finished by a status change: the money has not been
   * taken and the table is still occupied. Pressing Complete on one used to
   * set orderStatus and stop there, which left the bill unpaid, the session
   * open and the table unavailable to the next party.
   *
   * So for a table order Complete asks how it was paid, then settles the
   * session — which closes it, marks every kitchen order paid, and frees the
   * table immediately. Non-table orders keep the plain status change.
   */
  const [settleFor, setSettleFor] = useState(null); // { order, session }
  const [settleLoading, setSettleLoading] = useState(false);

  const openSettle = async (order) => {
    setSettleLoading(true);
    try {
      const res = await getTableSessionById(order.tableSessionId);
      setSettleFor({ order, session: res?.data?.data || null });
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || "Could not load this table's bill.", {
        variant: "error",
      });
    } finally {
      setSettleLoading(false);
    }
  };

  const settleMutation = useMutation({
    mutationFn: ({ sessionId, method, amount }) =>
      recordTableSessionPayment(sessionId, {
        method,
        amount,
        // A double-tap on a slow connection must not take payment twice.
        idempotencyKey: `settle-${sessionId}-${method}-${amount}`,
      }),
    onSuccess: (res, vars) => {
      enqueueSnackbar(res?.data?.message || "Paid. The table is available again.", {
        variant: "success",
      });
      // Reported separately from the payment on purpose -- see the helper.
      if (vars?.sendEBill && vars?.phone) {
        sendTableEBill({ sessionId: vars.sessionId, phone: vars.phone, notify: enqueueSnackbar });
      }
      setSettleFor(null);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Could not complete this table.", {
        variant: "error",
      }),
  });

  /* ---------- Stats ---------- */
  // Note: "today" numbers on the stat cards are computed from the CURRENT
  // window's orders. When the user filters by an older date the cards
  // naturally reflect that day's totals, which is what an operator would
  // expect ("show me what happened on Monday").
  const stats = useMemo(() => {
    let count = 0, revenue = 0, ongoing = 0, done = 0, cancelled = 0;
    orders.forEach((o) => {
      const amt = Number(o.bills?.totalWithTax || o.bills?.total || 0);
      count += 1;
      // isSettled, not === "Completed": the auto-complete sweep finishes
      // orders as "Served" / "Delivered" and a settled table bill is "paid",
      // so an exact match reported all of those as still ongoing.
      if (!isCancelled(o.orderStatus)) revenue += amt;
      if (isSettled(o.orderStatus)) done += 1;
      else if (isCancelled(o.orderStatus)) cancelled += 1;
      else ongoing += 1;
    });
    return { count, revenue, ongoing, done, cancelled };
  }, [orders]);

  const counts = useMemo(() => {
    const c = { All: orders.length };
    TABS.forEach((t) => {
      if (t.statuses) c[t.key] = orders.filter((o) => t.statuses.includes(o.orderStatus)).length;
    });
    return c;
  }, [orders]);

  /* ---------- Filtering ---------- */
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const tabDef = TABS.find((t) => t.key === tab);
    return orders.filter((o) => {
      if (tabDef?.statuses && !tabDef.statuses.includes(o.orderStatus)) return false;
      if (typeFilter !== "all" && String(o.orderType).toLowerCase() !== typeFilter) return false;
      if (!s) return true;
      return (
        o._id?.toLowerCase().includes(s) ||
        o.orderNumber?.toLowerCase().includes(s) ||
        o.customerDetails?.name?.toLowerCase().includes(s) ||
        o.customerDetails?.phone?.includes(s) ||
        o.deliveryAddress?.line1?.toLowerCase().includes(s)
      );
    });
  }, [orders, tab, typeFilter, q]);

  const selected = useMemo(
    () => list.find((o) => o._id === selectedId) || list[0] || null,
    [list, selectedId]
  );

  const orderTitle = (o) => {
    const t = String(o.orderType).toLowerCase();
    if (t === "delivery") return o.customerDetails?.name || o.deliveryAddress?.line1 || "Delivery Order";
    // The restaurant's own name for the table ("GF1"), not its row number.
    if (t === "dine-in") return o.table ? tableLabel(o.table, "Table Order") : "Table Order";
    return o.customerDetails?.name || "Walk-in Customer";
  };

  const StatCard = ({ label, value, Icon, fg, bg }) => (
    <div className="flex-1 min-w-[150px] bg-white border border-[#E2E8F0] rounded-xl px-4 py-3 flex items-start justify-between">
      <div>
        <p className="text-[12px] font-semibold text-[#94A3B8]">{label}</p>
        <p className="text-[24px] font-extrabold text-[#0F172A] leading-tight mt-0.5">{value}</p>
      </div>
      <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: bg, color: fg }}>
        <Icon s={19} />
      </span>
    </div>
  );

  // Human-friendly window label under the search bar so the biller can
  // see AT A GLANCE which day/range they're looking at. Server's window
  // (returned in `responseWindow`) is authoritative — we use it rather
  // than re-derive locally so timezone edge cases (midnight rollover
  // while the page is open) stay consistent with what actually matched.
  const windowLabel = useMemo(() => {
    if (!responseWindow) return "";
    const fromDay = new Date(responseWindow.from);
    const toDay = new Date(responseWindow.to);
    const fmt = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    if (responseWindow.source === "today") return `Today · ${fmt(fromDay)}`;
    if (responseWindow.source === "single") return fmt(fromDay);
    return `${fmt(fromDay)} → ${fmt(toDay)}`;
  }, [responseWindow]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ===== Center: Orders list ===== */}
      <div className="flex-1 min-w-0 h-full flex flex-col bg-white">
        <div className="px-7 pt-6 pb-4 shrink-0">
          <h1 className="text-[28px] font-extrabold text-[#0F172A] tracking-tight">Orders</h1>
        </div>

        {/* Stat cards removed on operator request — the per-tab counters
            already show Preparing / Ready / Completed / Cancelled totals,
            and the Reports page carries the revenue breakdown, so the
            duplicate row was noise. */}

        {/* Tabs */}
        <div className="px-7 pb-3 shrink-0 flex flex-wrap items-center gap-1.5">
          {TABS.map((t) => {
            const on = tab === t.key;
            const n = counts[t.key] ?? 0;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`h-[38px] px-4 rounded-lg text-[13.5px] font-bold flex items-center gap-2 transition-colors ${
                  on ? "bg-[#FD5302] text-white" : "bg-white text-[#475569] border border-[#E2E8F0] hover:border-[#CBD5E1]"
                }`}
              >
                {t.key}
                <span className={`px-1.5 py-[1px] rounded text-[11px] font-extrabold ${on ? "bg-white/25" : "bg-[#F1F5F9] text-[#64748B]"}`}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        {/* Date filter (Module 4 §6) */}
        <div className="px-7 pb-3 shrink-0 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-bold text-[#94A3B8] flex items-center gap-1.5">
            <I.calendar /> Filter:
          </span>
          {DATE_MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setDateMode(m.key)}
              className={`h-[32px] px-3 rounded-lg text-[12.5px] font-bold border ${
                dateMode === m.key
                  ? "bg-[#FD5302] text-white border-[#FD5302]"
                  : "bg-white text-[#475569] border-[#E2E8F0] hover:border-[#CBD5E1]"
              }`}
            >
              {m.label}
            </button>
          ))}
          {dateMode === "single" && (
            <input
              type="date"
              value={singleDate}
              max={localDateInput()}
              onChange={(e) => setSingleDate(e.target.value)}
              className="h-[32px] px-2 rounded-lg border border-[#E2E8F0] text-[12.5px] font-semibold text-[#334155] focus:border-[#FD5302]"
            />
          )}
          {dateMode === "range" && (
            <>
              <input
                type="date"
                value={fromDate}
                max={toDate || localDateInput()}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-[32px] px-2 rounded-lg border border-[#E2E8F0] text-[12.5px] font-semibold text-[#334155] focus:border-[#FD5302]"
              />
              <span className="text-[12.5px] text-[#94A3B8]">to</span>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                max={localDateInput()}
                onChange={(e) => setToDate(e.target.value)}
                className="h-[32px] px-2 rounded-lg border border-[#E2E8F0] text-[12.5px] font-semibold text-[#334155] focus:border-[#FD5302]"
              />
            </>
          )}
          {windowLabel && (
            <span className="text-[11.5px] font-semibold text-[#64748B] ml-auto">
              Showing: <span className="text-[#334155]">{windowLabel}</span>
            </span>
          )}
        </div>

        {/* Search + filters */}
        <div className="px-7 pb-3 shrink-0 flex items-center gap-2">
          <div className="relative flex-1 max-w-[420px]">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]"><I.search /></span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by order ID, customer name, phone number…"
              className="w-full h-[40px] pl-10 pr-3 rounded-xl border border-[#E2E8F0] text-[13.5px] placeholder:text-[#94A3B8] focus:border-[#FD5302]"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-[40px] px-3 rounded-xl border border-[#E2E8F0] text-[13.5px] font-semibold text-[#475569] focus:border-[#FD5302]"
          >
            <option value="all">Order Type</option>
            <option value="collection">Collection</option>
            <option value="takeaway">Takeaway</option>
            <option value="delivery">Delivery</option>
            <option value="dine-in">Table</option>
          </select>
          <button
            onClick={() => refetch()}
            className="w-[40px] h-[40px] rounded-xl border border-[#E2E8F0] text-[#475569] flex items-center justify-center hover:border-[#FD5302] hover:text-[#C2410C]"
            title="Refresh"
          >
            <span className={isFetching ? "animate-spin" : ""}><I.refresh /></span>
          </button>
        </div>

        {/* Order rows */}
        <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-6">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <div className="w-9 h-9 rounded-full border-[3px] border-[#FD5302] border-t-transparent animate-spin" />
            </div>
          ) : list.length === 0 ? (
            <p className="text-center text-[14px] text-[#94A3B8] py-20">No orders found for the selected period.</p>
          ) : (
            <div className="space-y-2">
              {list.map((o) => {
                const meta = typeMeta(o.orderType);
                const on = selected?._id === o._id;
                const mins = minsAgo(o.createdAt);
                const ring = mins < 10 ? "#16A34A" : mins < 20 ? "#F59E0B" : "#EF4444";
                const cancelled = isCancelled(o.orderStatus);
                const preparingBadge = isPreparing(o.orderStatus);
                const readyBadge = isReady(o.orderStatus);
                return (
                  <div
                    key={o._id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(o._id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(o._id);
                      }
                    }}
                    className={`w-full text-left flex items-center gap-4 px-4 py-3 rounded-xl border-l-[3px] border transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#FD5302]/40 ${
                      on ? "border-[#FD5302] bg-[#FFF6F0]" : "border-[#E2E8F0] bg-white hover:border-[#CBD5E1]"
                    }`}
                    style={{ borderLeftColor: ring }}
                  >
                    {/* Timer */}
                    <div className="shrink-0 w-[46px] text-center">
                      <div
                        className="w-[38px] h-[38px] rounded-full border-2 flex items-center justify-center mx-auto"
                        style={{ borderColor: ring, color: ring }}
                      >
                        <span className="text-[13px] font-extrabold">{mins}</span>
                      </div>
                      <p className="text-[9.5px] font-bold text-[#94A3B8] mt-0.5">min</p>
                    </div>

                    {/* ID + time */}
                    <div className="shrink-0 w-[110px]">
                      <p className="text-[13px] font-extrabold text-[#0F172A]">
                        #{o.orderNumber || o._id.slice(-6).toUpperCase()}
                      </p>
                      <p className="text-[11.5px] text-[#94A3B8]">{timeOf(o.createdAt)}</p>
                    </div>

                    {/* Type icon */}
                    <span
                      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: meta.bg, color: meta.fg }}
                    >
                      <meta.Icon s={17} />
                    </span>

                    {/* Title + meta */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[14.5px] font-extrabold text-[#0F172A] truncate">{orderTitle(o)}</p>
                        <span
                          className="px-2 py-[2px] rounded-md text-[10.5px] font-bold shrink-0"
                          style={{ background: meta.bg, color: meta.fg }}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <p className="text-[11.5px] text-[#94A3B8] mt-0.5">
                        {sourceLabel(o.source)} · {o.items?.length || 0} Items
                      </p>
                    </div>

                    {/* Status + amount */}
                    <span
                      className={`px-2 py-[3px] rounded-md text-[11px] font-bold shrink-0 ${
                        cancelled
                          ? "bg-[#FEF2F2] text-[#DC2626]"
                          : readyBadge
                          ? "bg-[#DCFCE7] text-[#15803D]"
                          : preparingBadge
                          ? "bg-[#FFEDD5] text-[#C2410C]"
                          : "bg-[#F0FDF4] text-[#15803D]"
                      }`}
                    >
                      {statusLabel(o.orderStatus)}
                    </span>
                    <span className="text-[14.5px] font-extrabold text-[#0F172A] w-[80px] text-right shrink-0">
                      {money(o.bills?.totalWithTax || o.bills?.total)}
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(o._id);
                        // Bring the details pane into view on smaller screens
                        // where it might be below the fold.
                        if (typeof document !== "undefined") {
                          document
                            .getElementById("order-detail-pane")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }
                      }}
                      className="h-[32px] px-3.5 rounded-lg border border-[#FD5302] text-[#C2410C] text-[12.5px] font-bold flex items-center shrink-0 hover:bg-[#FFF1E8]"
                    >
                      View
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-7 py-3 border-t border-[#E2E8F0] shrink-0">
          <p className="text-[12.5px] text-[#94A3B8]">
            Showing {list.length} of {orders.length} orders {windowLabel && `— ${windowLabel}`}
          </p>
        </div>
      </div>

      {/* ===== Right: Order detail ===== */}
      <aside id="order-detail-pane" className="w-[400px] shrink-0 h-full bg-white border-l border-[#E2E8F0] flex flex-col">
        {/*
          Store header — MUST show the RESTAURANT/STORE name and logo,
          not the logged-in user. Previously this fell back to
          `user.name` which surfaced staff/owner names like "raja" in
          place of the restaurant name (see BUG 3 in the QA report).
        */}
        <div className="px-4 py-3.5 flex items-center gap-3 border-b border-[#E2E8F0] shrink-0">
          <div
            className={`w-[42px] h-[42px] rounded-full flex items-center justify-center shrink-0 overflow-hidden ${
              storeDisplayLogo ? "bg-white border border-[#E2E8F0]" : "bg-[#0B1120]"
            }`}
            title={storeDisplayName}
          >
            {storeDisplayLogo ? (
              <img
                src={storeDisplayLogo}
                alt={`${storeDisplayName} logo`}
                className="w-full h-full object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <KnotLogo size={26} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-extrabold text-[#0F172A] truncate leading-tight">
              {storeDisplayName}
            </p>
            <p className="text-[11.5px] text-[#94A3B8] truncate">Store ID: {user?.storeId || "—"}</p>
          </div>
          <span className="px-2 py-[3px] rounded-full bg-[#DCFCE7] text-[#15803D] text-[10.5px] font-bold flex items-center gap-1 shrink-0">
            <span className="w-[5px] h-[5px] rounded-full bg-[#22C55E]" /> Online
          </span>
          <div className="text-right shrink-0 leading-tight">
            <p className="text-[12.5px] font-bold text-[#0F172A]">
              {clock.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className="text-[10px] text-[#94A3B8]">
              {clock.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
        </div>

        {!selected ? (
          <div className="flex-1 flex items-center justify-center px-6">
            <p className="text-[13.5px] text-[#94A3B8] text-center">
              Select an order to see its full details.
            </p>
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {/* Order header — Module 4 §7 renders the FULL detail set below. */}
              <div className="px-4 py-3.5 border-b border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[18px] font-extrabold text-[#0F172A]">
                      #{selected.orderNumber || selected._id.slice(-6).toUpperCase()}
                    </h2>
                    <span
                      className="px-2 py-[2px] rounded-md text-[10.5px] font-bold"
                      style={{ background: typeMeta(selected.orderType).bg, color: typeMeta(selected.orderType).fg }}
                    >
                      {typeMeta(selected.orderType).label}
                    </span>
                  </div>
                  <span className="text-[18px] font-extrabold text-[#0F172A]">
                    {money(selected.bills?.totalWithTax || selected.bills?.total)}
                  </span>
                </div>

                <div className="mt-2.5 space-y-1.5">
                  <p className="flex items-center gap-2 text-[13.5px] text-[#334155]">
                    <span className="text-[#94A3B8]"><I.user /></span>
                    {selected.customerDetails?.name || "Walk-in Customer"}
                  </p>
                  {selected.customerDetails?.phone && (
                    <p className="flex items-center gap-2 text-[13.5px] text-[#334155]">
                      <span className="text-[#94A3B8]"><I.phone /></span>
                      {selected.customerDetails.phone}
                    </p>
                  )}
                  {(selected.customerDetails?.address ||
                    selected.deliveryAddress?.line1) && (
                    <p className="text-[12.5px] text-[#64748B] leading-snug">
                      {selected.customerDetails?.address ||
                        selected.deliveryAddress?.line1}
                      {(selected.customerDetails?.city ||
                        selected.deliveryAddress?.city) &&
                        `, ${selected.customerDetails?.city || selected.deliveryAddress?.city}`}
                      {(selected.customerDetails?.pinCode ||
                        selected.deliveryAddress?.postalCode) &&
                        ` — ${selected.customerDetails?.pinCode || selected.deliveryAddress?.postalCode}`}
                    </p>
                  )}
                  {(selected.customerDetails?.deliveryNote ||
                    selected.deliveryAddress?.instructions) && (
                    <p className="text-[11.5px] italic text-[#C2410C] leading-snug">
                      Note: {selected.customerDetails?.deliveryNote || selected.deliveryAddress?.instructions}
                    </p>
                  )}
                </div>
              </div>

              {/* Items — includes variant, add-ons and options (Module 4 §7). */}
              <div className="px-4 py-3.5 border-b border-[#E2E8F0]">
                <p className="text-[13.5px] font-extrabold text-[#0F172A] mb-2.5">
                  Order Items ({selected.items?.length || 0})
                </p>
                <div className="space-y-2.5">
                  {(selected.items || []).map((it, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-bold text-[#0F172A] truncate">
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
                        {it.note && <p className="text-[11px] text-[#C2410C] truncate">Note: {it.note}</p>}
                      </div>
                      <span className="px-2.5 py-[3px] rounded-md border border-[#E2E8F0] text-[12px] font-bold text-[#334155] shrink-0">
                        x {it.quantity}
                      </span>
                      <span className="text-[13.5px] font-extrabold text-[#0F172A] w-[68px] text-right shrink-0">
                        {money(it.total || it.price * it.quantity)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="px-4 py-3.5 border-b border-[#E2E8F0]">
                <p className="text-[13.5px] font-extrabold text-[#0F172A] mb-2.5">Order Summary</p>
                <div className="space-y-1.5 text-[13px]">
                  <div className="flex justify-between">
                    <span className="text-[#475569]">Subtotal</span>
                    <span className="font-bold text-[#0F172A]">
                      {money(selected.bills?.subtotal || selected.bills?.total)}
                    </span>
                  </div>
                  {Number(selected.bills?.discount) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-[#475569]">Discount</span>
                      <span className="font-bold text-[#16A34A]">− {money(selected.bills?.discount)}</span>
                    </div>
                  )}
                  {Number(selected.bills?.packagingFee) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-[#475569]">Packaging</span>
                      <span className="font-bold text-[#0F172A]">{money(selected.bills?.packagingFee)}</span>
                    </div>
                  )}
                  {Number(selected.bills?.deliveryFee) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-[#475569]">Delivery</span>
                      <span className="font-bold text-[#0F172A]">{money(selected.bills?.deliveryFee)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[#475569]">Tax</span>
                    <span className="font-bold text-[#0F172A]">{money(selected.bills?.tax)}</span>
                  </div>
                  <div className="flex justify-between pt-2 mt-1 border-t border-[#E2E8F0]">
                    <span className="text-[16px] font-extrabold text-[#0F172A]">Total</span>
                    <span className="text-[19px] font-extrabold text-[#C2410C]">
                      {money(selected.bills?.totalWithTax || selected.bills?.total)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Info — every field required by Module 4 §7. */}
              <div className="px-4 py-3.5">
                <p className="text-[13.5px] font-extrabold text-[#0F172A] mb-2.5">Order Information</p>
                <div className="grid grid-cols-2 gap-y-2.5 gap-x-3 text-[12.5px]">
                  <div>
                    <p className="text-[#94A3B8]">Order ID</p>
                    <p className="font-bold text-[#0F172A] mt-0.5 break-all">
                      {selected.orderNumber || selected._id.slice(-8).toUpperCase()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#94A3B8]">Source</p>
                    <p className="font-bold text-[#0F172A] mt-0.5">
                      {sourceLabel(selected.source)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#94A3B8]">Order Type</p>
                    <p className="font-bold text-[#0F172A] mt-0.5">{typeMeta(selected.orderType).label}</p>
                  </div>
                  <div>
                    <p className="text-[#94A3B8]">Status</p>
                    <p className="font-bold text-[#0F172A] mt-0.5">
                      {statusLabel(selected.orderStatus)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#94A3B8]">Payment Method</p>
                    <p className="font-bold text-[#0F172A] mt-0.5 capitalize">
                      {/* Blank until a payment is actually taken. Defaulting
                          to "Cash" told the operator an unpaid order had been
                          settled in cash. */}
                      {selected.paymentMethod || selected.payments?.[0]?.method || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#94A3B8]">Payment Status</p>
                    <p className="font-bold text-[#0F172A] mt-0.5 capitalize">
                      {selected.payments?.[0]?.status || "pending"}
                    </p>
                  </div>
                  {selected.payments?.[0]?.transactionId && (
                    <div className="col-span-2">
                      <p className="text-[#94A3B8]">Payment ID</p>
                      <p className="font-bold text-[#0F172A] mt-0.5 break-all">
                        {selected.payments[0].transactionId}
                      </p>
                    </div>
                  )}
                  <div className="col-span-2">
                    <p className="text-[#94A3B8]">Order Time</p>
                    <p className="font-bold text-[#0F172A] mt-0.5">
                      {new Date(selected.createdAt).toLocaleString("en-GB", {
                        day: "numeric", month: "short", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  </div>
                  {selected.readyAt && (
                    <div className="col-span-2">
                      <p className="text-[#94A3B8]">Marked Ready</p>
                      <p className="font-bold text-[#0F172A] mt-0.5">
                        {new Date(selected.readyAt).toLocaleString("en-GB", {
                          day: "numeric", month: "short",
                          hour: "2-digit", minute: "2-digit",
                        })}
                        {selected.readyBy ? ` · by ${selected.readyBy}` : ""}
                      </p>
                    </div>
                  )}
                  {selected.readyDueAt && !selected.readyAt && (
                    <div className="col-span-2">
                      <p className="text-[#94A3B8]">Auto-ready at</p>
                      <p className="font-bold text-[#0F172A] mt-0.5">
                        {new Date(selected.readyDueAt).toLocaleString("en-GB", {
                          day: "numeric", month: "short",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <div className="px-4 py-3.5 border-t border-[#E2E8F0] shrink-0 grid grid-cols-3 gap-2">
              <button
                onClick={() =>
                  printReceipt({
                    cartData: selected.items || [],
                    customerData: {
                      customerName: selected.customerDetails?.name,
                      customerPhone: selected.customerDetails?.phone,
                      // Show the customer-facing Order ID on the printed
                      // receipt — matches the panel's "#…" label.
                      orderId:
                        selected.orderNumber ||
                        selected._id?.slice(-6).toUpperCase() ||
                        "",
                    },
                    total: selected.bills?.total || 0,
                    tax: selected.bills?.tax || 0,
                    totalPriceWithTax: selected.bills?.totalWithTax || 0,
                    // Store branding — MUST be the restaurant's own
                    // name/address, never "KnotKitchen" or the
                    // logged-in user's name (see BUG 6 in the QA
                    // report).
                    restaurantName: storeDisplayName,
                    restaurantAddress: receiptAddress({ storeProps, restaurant }),
                    restaurantPhone:
                      storeProps.ownerPhone ||
                      storeProps.contactPersonPhone ||
                      restaurant?.phone ||
                      "",
                  })
                }
                className="h-[46px] rounded-xl border border-[#E2E8F0] text-[#334155] text-[12.5px] font-bold flex items-center justify-center gap-1.5 hover:bg-[#F8FAFC]"
              >
                <I.print /> Print
              </button>

              {/* Module 4 §2 — Mark Ready. Uses the dedicated endpoint so the
                  backend fires the SMS notification through the shared
                  ready-notification service. */}
              {isPreparing(selected.orderStatus) ? (
                <button
                  disabled={readyMutation.isPending}
                  onClick={() => readyMutation.mutate(selected._id)}
                  className="h-[46px] rounded-xl bg-[#FD5302] text-white text-[12.5px] font-bold flex items-center justify-center gap-1.5 hover:bg-[#D64502] disabled:opacity-40"
                >
                  <I.check s={16} />
                  Mark Ready
                </button>
              ) : isReady(selected.orderStatus) ? (
                <button
                  disabled={statusMutation.isPending || settleLoading}
                  onClick={() =>
                    // A table order has money outstanding and a table still
                    // occupied, so completing it means settling the session,
                    // not flipping a status.
                    selected.tableSessionId
                      ? openSettle(selected)
                      : statusMutation.mutate({ orderId: selected._id, orderStatus: COMPLETED })
                  }
                  className="h-[46px] rounded-xl bg-[#16A34A] text-white text-[12.5px] font-bold flex items-center justify-center gap-1.5 hover:bg-[#15803D] disabled:opacity-40"
                >
                  <I.check s={16} />
                  Complete
                </button>
              ) : (
                <button
                  disabled
                  className="h-[46px] rounded-xl bg-[#F1F5F9] text-[#94A3B8] text-[12.5px] font-bold flex items-center justify-center gap-1.5"
                >
                  <I.check s={16} />
                  {selected.orderStatus}
                </button>
              )}

              <button
                disabled={isFinished(selected.orderStatus) || statusMutation.isPending}
                onClick={() => statusMutation.mutate({ orderId: selected._id, orderStatus: CANCELLED })}
                className="h-[46px] rounded-xl border border-[#FCA5A5] text-[#DC2626] text-[12.5px] font-bold flex items-center justify-center gap-1.5 hover:bg-[#FEF2F2] disabled:opacity-40"
              >
                <I.x s={16} /> Cancel
              </button>
            </div>
          </>
        )}
      </aside>

      {/* Complete a table order: close the table, then take the payment. */}
      {settleFor?.session && (
        <TableSettleModal
          table={settleFor.order?.table}
          session={settleFor.session}
          busy={settleMutation.isPending}
          onClose={() => setSettleFor(null)}
          onConfirm={({ method, amount, sendEBill: alsoEBill, phone }) =>
            settleMutation.mutate({
              sessionId: settleFor.session._id,
              method,
              amount,
              sendEBill: alsoEBill,
              phone,
            })
          }
        />
      )}
    </div>
  );
};

export default Orders;
