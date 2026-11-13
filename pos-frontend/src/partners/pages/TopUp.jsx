import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MdAccountBalanceWallet, MdLock } from "react-icons/md";
import { enqueueSnackbar } from "../../utils/notify";
import { loadCashfree } from "../../utils/cashfree";
import { inr } from "../../utils";
import { partnersApi, errorMessage } from "../api";

/**
 * Top up stores (owner, 2026-11-13): one payment shared across several
 * stores' wallets. Each store's share must meet that store's own minimum;
 * the server checks again, asks Cashfree once paid, and credits each store
 * its share (pos-backend services/recharge SPLIT).
 */

const rupees = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

const TopUp = () => {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["partner-topup-stores"],
    queryFn: () => partnersApi.topUpStores().then((r) => r.data.data.stores),
  });
  const stores = useMemo(() => data || [], [data]);
  const [amounts, setAmounts] = useState({});
  const [equal, setEqual] = useState("");
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState(null);

  const usable = stores.filter((s) => s.usable);
  const lines = usable.map((s) => ({ ...s, amount: rupees(amounts[s.storeId]) })).filter((s) => s.amount > 0);
  const total = lines.reduce((t, s) => t + s.amount, 0);
  const short = lines.filter((s) => s.amount < (s.minimum || 0));

  const settle = async (gatewayOrderId) => {
    const r = (await partnersApi.verifyTopUp(gatewayOrderId)).data.data;
    if (r.credited || r.already) {
      setDone(r.stores);
      setAmounts({});
      qc.invalidateQueries({ queryKey: ["partner-topup-stores"] });
      qc.invalidateQueries({ queryKey: ["partner-me"] });
      enqueueSnackbar("Balance added to each store.", { variant: "success", important: true });
    } else {
      enqueueSnackbar(r.reason || "That payment has not completed.", { variant: "warning" });
    }
  };

  // Back from Cashfree's full-page checkout (narrow screens): ?paid=<order id>.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("paid");
    if (!id) return;
    window.history.replaceState(null, "", window.location.pathname);
    settle(id).catch(() => enqueueSnackbar("The payment could not be checked yet. It is added by itself once Cashfree confirms.", { variant: "warning" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const splitEqually = () => {
    const sum = rupees(equal);
    const chosen = usable.filter((s) => rupees(amounts[s.storeId]) > 0 || !Object.values(amounts).some((v) => rupees(v) > 0));
    if (!sum || !chosen.length) return;
    const each = Math.floor((sum / chosen.length) * 100) / 100;
    const next = {};
    chosen.forEach((s, i) => {
      next[s.storeId] = String(i === chosen.length - 1 ? Math.round((sum - each * (chosen.length - 1)) * 100) / 100 : each);
    });
    setAmounts(next);
  };

  const pay = async () => {
    setPaying(true);
    try {
      const opened = (
        await partnersApi.topUp({
          splits: lines.map((s) => ({ storeId: s.storeId, amount: s.amount })),
          returnUrl: `${window.location.origin}/partners/topup?paid={order_id}`,
        })
      ).data.data;
      const Cashfree = await loadCashfree();
      if (!Cashfree) throw new Error("The payment page could not be loaded. Check your connection.");
      const cashfree = Cashfree({ mode: opened.environment === "PROD" ? "production" : "sandbox" });
      const result = await cashfree.checkout({ paymentSessionId: opened.paymentSessionId, redirectTarget: "_modal" });
      if (result?.redirect) return; // the ?paid= return settles it
      await settle(opened.gatewayOrderId);
    } catch (err) {
      enqueueSnackbar(errorMessage(err, err?.message || "The top-up could not be completed."), { variant: "error" });
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">Top up stores</h1>
        <p className="text-[13px] text-[#64748B] mt-0.5">One payment, shared across your stores&apos; wallets. Each store gets exactly its share, shown as a top-up in its own Billing statement.</p>
      </div>

      {done && (
        <section className="rounded-2xl border border-[#BBF7D0] bg-[#F0FDF4] p-4">
          <p className="text-[14px] font-extrabold text-[#166534]">Added</p>
          <ul className="mt-2 space-y-1 text-[13px] text-[#14532D]">
            {done.map((s) => (
              <li key={s.storeId}>
                <strong>{s.name}</strong>: +{s.amount.label} · wallet now {s.balance.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      {isError ? (
        <p className="text-[14px] font-bold text-[#B91C1C]">{errorMessage(error, "Could not load your stores.")}</p>
      ) : isLoading ? (
        <div className="h-40 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      ) : (
        <section className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block flex-1 min-w-[160px]">
              <span className="text-[12.5px] font-bold text-[#334155]">Share an amount equally</span>
              <input inputMode="decimal" value={equal} onChange={(e) => setEqual(e.target.value)} placeholder="₹ total" className="mt-1 h-11 w-full px-3 rounded-xl border border-[#E2E8F0]" />
            </label>
            <button type="button" onClick={splitEqually} disabled={!rupees(equal)} className="h-11 px-4 rounded-xl border border-[#E2E8F0] text-[13px] font-bold text-[#334155] disabled:opacity-40">
              Split
            </button>
          </div>
          <p className="text-[11.5px] text-[#94A3B8] -mt-2">Splits across the stores you have entered an amount for, or across all of them.</p>

          <ul className="divide-y divide-[#F1F5F9]">
            {stores.map((s) => {
              const v = amounts[s.storeId] ?? "";
              const under = rupees(v) > 0 && rupees(v) < (s.minimum || 0);
              return (
                <li key={s.storeId} className="py-3 flex flex-wrap items-center gap-3">
                  <MdAccountBalanceWallet className="text-[#94A3B8] shrink-0" size={20} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-bold truncate">
                      {s.name} {s.locked && <MdLock className="inline -mt-0.5 text-[#B91C1C]" size={14} aria-label="Locked" />}
                    </span>
                    <span className="block text-[12px] text-[#64748B]">
                      Wallet {s.wallet?.label}
                      {s.usable ? ` · minimum ${inr(s.minimum)}${s.first ? " (starts the plan)" : ""}` : ` · ${s.reason}`}
                    </span>
                    {under && <span className="block text-[11.5px] font-bold text-[#B91C1C]">Below this store&apos;s minimum.</span>}
                  </span>
                  <input
                    inputMode="decimal"
                    aria-label={`Amount for ${s.name}`}
                    disabled={!s.usable}
                    value={v}
                    onChange={(e) => setAmounts((a) => ({ ...a, [s.storeId]: e.target.value }))}
                    placeholder="₹ 0"
                    className={`h-11 w-32 px-3 rounded-xl border text-right font-bold ${under ? "border-[#FCA5A5]" : "border-[#E2E8F0]"} disabled:bg-[#F8FAFC]`}
                  />
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] pt-4">
            <span className="text-[14px]">
              Total <strong className="text-[18px]">{inr(total)}</strong>
              <span className="text-[12px] text-[#64748B]"> · {lines.length} store{lines.length === 1 ? "" : "s"}</span>
            </span>
            <button type="button" onClick={pay} disabled={!lines.length || short.length > 0 || paying} className="h-11 px-6 rounded-xl bg-[#FD5302] text-white text-[14px] font-extrabold disabled:opacity-40">
              {paying ? "Opening payment…" : "Pay"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

export default TopUp;
