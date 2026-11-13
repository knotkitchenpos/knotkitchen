import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MdDownload, MdWarningAmber, MdTableChart, MdDataObject, MdReceiptLong, MdExpandMore } from "react-icons/md";
import { enqueueSnackbar } from "../../utils/notify";
import { saveBlob } from "../../utils/saveImage";
import { inr, localDay } from "../../utils";
import { partnersApi, errorMessage } from "../api";
import { useActiveStore } from "../PartnersApp";
import { StorePicker } from "../components/Filters";

/**
 * Accountant exports (owner, 2026-11-13): one store's bills for a month as a
 * GSTR-1 workbook (the GST offline tool's sheets) and JSON, and a Tally
 * import, so the accountant stops retyping figures. The server builds them
 * (pos-backend services/accountantExports.js); this page picks the store and
 * period, shows the figures and checks first, and downloads.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The last 15 months, newest first: { key: "2026-10", label, from, to } (to capped at today). */
const recentMonths = () => {
  const today = localDay();
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const out = [];
  for (let i = 0; i < 15; i += 1) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const end = `${key}-${String(last).padStart(2, "0")}`;
    out.push({ key, label: `${MONTHS[m - 1]} ${y}${i === 0 ? " (so far)" : ""}`, from: `${key}-01`, to: end > today ? today : end });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
};

const LEDGER_FIELDS = [
  ["sales", "Sales (taxed)", "Sales @ {rate}% GST"],
  ["salesNoGst", "Sales (no GST)", "Sales (No GST)"],
  ["cgst", "Output CGST", "Output CGST @ {half}%"],
  ["sgst", "Output SGST", "Output SGST @ {half}%"],
  ["serviceCharge", "Service charge", "Service Charges"],
  ["deliveryFee", "Delivery fee", "Delivery Charges"],
  ["cash", "Cash", "Cash"],
  ["upi", "UPI", "UPI Collections"],
  ["card", "Card", "Card Collections"],
  ["gateway", "Online payments", "Online Payments"],
  ["other", "Not yet paid", "Sales Pending Collection"],
  ["roundOff", "Round off", "Round Off"],
];

const ledgerKey = (storeId) => `kk.partners.tallyLedgers.${storeId}`;
const loadLedgers = (storeId) => {
  try {
    return JSON.parse(localStorage.getItem(ledgerKey(storeId)) || "{}") || {};
  } catch {
    return {};
  }
};

const Figure = ({ label, value, strong }) => (
  <div className="min-w-0">
    <p className="text-[11.5px] font-bold uppercase tracking-wide text-[#64748B]">{label}</p>
    <p className={`mt-0.5 ${strong ? "text-[20px]" : "text-[16px]"} font-extrabold text-[#0F172A] break-words`}>{value}</p>
  </div>
);

const DownloadCard = ({ Icon, title, text, button, onClick, busy, disabled, note, children }) => (
  <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 flex flex-col">
    <div className="flex items-start gap-3">
      <span className="w-10 h-10 rounded-xl bg-[#FFF1E8] text-[#C2410C] flex items-center justify-center shrink-0">
        <Icon size={21} />
      </span>
      <div className="min-w-0">
        <h2 className="text-[15px] font-extrabold">{title}</h2>
        <p className="text-[12.5px] text-[#64748B] mt-0.5">{text}</p>
      </div>
    </div>
    {children}
    <div className="mt-auto pt-4">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        className="w-full h-11 rounded-xl bg-[#0F172A] text-white text-[14px] font-extrabold inline-flex items-center justify-center gap-2 hover:bg-[#1E293B] disabled:opacity-40"
      >
        <MdDownload size={18} /> {busy ? "Preparing…" : button}
      </button>
      {note && <p className="mt-2 text-[11.5px] text-[#94A3B8]">{note}</p>}
    </div>
  </div>
);

const Exports = ({ me }) => {
  const { current, usable, choose } = useActiveStore(me?.stores);
  const months = useMemo(recentMonths, []);
  // Accountants file last month's return: that is the default.
  const [monthKey, setMonthKey] = useState(months[1].key);
  const [custom, setCustom] = useState({ from: months[1].from, to: months[1].to });
  const period = monthKey === "custom" ? custom : months.find((m) => m.key === monthKey) || months[1];
  const params = { from: period.from, to: period.to };
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(params.from || "") && /^\d{4}-\d{2}-\d{2}$/.test(params.to || "") && params.from <= params.to;
  const oneMonth = valid && params.from.slice(0, 7) === params.to.slice(0, 7);

  const [mode, setMode] = useState("bill");
  const [ledgers, setLedgers] = useState({});
  const [showLedgers, setShowLedgers] = useState(false);
  useEffect(() => {
    if (current) setLedgers(loadLedgers(current.storeId));
  }, [current]);
  const setLedger = (k, v) => {
    const next = { ...ledgers, [k]: v };
    setLedgers(next);
    try {
      localStorage.setItem(ledgerKey(current.storeId), JSON.stringify(next));
    } catch {
      /* private mode: kept for this visit */
    }
  };

  const { data: sum, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["partner-export-summary", current?.storeId, params.from, params.to],
    queryFn: () => partnersApi.exportSummary(current.storeId, params).then((r) => r.data.data),
    enabled: Boolean(current && valid),
  });

  const [busy, setBusy] = useState("");
  const download = async (file, extra = {}) => {
    setBusy(file);
    try {
      const res = await partnersApi.exportFile(current.storeId, file, { ...params, ...extra });
      const name = /filename="([^"]+)"/.exec(res.headers?.["content-disposition"] || "")?.[1] || `${current.storeId}-${params.from}-to-${params.to}-${file}`;
      await saveBlob(res.data, name);
      enqueueSnackbar(`${name} downloaded.`, { variant: "success", important: true });
    } catch (err) {
      enqueueSnackbar(errorMessage(err, "Could not prepare the file."), { variant: "error" });
    } finally {
      setBusy("");
    }
  };

  if (!current) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-8 text-center">
        <p className="text-[15px] font-bold">No store to export.</p>
        <p className="text-[13px] text-[#64748B] mt-1">
          Confirm your stores&apos; links on the <Link to="/stores" className="underline font-bold">Stores</Link> page.
        </p>
      </div>
    );
  }

  const registered = Boolean(sum?.store?.gstin);
  const t = sum?.totals;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">Accountant exports</h1>
        <p className="text-[13px] text-[#64748B] mt-0.5">GST-ready sales for GSTR-1, and a Tally import. One store and period at a time.</p>
      </div>

      <StorePicker usable={usable} current={current} onChoose={choose} />

      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-3 sm:p-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-3 min-w-0">
          <span className="text-[13px] font-bold text-[#64748B] shrink-0">Period</span>
          <select value={monthKey} onChange={(e) => setMonthKey(e.target.value)} className="h-11 min-w-0 px-3 rounded-xl border border-[#E2E8F0] bg-white text-[14px] font-bold">
            {months.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
            <option value="custom">Custom dates…</option>
          </select>
        </label>
        {monthKey === "custom" && (
          <div className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-[#334155]">
            <input type="date" max={localDay()} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="h-11 px-2.5 rounded-xl border border-[#E2E8F0]" aria-label="From" />
            <span>to</span>
            <input type="date" max={localDay()} min={custom.from} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="h-11 px-2.5 rounded-xl border border-[#E2E8F0]" aria-label="To" />
          </div>
        )}
        {isFetching && !isLoading && <span className="text-[12px] text-[#94A3B8]">Updating…</span>}
      </div>

      {/* The figures first, so the owner sees what the accountant will get. */}
      {isError ? (
        <p className="text-[14px] font-bold text-[#B91C1C]">{errorMessage(error, "Could not read the period's bills.")}</p>
      ) : isLoading || !sum ? (
        <div className="h-32 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      ) : (
        <section className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-extrabold">{sum.store.name}</h2>
            <p className="text-[12.5px] font-bold text-[#64748B]">{registered ? `GSTIN ${sum.store.gstin} · ${sum.store.posLabel}` : "Not GST registered"}</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Figure label="Taxable value" value={inr(t.taxable)} strong />
            <Figure label="CGST" value={inr(t.cgst)} strong />
            <Figure label="SGST" value={inr(t.sgst)} strong />
            <Figure label="Bill value" value={inr(t.value)} strong />
            <Figure label="Bills" value={t.bills.toLocaleString("en-IN")} />
            <Figure label="B2B bills" value={`${sum.b2b.count}`} />
            <Figure label="Swiggy / Zomato" value={`${(sum.eco || []).reduce((s, r) => s + r.count, 0)} bills`} />
            <Figure label="Charges without GST" value={inr(t.untaxed)} />
          </div>
          {sum.b2cs?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11.5px] uppercase tracking-wide text-[#64748B]">
                    <th className="py-1.5 font-bold">B2C at</th>
                    <th className="py-1.5 font-bold text-right">Bills</th>
                    <th className="py-1.5 font-bold text-right">Taxable</th>
                    <th className="py-1.5 font-bold text-right">CGST</th>
                    <th className="py-1.5 font-bold text-right">SGST</th>
                  </tr>
                </thead>
                <tbody>
                  {sum.b2cs.map((r) => (
                    <tr key={r.rate} className="border-t border-[#F1F5F9]">
                      <td className="py-2 font-bold">{r.rate}% GST</td>
                      <td className="py-2 text-right">{r.count}</td>
                      <td className="py-2 text-right">{inr(r.taxable)}</td>
                      <td className="py-2 text-right">{inr(r.cgst)}</td>
                      <td className="py-2 text-right">{inr(r.sgst)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sum.warnings?.length > 0 && (
            <ul className="space-y-1.5">
              {sum.warnings.map((w) => (
                <li key={w} className="flex gap-2 text-[12.5px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-3 py-2">
                  <MdWarningAmber size={17} className="shrink-0 mt-[1px]" /> <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DownloadCard
          Icon={MdTableChart}
          title="GSTR-1 workbook"
          text="Excel with the GST offline tool's sheets (b2b, b2cs, hsn, docs), a summary, the Swiggy / Zomato bills apart, and every bill."
          button="Download Excel"
          busy={busy === "gstr1.xlsx"}
          disabled={!valid}
          onClick={() => download("gstr1.xlsx")}
          note="Open in Excel, or copy the sheets into the offline tool."
        />
        <DownloadCard
          Icon={MdDataObject}
          title="GSTR-1 JSON"
          text="For the GST offline tool or the portal's upload. One month at a time."
          button="Download JSON"
          busy={busy === "gstr1.json"}
          disabled={!valid || !registered || !oneMonth}
          onClick={() => download("gstr1.json")}
          note={!registered ? "The store has no GST number in Store Properties." : !oneMonth ? "Choose a single month." : "Check it in the offline tool before filing."}
        />
        <DownloadCard
          Icon={MdReceiptLong}
          title="Tally import"
          text="Sales vouchers with GST, and the ledgers they need. Tally: Import → Vouchers, then pick this file."
          button="Download Tally XML"
          busy={busy === "tally.xml"}
          disabled={!valid}
          onClick={() => download("tally.xml", { mode, ledgers: JSON.stringify(ledgers) })}
          note="Business (B2B) bills always come as their own voucher, with the buyer's ledger and GSTIN."
        >
          <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Vouchers">
            {[
              ["bill", "One per bill"],
              ["day", "One per day"],
            ].map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={mode === k}
                onClick={() => setMode(k)}
                className={`h-10 rounded-xl border text-[13px] font-bold ${mode === k ? "border-[#FD5302] bg-[#FFF6F0] text-[#C2410C]" : "border-[#E2E8F0] text-[#334155]"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setShowLedgers((v) => !v)} className="mt-3 text-[12.5px] font-bold text-[#C2410C] inline-flex items-center gap-1" aria-expanded={showLedgers}>
            Ledger names <MdExpandMore size={18} className={`transition-transform ${showLedgers ? "rotate-180" : ""}`} />
          </button>
          {showLedgers && (
            <div className="mt-2 space-y-2">
              <p className="text-[11.5px] text-[#94A3B8]">Match your Tally company. {"{rate}"} becomes the GST rate, {"{half}"} half of it. Saved on this device for this store.</p>
              {LEDGER_FIELDS.map(([k, label, def]) => (
                <label key={k} className="grid grid-cols-[110px_1fr] items-center gap-2 text-[12.5px]">
                  <span className="font-bold text-[#334155]">{label}</span>
                  <input
                    value={ledgers[k] ?? ""}
                    placeholder={def}
                    maxLength={80}
                    onChange={(e) => setLedger(k, e.target.value)}
                    className="h-9 min-w-0 px-2.5 rounded-lg border border-[#E2E8F0] text-[13px]"
                  />
                </label>
              ))}
            </div>
          )}
        </DownloadCard>
      </div>
    </div>
  );
};

export default Exports;
