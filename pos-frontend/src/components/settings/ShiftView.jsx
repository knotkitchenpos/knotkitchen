import React, { useState } from "react";
import { useSelector } from "react-redux";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { closeShift, getCurrentShift, getShifts, getStoreProperties, openShift } from "../../https";
import SecurityPinModal from "../common/SecurityPinModal";
import { checkActionAuthorization } from "../../utils/security";
import { printHtmlDocument } from "../../utils/printDocument";

/**
 * Settings > Shift & Day End.
 *
 * Open the till with a float, watch the drawer's expected cash through the
 * day, close with a count. The close freezes the figures; "Z report" prints
 * them. Opening and closing are owner or PIN actions, like publishing.
 */

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "";

const inputClass =
  "h-[44px] w-full rounded-xl border border-[#E2E8F0] px-3 text-[15px] font-bold text-[#0F172A] outline-none focus:border-[#FD5302]";
const btnPrimary =
  "h-[44px] px-5 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50";
const btnGhost =
  "h-[40px] px-4 rounded-xl border border-[#E2E8F0] text-[#334155] text-[13px] font-bold hover:bg-[#F8FAFC] disabled:opacity-50";

const ROWS = [
  ["orders", "Orders", false],
  ["cancelled", "Cancelled", false],
  ["sales", "Sales (net of refunds)", true],
  ["refunds", "Refunds", true],
  ["cash", "Cash", true],
  ["upi", "UPI", true],
  ["gateway", "Card / online", true],
  ["other", "Other", true],
];

const Figures = ({ s, openingCash, closingCash }) => (
  <table className="w-full text-[13px]">
    <tbody>
      {ROWS.map(([key, label, isMoney]) => (
        <tr key={key} className="border-b border-[#F1F5F9]">
          <td className="py-1.5 text-[#475569]">{label}</td>
          <td className="py-1.5 text-right font-bold text-[#0F172A]">{isMoney ? money(s?.[key]) : s?.[key] || 0}</td>
        </tr>
      ))}
      <tr className="border-b border-[#F1F5F9]">
        <td className="py-1.5 text-[#475569]">Opening float</td>
        <td className="py-1.5 text-right font-bold">{money(openingCash)}</td>
      </tr>
      <tr className="border-b border-[#F1F5F9]">
        <td className="py-1.5 font-bold text-[#0F172A]">Expected cash in drawer</td>
        <td className="py-1.5 text-right font-extrabold text-[#0F172A]">{money(s?.expectedCash)}</td>
      </tr>
      {closingCash !== undefined && (
        <>
          <tr className="border-b border-[#F1F5F9]">
            <td className="py-1.5 text-[#475569]">Counted cash</td>
            <td className="py-1.5 text-right font-bold">{money(closingCash)}</td>
          </tr>
          <tr>
            <td className="py-1.5 font-bold">Difference</td>
            <td className={`py-1.5 text-right font-extrabold ${Number(s?.difference) < 0 ? "text-[#DC2626]" : "text-[#16A34A]"}`}>
              {Number(s?.difference) > 0 ? "+" : ""}
              {money(s?.difference)}
            </td>
          </tr>
        </>
      )}
    </tbody>
  </table>
);

const zReportHtml = (shift, store) => {
  const s = shift.summary || shift.live || {};
  const row = (l, v) =>
    `<tr><td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;">${l}</td><td style="padding:4px 8px;border-bottom:1px solid #E2E8F0;text-align:right;font-weight:700;">${v}</td></tr>`;
  const closed = shift.status === "closed";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Z Report</title>
<style>body{font-family:Arial,sans-serif;color:#0F172A;margin:24px;max-width:420px}h1{font-size:18px;margin:0}h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #0F172A;padding-bottom:4px}.muted{color:#64748B;font-size:12px}table{width:100%;border-collapse:collapse;font-size:12.5px}</style></head>
<body><h1>${store?.name || "Restaurant"}</h1><div class="muted">${closed ? "Z REPORT · shift closed" : "X REPORT · shift still open"}</div>
<div class="muted">Opened ${when(shift.openedAt)} by ${shift.openedBy || "-"}${closed ? `<br>Closed ${when(shift.closedAt)} by ${shift.closedBy || "-"}` : ""}</div>
<h2>Sales</h2><table>${ROWS.map(([k, l, m]) => row(l, m ? money(s[k]) : s[k] || 0)).join("")}</table>
<h2>Cash drawer</h2><table>${row("Opening float", money(shift.openingCash))}${row("Cash sales", money(s.cash))}${row("Expected in drawer", money(s.expectedCash))}${
    closed ? row("Counted", money(shift.closingCash)) + row("Difference", `${Number(s.difference) > 0 ? "+" : ""}${money(s.difference)}`) : ""
  }</table>
${shift.note ? `<p class="muted">Note: ${shift.note}</p>` : ""}
<p class="muted">Printed ${when(new Date())}</p></body></html>`;
};

const ShiftView = () => {
  const qc = useQueryClient();
  const user = useSelector((s) => s.user);
  const { data: curRes, isLoading } = useQuery({ queryKey: ["shift", "current"], queryFn: getCurrentShift, refetchInterval: 60_000 });
  const { data: listRes } = useQuery({ queryKey: ["shift", "list"], queryFn: () => getShifts(30) });
  const { data: propsRes } = useQuery({ queryKey: ["store-properties"], queryFn: getStoreProperties });
  const store = propsRes?.data?.data;
  const shift = curRes?.data?.data || null;
  const history = listRes?.data?.data || [];

  const [openingCash, setOpeningCash] = useState("");
  const [closingCash, setClosingCash] = useState("");
  const [note, setNote] = useState("");
  const [pinFor, setPinFor] = useState(null); // () => void
  const [closing, setClosing] = useState(false);

  const protectedRun = (fn) => {
    const auth = checkActionAuthorization(user, { isOwnerOnly: false });
    if (auth.status === "REQUIRE_PIN") setPinFor(() => fn);
    else fn();
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["shift"] });
  };
  const openMut = useMutation({
    mutationFn: openShift,
    onSuccess: (res) => {
      enqueueSnackbar(res.data?.message || "Shift opened", { variant: "success" });
      setOpeningCash("");
      refresh();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not open the shift", { variant: "error" }),
  });
  const closeMut = useMutation({
    mutationFn: closeShift,
    onSuccess: (res) => {
      enqueueSnackbar(res.data?.message || "Shift closed", { variant: "success" });
      setClosing(false);
      setClosingCash("");
      setNote("");
      refresh();
      const closed = res.data?.data;
      if (closed) printHtmlDocument(zReportHtml(closed, store));
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not close the shift", { variant: "error" }),
  });

  const counted = Number(closingCash);
  const countedOk = closingCash !== "" && Number.isFinite(counted) && counted >= 0;
  const liveDiff = shift?.live ? Math.round((counted - Number(shift.live.expectedCash || 0)) * 100) / 100 : 0;

  if (isLoading) return <div className="p-8 text-center text-[#94A3B8]">Loading…</div>;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[#64748B] leading-relaxed">
        Open the till with the cash you start the day with. Every order until you close belongs to this shift. Close by
        counting the drawer: the POS shows what should be there and the difference, prints the Z report, and keeps it here.
      </p>

      {!shift ? (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-3">
          <h4 className="text-[15px] font-extrabold text-[#0F172A]">No shift open</h4>
          <label className="block">
            <span className="text-[12.5px] font-bold text-[#475569]">Opening cash in the drawer (float)</span>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              placeholder="e.g. 2000"
              className={`${inputClass} mt-1 max-w-xs`}
            />
          </label>
          <button
            type="button"
            className={btnPrimary}
            disabled={openMut.isPending || openingCash === "" || !(Number(openingCash) >= 0)}
            onClick={() => protectedRun(() => openMut.mutate({ openingCash: Number(openingCash) }))}
          >
            {openMut.isPending ? "Opening…" : "Open shift"}
          </button>
        </div>
      ) : (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-[15px] font-extrabold text-[#0F172A]">Shift open</h4>
              <p className="text-[12.5px] text-[#64748B]">
                Since {when(shift.openedAt)} · {shift.openedBy || "POS"} · float {money(shift.openingCash)}
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" className={btnGhost} onClick={() => printHtmlDocument(zReportHtml(shift, store))}>
                Print X report
              </button>
              {!closing && (
                <button type="button" className={btnPrimary.replace("h-[44px]", "h-[40px]")} onClick={() => setClosing(true)}>
                  Close shift
                </button>
              )}
            </div>
          </div>

          <Figures s={shift.live} openingCash={shift.openingCash} />

          {closing && (
            <div className="rounded-xl border border-[#FED7AA] bg-[#FFF7ED] p-4 space-y-3">
              <label className="block">
                <span className="text-[12.5px] font-bold text-[#9A3412]">Cash counted in the drawer now</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="decimal"
                  autoFocus
                  value={closingCash}
                  onChange={(e) => setClosingCash(e.target.value)}
                  className={`${inputClass} mt-1 max-w-xs`}
                />
              </label>
              {countedOk && (
                <p className={`text-[13px] font-bold ${liveDiff < 0 ? "text-[#DC2626]" : "text-[#16A34A]"}`}>
                  Expected {money(shift.live?.expectedCash)} · {liveDiff < 0 ? "short" : liveDiff > 0 ? "over" : "exact"}{" "}
                  {liveDiff !== 0 ? money(Math.abs(liveDiff)) : ""}
                </p>
              )}
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                placeholder="Note (optional): e.g. ₹200 petty cash taken for milk"
                className={`${inputClass} font-medium text-[13px]`}
              />
              <div className="flex gap-2">
                <button type="button" className={btnGhost} onClick={() => setClosing(false)}>
                  Back
                </button>
                <button
                  type="button"
                  className={btnPrimary.replace("h-[44px]", "h-[40px]")}
                  disabled={!countedOk || closeMut.isPending}
                  onClick={() => protectedRun(() => closeMut.mutate({ closingCash: counted, note }))}
                >
                  {closeMut.isPending ? "Closing…" : "Close shift & print Z report"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5">
          <h4 className="text-[15px] font-extrabold text-[#0F172A] mb-3">Past shifts</h4>
          <div className="space-y-2">
            {history.map((h) => (
              <details key={h._id} className="rounded-xl border border-[#E2E8F0] p-3">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="font-bold text-[#0F172A]">
                    {when(h.openedAt)} → {when(h.closedAt)}
                  </span>
                  <span className="text-[#475569]">
                    {h.summary?.orders || 0} orders · {money(h.summary?.sales)} ·{" "}
                    <span className={`font-bold ${Number(h.summary?.difference) < 0 ? "text-[#DC2626]" : "text-[#16A34A]"}`}>
                      {Number(h.summary?.difference) > 0 ? "+" : ""}
                      {money(h.summary?.difference)}
                    </span>
                  </span>
                </summary>
                <div className="mt-3">
                  <Figures s={h.summary} openingCash={h.openingCash} closingCash={h.closingCash} />
                  {h.note && <p className="mt-2 text-[12.5px] text-[#64748B]">Note: {h.note}</p>}
                  <p className="mt-1 text-[12px] text-[#94A3B8]">
                    Opened by {h.openedBy || "-"} · closed by {h.closedBy || "-"}
                  </p>
                  <button type="button" className={`${btnGhost} mt-3`} onClick={() => printHtmlDocument(zReportHtml(h, store))}>
                    Print Z report
                  </button>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      <SecurityPinModal
        isOpen={Boolean(pinFor)}
        onClose={() => setPinFor(null)}
        onSuccess={() => {
          const fn = pinFor;
          setPinFor(null);
          if (fn) fn();
        }}
        title="Shift change requires authorization"
        actionLabel="Continue"
      />
    </div>
  );
};

export default ShiftView;
