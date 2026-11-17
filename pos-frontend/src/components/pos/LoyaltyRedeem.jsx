import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLoyaltySettings, lookupLoyalty } from "../../https";
import { inputCls } from "./ModalShell";

/**
 * Use loyalty points as the bill's discount (owner, 2026-11-17). Shown in
 * the Discount window only when the store has loyalty on. The server checks
 * the balance again when the order is placed (pos-backend services/loyalty).
 */
const round2 = (n) => Math.round(n * 100) / 100;

const LoyaltyRedeem = ({ subtotal = 0, initialPhone = "", onUse }) => {
  const { data: settings } = useQuery({
    queryKey: ["loyalty-settings"],
    queryFn: () => getLoyaltySettings().then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });
  const [phone, setPhone] = useState(String(initialPhone || "").replace(/\D/g, "").slice(-10));
  const [found, setFound] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!settings?.enabled) return null;

  const check = async () => {
    setError("");
    setFound(null);
    if (!/^[6-9]\d{9}$/.test(phone)) {
      setError("Enter the customer's 10-digit mobile number.");
      return;
    }
    setBusy(true);
    try {
      setFound((await lookupLoyalty(phone)).data.data);
    } catch (err) {
      setError(err?.response?.data?.message || "Could not check the points.");
    } finally {
      setBusy(false);
    }
  };

  // As many points as the balance and the bill allow.
  const usable = found ? Math.min(found.points, Math.floor((Math.max(0, Number(subtotal) || 0) + 1e-9) / found.pointValue)) : 0;
  const enough = found && usable > 0 && usable >= found.minRedeem;

  return (
    <div className="mt-4 rounded-xl border border-[#E2E8F0] p-3">
      <p className="text-[13px] font-extrabold text-[#0F172A]">Loyalty points</p>
      <div className="mt-2 flex gap-2">
        <input
          className={`${inputCls(false)} flex-1`}
          inputMode="numeric"
          maxLength={10}
          placeholder="Customer phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
        />
        <button type="button" onClick={check} disabled={busy} className="h-[42px] px-4 rounded-xl border border-[#E2E8F0] text-[13px] font-bold text-[#334155] disabled:opacity-50">
          {busy ? "…" : "Check"}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] font-semibold text-[#B91C1C]">{error}</p>}
      {found && (
        <div className="mt-2 text-[12.5px] text-[#334155]">
          <p>
            <strong>{found.points}</strong> points (worth ₹{found.value}).
            {!enough && found.points > 0 && found.points < found.minRedeem ? ` ${found.minRedeem} needed to redeem.` : ""}
            {found.points === 0 ? " No points yet: this bill will earn some." : ""}
          </p>
          {enough && (
            <button
              type="button"
              onClick={() => onUse({ phone, points: usable, value: round2(usable * found.pointValue) })}
              className="mt-2 w-full h-[42px] rounded-xl bg-[#16A34A] text-white text-[13.5px] font-extrabold"
            >
              Use {usable} points (₹{round2(usable * found.pointValue)} off)
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default LoyaltyRedeem;
