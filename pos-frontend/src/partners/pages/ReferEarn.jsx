import React from "react";
import { useQuery } from "@tanstack/react-query";
import { MdContentCopy, MdCardGiftcard } from "react-icons/md";
import { enqueueSnackbar } from "../../utils/notify";
import { dateGB } from "../../utils";
import { partnersApi, errorMessage } from "../api";

/**
 * Refer & earn (owner, 2026-11-17): each store's referral code and what it
 * has earned (pos-backend services/referrals.js). The new restaurant gives
 * the code to KnotKitchen when it signs up.
 */
const ReferEarn = () => {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["partner-referrals"],
    queryFn: () => partnersApi.referrals().then((r) => r.data.data),
  });
  const copy = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      enqueueSnackbar(`Copied ${code}`, { variant: "success" });
    } catch {
      enqueueSnackbar(code, { variant: "info" });
    }
  };
  const off = data && !(data.reward?.paise > 0);

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">Refer &amp; earn</h1>
        <p className="text-[13px] text-[#64748B] mt-0.5">
          {off
            ? "The referral programme is paused right now."
            : `Know a restaurant that should use KnotKitchen? Give them your code. When they sign up and make their first top-up, both of you get ${data?.reward?.label || "wallet credit"} in your wallet.`}
        </p>
      </div>
      {isError ? (
        <p className="text-[14px] font-bold text-[#B91C1C]">{errorMessage(error, "Could not load.")}</p>
      ) : isLoading ? (
        <div className="h-40 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      ) : (
        data.stores.map((s) => (
          <section key={s.storeId} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <MdCardGiftcard size={22} className="text-[#FD5302]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-extrabold">{s.name}</span>
                <span className="block text-[12px] text-[#64748B]">Referral code</span>
              </span>
              <span className="font-mono text-[18px] font-extrabold tracking-wider">{s.code}</span>
              <button type="button" onClick={() => copy(s.code)} className="h-9 px-3 rounded-lg border border-[#E2E8F0] text-[12.5px] font-bold text-[#334155] flex items-center gap-1.5">
                <MdContentCopy size={15} /> Copy
              </button>
            </div>
            {s.referrals.length === 0 ? (
              <p className="text-[12.5px] text-[#94A3B8]">No referrals yet.</p>
            ) : (
              <ul className="divide-y divide-[#F1F5F9]">
                {s.referrals.map((r, i) => (
                  <li key={i} className="py-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <span>
                      <strong>{r.name}</strong> <span className="text-[#94A3B8]">· joined {dateGB(r.joinedAt)}</span>
                    </span>
                    <span className={r.earned ? "font-bold text-[#15803D]" : "text-[#B45309]"}>{r.earned ? `+${r.earned.label}` : r.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
};

export default ReferEarn;
