import React, { useState } from "react";
import { inr as money } from "../../utils";

/**
 * Cancel: why (a preset is one tap; "Other" opens a text box). Nothing is
 * cancelled without a reason, because a void with no reason is how a till leaks.
 *
 * Refund (owner only, on a cancelled order): no reason asked, the cancel
 * reason is the note. How much: everything left by default, or any part of
 * it. The backend caps it at what is left whatever is sent.
 */
const REASONS = {
  cancel: ["Customer changed mind", "Wrong order punched", "Item not available", "Duplicate order", "Customer did not turn up"],
};

const ReasonModal = ({ kind, order, busy, onClose, onConfirm }) => {
  const refund = kind === "refund";
  const total = Number(order?.bills?.totalWithTax || order?.bills?.total || 0);
  // The backend decides the amount from the payment record; this only shows it.
  const refunded = Number(order?.refundedTotal) || 0;
  const left = Number(order?.refundableAmount) || 0;

  const [preset, setPreset] = useState("");
  const [other, setOther] = useState("");
  const [amountText, setAmountText] = useState(left ? left.toFixed(2) : "");

  const reason = (preset === "Other" ? other : preset).trim();
  const amount = Math.round(Number(amountText) * 100) / 100;
  const amountOk = Number.isFinite(amount) && amount > 0 && amount <= left + 0.005;
  const ok = !busy && (refund ? left > 0 && amountOk : reason.length >= 3);

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={refund ? "Refund order" : "Cancel order"}
      >
        <h3 className="text-[16px] font-extrabold text-[#0F172A]">{refund ? "Refund this order" : "Cancel this order"}</h3>
        <p className="mt-0.5 text-[12.5px] text-[#64748B]">
          #{order?.orderNumber || String(order?._id || "").slice(-6)}
          {refund ? ` · paid ${money(total)}${refunded ? `, ${money(refunded)} already refunded` : ""}` : ""}
        </p>
        {refund ? (
          <>
            <p className="mt-2 rounded-lg bg-[#F8FAFC] px-3 py-2 text-[12px] text-[#475569]">
              {order?.paymentKindLabel || "Gateway Payment"}: the amount goes back to the customer through Cashfree
              (5 to 7 working days). This cannot be undone.
            </p>
            <label className="mt-4 block text-[12.5px] font-bold text-[#475569]">
              Amount to refund (up to {money(left)})
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                max={left}
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                className="mt-1.5 h-[44px] w-full rounded-xl border border-[#E2E8F0] px-3 text-[15px] font-bold text-[#0F172A] outline-none focus:border-[#FD5302]"
              />
            </label>
            {amountText !== "" && !amountOk && (
              <p className="mt-1 text-[12px] font-bold text-[#DC2626]">Enter an amount between ₹0.01 and {money(left)}.</p>
            )}
          </>
        ) : (
          <>
        <p className="mt-4 text-[12.5px] font-bold text-[#475569]">Reason</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {[...REASONS.cancel, "Other"].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setPreset(r)}
              className={`h-[36px] rounded-full border px-3 text-[12.5px] font-bold ${
                preset === r ? "border-[#FD5302] bg-[#FFF1E8] text-[#C2410C]" : "border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        {preset === "Other" && (
          <textarea
            autoFocus
            value={other}
            onChange={(e) => setOther(e.target.value)}
            maxLength={200}
            placeholder="What happened?"
            className="mt-2 min-h-[72px] w-full rounded-xl border border-[#E2E8F0] p-3 text-[13.5px] outline-none focus:border-[#FD5302]"
          />
        )}
          </>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-[44px] flex-1 rounded-xl border border-[#E2E8F0] text-[13px] font-bold text-[#334155] hover:bg-[#F8FAFC]"
          >
            Back
          </button>
          <button
            type="button"
            disabled={!ok}
            onClick={() => onConfirm(refund ? { amount } : { reason })}
            className="h-[44px] flex-1 rounded-xl bg-[#DC2626] text-[13px] font-bold text-white hover:bg-[#B91C1C] disabled:opacity-40"
          >
            {busy ? "Working…" : refund ? `Refund ${amountOk ? money(amount) : ""}` : "Cancel order"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReasonModal;
