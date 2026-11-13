import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { getBusinessBalance } from "../https";
import { isOwner } from "../utils/security";

/**
 * Billing & Subscription moved out of the POS into the owner's Partners
 * dashboard (owner, 2026-11-13). This route stays, so everything that sends
 * people here (the lock banner, a plan prompt, knotkitchen.com's Order
 * button with ?device=) now points them on to it, keeping the query.
 */
export const PARTNERS_URL = (
  import.meta.env.VITE_PARTNERS_URL ||
  (typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) ? "http://localhost:5176/partners" : "https://knotkitchen.com/partners")
).replace(/\/$/, "");

const BillingMoved = () => {
  const owner = isOwner(useSelector((s) => s.user));
  const { data } = useQuery({
    queryKey: ["billing-moved-balance"],
    queryFn: () => getBusinessBalance().then((r) => r.data?.data),
    retry: false,
  });
  const href = `${PARTNERS_URL}/billing${typeof window !== "undefined" ? window.location.search : ""}`;
  const locked = Boolean(data?.locked);
  return (
    <div className="h-full overflow-y-auto bg-[#F8FAFC] p-4 sm:p-6">
      <div className="max-w-[560px] mx-auto space-y-4">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 sm:p-7">
          <p className="text-[11.5px] font-extrabold uppercase tracking-[0.14em] text-[#FD5302]">Moved</p>
          <h1 className="mt-1 text-[20px] sm:text-[22px] font-extrabold text-[#0F172A]">Billing is on the Partners dashboard</h1>
          <p className="mt-2 text-[13.5px] text-[#475569]">
            Wallet top-ups, your plan and add-ons, tablets, printers and invoices are now managed by the store owner at{" "}
            <strong>knotkitchen.com/partners</strong>, together with sales across all their stores.
          </p>
          {data?.balance && (
            <p className="mt-4 text-[13px] text-[#334155]">
              Wallet balance: <strong>{data.balance.label || data.balance}</strong>
            </p>
          )}
          {locked && (
            <p className="mt-3 text-[13px] font-bold text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-xl px-3 py-2.5">
              This POS is locked. It unlocks by itself once the wallet is recharged on the Partners dashboard.
            </p>
          )}
          {owner ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex h-12 items-center px-5 rounded-xl bg-[#FD5302] text-white text-[15px] font-extrabold hover:bg-[#D64502]"
            >
              Open the Partners dashboard
            </a>
          ) : (
            <p className="mt-5 text-[13px] font-bold text-[#334155]">Ask the store owner to open it: they sign in with the store&apos;s Owner login.</p>
          )}
          <p className="mt-3 text-[12px] text-[#94A3B8]">Sign in there with this store&apos;s Store ID, Owner phone and password.</p>
        </div>
      </div>
    </div>
  );
};

export default BillingMoved;
