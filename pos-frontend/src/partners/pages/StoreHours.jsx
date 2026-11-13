import React, { useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { MdStorefront, MdEventBusy, MdDelete } from "react-icons/md";
import { enqueueSnackbar } from "../../utils/notify";
import { dateGB, localDay } from "../../utils";
import { partnersApi, errorMessage } from "../api";
import TimingsHolidaysView from "../../components/settings/TimingsHolidaysView";
import StoreScreen from "../components/StoreScreen";

/**
 * Store hours across stores (owner, 2026-11-13): Close for today and
 * holidays for several stores at once, and each store's opening hours (the
 * POS's own Website Timing & Holidays screen below). These are the website's,
 * table QR's and Knot Eats' hours; the till itself never closes.
 */

const ymd = (d) => (d ? new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "");
const btnGhost = "h-9 px-3.5 rounded-lg border border-[#E2E8F0] text-[12.5px] font-bold text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-40";

const StoreHours = ({ me }) => {
  const qc = useQueryClient();
  const stores = (me?.stores || []).filter((s) => s.linkStatus === "ok");
  const today = localDay();
  const settingsOf = useQueries({
    queries: stores.map((s) => ({
      queryKey: ["partner-store-hours", s.storeId],
      queryFn: () => partnersApi.storeWebsiteSettings(s.storeId).then((r) => r.data?.data?.settings || {}),
      retry: false,
    })),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["partner-store-hours"] });
  const [busy, setBusy] = useState("");

  const run = async (label, ids, fn) => {
    setBusy(label);
    const failed = [];
    for (const id of ids) {
      try {
        await fn(id);
      } catch (err) {
        failed.push(`${stores.find((s) => s.storeId === id)?.name || id}: ${errorMessage(err, "not saved")}`);
      }
    }
    setBusy("");
    refresh();
    if (failed.length) enqueueSnackbar(failed.join(" · "), { variant: "error" });
    else enqueueSnackbar("Saved.", { variant: "success", important: true });
  };

  const closedToday = (st) => Boolean(st?.closedForToday?.enabled);
  const onHoliday = (st) => (st?.holidays || []).find((h) => ymd(h.startDate) <= today && ymd(h.endDate) >= today);

  const [hol, setHol] = useState({ start: "", end: "", reason: "", stores: [] });
  const addHoliday = () =>
    run("holiday", hol.stores, async (id) => {
      const current = settingsOf[stores.findIndex((s) => s.storeId === id)]?.data?.holidays || [];
      const holidays = [...current.map((h) => ({ startDate: h.startDate, endDate: h.endDate, reason: h.reason })), { startDate: hol.start, endDate: hol.end || hol.start, reason: hol.reason || "Closed for holiday" }];
      await partnersApi.storeHolidays(id, holidays);
    }).then(() => setHol({ start: "", end: "", reason: "", stores: [] }));
  const removeHoliday = (id, idx) =>
    run(`rm-${id}-${idx}`, [id], async () => {
      const current = settingsOf[stores.findIndex((s) => s.storeId === id)]?.data?.holidays || [];
      await partnersApi.storeHolidays(id, current.filter((_, i) => i !== idx).map((h) => ({ startDate: h.startDate, endDate: h.endDate, reason: h.reason })));
    });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">Store hours</h1>
        <p className="text-[13px] text-[#64748B] mt-0.5">Close for today and holidays for several stores at once. These are the website&apos;s, table QR&apos;s and Knot Eats&apos; hours; the till keeps working.</p>
      </div>

      {/* Today */}
      <section className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-[15px] font-extrabold">Today</h2>
          <div className="flex gap-2">
            <button type="button" className={btnGhost} disabled={Boolean(busy)} onClick={() => run("close-all", stores.map((s) => s.storeId), (id) => partnersApi.storeClosedToday(id, true))}>
              Close all for today
            </button>
            <button type="button" className={btnGhost} disabled={Boolean(busy)} onClick={() => run("open-all", stores.map((s) => s.storeId), (id) => partnersApi.storeClosedToday(id, false))}>
              Reopen all
            </button>
          </div>
        </div>
        <ul className="divide-y divide-[#F1F5F9]">
          {stores.map((s, i) => {
            const q = settingsOf[i];
            const st = q?.data;
            const closed = closedToday(st);
            const holiday = onHoliday(st);
            return (
              <li key={s.storeId} className="py-3 flex flex-wrap items-center gap-3">
                <MdStorefront className="text-[#94A3B8] shrink-0" size={20} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold truncate">{s.name}</span>
                  <span className="block text-[12px] text-[#64748B]">
                    {q?.isLoading ? "Loading…" : q?.isError ? errorMessage(q.error, "Hours not available on this store's plan") : holiday ? `Holiday: ${holiday.reason}` : closed ? `Closed for today${st.closedForToday.reason && !/^closed for today$/i.test(st.closedForToday.reason) ? ` · ${st.closedForToday.reason}` : ""}` : "Open as scheduled"}
                  </span>
                </span>
                {!q?.isError && !q?.isLoading && (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => run(`t-${s.storeId}`, [s.storeId], (id) => partnersApi.storeClosedToday(id, !closed))}
                    className={`h-9 px-3.5 rounded-lg text-[12.5px] font-extrabold ${closed ? "bg-[#DCFCE7] text-[#166534]" : "bg-[#FEE2E2] text-[#991B1B]"}`}
                  >
                    {closed ? "Reopen today" : "Close for today"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Holidays */}
      <section className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 space-y-4">
        <h2 className="text-[15px] font-extrabold flex items-center gap-2"><MdEventBusy size={19} /> Holidays</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-[12.5px] font-bold text-[#334155]">From</span>
            <input type="date" min={today} value={hol.start} onChange={(e) => { const v = e.target.value; setHol((h) => ({ ...h, start: v, end: h.end && h.end < v ? v : h.end })); }} className="mt-1 h-11 w-full px-3 rounded-xl border border-[#E2E8F0]" />
          </label>
          <label className="block">
            <span className="text-[12.5px] font-bold text-[#334155]">To</span>
            <input type="date" min={hol.start || today} value={hol.end} onChange={(e) => { const v = e.target.value; setHol((h) => ({ ...h, end: v })); }} className="mt-1 h-11 w-full px-3 rounded-xl border border-[#E2E8F0]" />
          </label>
          <label className="block">
            <span className="text-[12.5px] font-bold text-[#334155]">Reason</span>
            <input value={hol.reason} maxLength={80} onChange={(e) => { const v = e.target.value; setHol((h) => ({ ...h, reason: v })); }} placeholder="e.g. Diwali" className="mt-1 h-11 w-full px-3 rounded-xl border border-[#E2E8F0]" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {stores.map((s) => {
            const on = hol.stores.includes(s.storeId);
            return (
              <button key={s.storeId} type="button" onClick={() => setHol((h) => ({ ...h, stores: h.stores.includes(s.storeId) ? h.stores.filter((x) => x !== s.storeId) : [...h.stores, s.storeId] }))} className={`h-9 px-3.5 rounded-full text-[12.5px] font-bold border ${on ? "bg-[#0F172A] text-white border-[#0F172A]" : "bg-white text-[#334155] border-[#E2E8F0]"}`}>
                {s.name}
              </button>
            );
          })}
        </div>
        <button type="button" disabled={!hol.start || !hol.stores.length || Boolean(busy)} onClick={addHoliday} className="h-11 px-5 rounded-xl bg-[#FD5302] text-white text-[14px] font-extrabold disabled:opacity-40">
          {busy === "holiday" ? "Saving…" : `Add holiday to ${hol.stores.length || ""} store${hol.stores.length === 1 ? "" : "s"}`}
        </button>
        <ul className="space-y-2">
          {stores.flatMap((s, i) =>
            (settingsOf[i]?.data?.holidays || [])
              .map((h, idx) => ({ h, idx }))
              .filter(({ h }) => ymd(h.endDate) >= today)
              .map(({ h, idx }) => (
                <li key={`${s.storeId}-${idx}`} className="flex items-center gap-3 rounded-xl border border-[#E2E8F0] px-3 py-2">
                  <span className="min-w-0 flex-1 text-[13px]">
                    <strong>{s.name}</strong> · {dateGB(h.startDate)}{ymd(h.endDate) !== ymd(h.startDate) ? ` – ${dateGB(h.endDate)}` : ""} · {h.reason}
                  </span>
                  <button type="button" aria-label="Remove holiday" disabled={Boolean(busy)} onClick={() => removeHoliday(s.storeId, idx)} className="w-9 h-9 rounded-lg text-[#B91C1C] hover:bg-[#FEF2F2] flex items-center justify-center">
                    <MdDelete size={18} />
                  </button>
                </li>
              ))
          )}
        </ul>
      </section>

      {/* One store's opening hours: the POS screen */}
      <section className="space-y-2">
        <h2 className="text-[15px] font-extrabold">Opening hours</h2>
        <StoreScreen me={me} title="Opening hours">
          <div className="px-4 sm:px-5">
            <TimingsHolidaysView />
          </div>
        </StoreScreen>
      </section>
    </div>
  );
};

export default StoreHours;
