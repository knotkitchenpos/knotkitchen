import React, { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBusinessBalance, logout } from "../../https";
import { removeUser } from "../../redux/slices/userSlice";
import { clearActiveStoreId } from "../../utils/storeSession";

/**
 * Non-payment lock, on the POS side.
 *
 * The server decides (services/accountLock.js): a new store is locked until
 * its first recharge starts the POS plan; once the wallet (Business Balance)
 * has run out -- or order charges go unpaid, or the POS plan does not renew --
 * the restaurant has the grace period (24 hours) to pay. Locked, every staff API except Billing answers 402
 * ACCOUNT_LOCKED. Without this the POS just showed broken screens. Now:
 *
 *   during the grace period  a banner on every screen says when it locks
 *   locked                   every screen sends the user to Billing & Subscription
 */

// Help & Support makes no API calls, and a stuck owner should reach it.
export const LOCK_OPEN_PATHS = ["/settings/billing", "/support", "/auth", "/impersonate"];
export const LOCKED_EVENT = "kk:account-locked";

export const useAccountLock = (enabled) => {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["business-balance"],
    queryFn: getBusinessBalance,
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });

  // Any API call refused with ACCOUNT_LOCKED means the lock landed between
  // polls: look again straight away.
  useEffect(() => {
    const onLocked = () => qc.invalidateQueries({ queryKey: ["business-balance"] });
    window.addEventListener(LOCKED_EVENT, onLocked);
    return () => window.removeEventListener(LOCKED_EVENT, onLocked);
  }, [qc]);

  const data = query.data?.data?.data;
  return {
    locked: Boolean(enabled && data?.locked),
    locksAt: enabled && data?.locksAt ? new Date(data.locksAt) : null,
    lockWarning: data?.lockWarning || "",
  };
};

/** Send a locked restaurant to Billing from anywhere else. */
export const LockRedirect = () => {
  const { pathname } = useLocation();
  if (LOCK_OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return <Navigate to="/settings/billing" replace />;
};

const remaining = (at, now) => {
  const mins = Math.max(0, Math.round((at - now) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};

/** The grace-period warning, or the locked notice with a way to sign out. */
export const AccountLockBanner = ({ locked, locksAt, lockWarning }) => {
  const navigate = useNavigate();
  const onSupport = useLocation().pathname.startsWith("/support");
  const dispatch = useDispatch();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!locksAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [locksAt]);

  const signOut = useMutation({
    mutationFn: () => logout(),
    onSettled: () => {
      clearActiveStoreId();
      dispatch(removeUser());
      navigate("/auth");
    },
  });

  if (locked) {
    return (
      <div role="alert" className="shrink-0 flex flex-wrap items-center justify-between gap-2 bg-[#B91C1C] px-4 py-2.5 text-white">
        <p className="text-[13px] font-bold">
          The POS is locked. Only Billing &amp; Subscription is open: recharge the wallet there and it unlocks by itself.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate(onSupport ? "/settings/billing" : "/support")}
            className="h-[32px] rounded-lg border border-white/40 px-3 text-[12.5px] font-bold hover:bg-white/10"
          >
            {onSupport ? "Billing" : "Help"}
          </button>
          <button
            type="button"
            onClick={() => signOut.mutate()}
            className="h-[32px] rounded-lg border border-white/40 px-3 text-[12.5px] font-bold hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (!locksAt) return null;
  const at = locksAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div role="status" className="shrink-0 flex flex-wrap items-center justify-between gap-2 bg-[#FEF3C7] border-b border-[#FDE68A] px-4 py-2.5">
      <p className="text-[13px] font-semibold text-[#92400E]">
        {lockWarning || "Payment is due."} Pay within <strong>{remaining(locksAt, now)}</strong> (by {at}) or every
        POS feature except Billing will be locked.
      </p>
      <button
        type="button"
        onClick={() => navigate("/settings/billing")}
        className="h-[32px] rounded-lg bg-[#B45309] px-3 text-[12.5px] font-bold text-white hover:bg-[#92400E]"
      >
        Recharge now
      </button>
    </div>
  );
};
