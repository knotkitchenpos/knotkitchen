import React, { useState } from "react";

/**
 * Why an order is being cancelled or refunded, and for a refund, how much.
 *
 * A preset is one tap; "Other" opens a text box. Nothing goes through
 * without a reason, because a void with no reason is how a till leaks.
 */
const REASONS = {
  cancel: ["Customer changed mind", "Wrong order punched", "Item not available", "Duplicate order", "Customer did not turn up"],
  refund: ["Wrong item served", "Food quality complaint", "Order was late", "Overcharged", "Customer cancelled after paying"],
};

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const paidOnline = (o) => {
  const m = String(o?.payments?.[0]?.method || o?.paymentMethod || "").toLowerCase();
  return Boolean(o?.paymentData?.gatewayOrderId) || ["online", "payment gateway", "paymentlink", "link"].includes(m);
};

const ReasonModal = ({ kind, order, busy, onClose, onConfirm }) => {
  const refund = kind === "refund";
  const total = Number(order?.bills?.totalWithTax || order?.bills?.total || 0);
  const refunded = (order?.refunds || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const left = Math.max(0, Math.round((total - refunded) * 100) / 100);

  const [preset, setPreset] = useState("");
  const [other, setOther] = useState("");
  const [amount, setAmount] = useState(String(left));

  const reason = (preset === "Other" ? other : preset).trim();
  const amt = Number(amount);
  const amountOk = !refund || (amt > 0 && amt <= left);
  const ok = reason.length >= 3 && amountOk && !busy;

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
        {refund && (
          <p className="mt-2 rounded-lg bg-[#F8FAFC] px-3 py-2 text-[12px] text-[#475569]">
            {paidOnline(order)
              ? "Paid online: the amount goes back to the customer through Cashfree (5 to 7 working days)."
              : "Paid at the counter: hand the cash back to the customer; this records it."}
          </p>
        )}

        {refund && (
          <label className="mt-4 block">
            <span className="text-[12.5px] font-bold text-[#475569]">Amount to refund</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min="0.01"
                step="0.01"
                max={left}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-[44px] flex-1 rounded-xl border border-[#E2E8F0] px-3 text-[15px] font-bold text-[#0F172A] outline-none focus:border-[#FD5302]"
              />
              <button
                type="button"
                onClick={() => setAmount(String(left))}
                className="h-[44px] rounded-xl border border-[#E2E8F0] px-3 text-[12.5px] font-bold text-[#334155] hover:bg-[#F8FAFC]"
              >
                Full {money(left)}
              </button>
            </div>
            {!amountOk && <p className="mt-1 text-[12px] text-[#DC2626]">Between ₹0.01 and {money(left)}.</p>}
          </label>
        )}

        <p className="mt-4 text-[12.5px] font-bold text-[#475569]">Reason</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {[...REASONS[refund ? "refund" : "cancel"], "Other"].map((r) => (
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
            onClick={() => onConfirm({ reason, amount: refund ? amt : undefined })}
            className="h-[44px] flex-1 rounded-xl bg-[#DC2626] text-[13px] font-bold text-white hover:bg-[#B91C1C] disabled:opacity-40"
          >
            {busy ? "Working…" : refund ? `Refund ${amountOk ? money(amt) : ""}` : "Cancel order"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReasonModal;
