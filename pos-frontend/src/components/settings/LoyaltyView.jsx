import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "../../utils/notify";
import { getLoyaltySettings, saveLoyaltySettings } from "../../https";

/**
 * Loyalty points settings (owner, 2026-11-17; pos-backend services/loyalty.js).
 * Customers earn on every paid bill with their phone and spend points as a
 * discount at counter checkout (the Discount button).
 */
const Num = ({ label, hint, value, onChange, step = "1" }) => (
  <label className="block">
    <span className="text-[12.5px] font-bold text-[#334155]">{label}</span>
    <input type="number" step={step} min="0" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-11 w-full px-3 rounded-xl border border-[#E2E8F0] text-[14px]" />
    {hint && <span className="mt-1 block text-[11.5px] text-[#64748B]">{hint}</span>}
  </label>
);

const LoyaltyView = () => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["loyalty-settings"], queryFn: () => getLoyaltySettings().then((r) => r.data.data) });
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (data) setForm({ ...data });
  }, [data]);
  const save = useMutation({
    mutationFn: (body) => saveLoyaltySettings(body),
    onSuccess: (r) => {
      qc.setQueryData(["loyalty-settings"], r.data.data);
      enqueueSnackbar("Loyalty settings saved.", { variant: "success" });
    },
    onError: (e) => enqueueSnackbar(e?.response?.data?.message || "Could not save.", { variant: "error" }),
  });
  if (isLoading || !form) return <div className="h-40 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const example = Math.floor((500 / 100) * (Number(form.earnPer100) || 0));

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-5 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[16px] font-extrabold text-[#0F172A]">Loyalty points</h3>
          <p className="text-[12.5px] text-[#64748B] mt-0.5">
            Customers earn points on every paid bill with their phone number and use them as a discount at the counter (Discount → Loyalty points).
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.enabled}
          aria-label="Loyalty points"
          onClick={() => set("enabled")(!form.enabled)}
          className={`shrink-0 w-12 h-7 rounded-full relative transition-colors ${form.enabled ? "bg-[#16A34A]" : "bg-[#CBD5E1]"}`}
        >
          <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${form.enabled ? "left-6" : "left-1"}`} />
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Num label="Points per ₹100 paid" value={form.earnPer100} onChange={set("earnPer100")} step="0.5" hint={`A ₹500 bill earns ${example} point${example === 1 ? "" : "s"}.`} />
        <Num label="₹ off per point" value={form.pointValue} onChange={set("pointValue")} step="0.25" hint={`100 points = ₹${Math.round(100 * (Number(form.pointValue) || 0) * 100) / 100} off.`} />
        <Num label="Points needed to redeem" value={form.minRedeem} onChange={set("minRedeem")} />
        <Num label="Points expire after (months of no visits)" value={form.expiryMonths} onChange={set("expiryMonths")} hint="0 = never expire." />
      </div>
      <p className="text-[11.5px] text-[#64748B]">
        Customers get a WhatsApp message with their balance after each bill once KnotKitchen has that message approved. A cancelled order takes back its points.
      </p>
      <button type="button" disabled={save.isPending} onClick={() => save.mutate(form)} className="h-11 px-6 rounded-xl bg-[#FD5302] text-white text-[14px] font-extrabold disabled:opacity-50">
        {save.isPending ? "Saving…" : "Save"}
      </button>
    </div>
  );
};

export default LoyaltyView;
