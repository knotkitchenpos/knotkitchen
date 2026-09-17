import React, { useState } from "react";

/**
 * Complete Order → how was this table paid?
 *
 * The POS had no way to settle a table session at all: there was no client
 * wrapper for the payment endpoint, so a table order could be taken but never
 * finished. The session stayed open, which meant the table never entered its
 * cooldown, never became available again, and the QR kept showing the next
 * customer the previous one's order.
 *
 * Only counter methods are offered here. ONLINE and PAYMENT_LINK settle
 * somewhere else and asynchronously, so presenting them as a button the
 * operator can press would let them mark a table paid before any money moved.
 */

const METHODS = [
  {
    id: "CASH",
    label: "Cash",
    hint: "Taken at the counter",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="3" />
        <path d="M6 10v.01M18 14v.01" />
      </svg>
    ),
  },
  {
    id: "UPI",
    label: "UPI",
    hint: "GPay, PhonePe, Paytm",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2.5" />
        <path d="M11 18h2" />
        <path d="M9.5 9.5l2.5 3 2.5-4" />
      </svg>
    ),
  },
  {
    id: "CARD",
    label: "Card",
    hint: "Debit or credit machine",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20M6 15h4" />
      </svg>
    ),
  },
];

const money = (n) => `₹${Number(n || 0).toFixed(2)}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const TableSettleModal = ({ table, session, busy, onClose, onConfirm }) => {
  const [method, setMethod] = useState("CASH");
  const bills = session?.bills || {};
  const payable = Number(bills.totalWithTax || 0);

  // Split: several counter methods adding up to the bill. Editing one part
  // leaves the last part to absorb the remainder, so the sum always works.
  const [split, setSplit] = useState(false);
  const [parts, setParts] = useState([
    { method: "CASH", amount: "" },
    { method: "UPI", amount: "" },
  ]);
  // A tip is on top of the bill; the buyer turns the receipt into a GST bill.
  const [tip, setTip] = useState("");
  const tipAmt = Math.max(0, round2(tip));
  const guests = Math.max(1, Number(session?.customerCount) || 1);
  const perHead = round2(payable / guests);
  const grand = round2(payable + tipAmt);
  const partsSum = round2(parts.reduce((t, p) => t + (Number(p.amount) || 0), 0));
  const splitOk = parts.length >= 2 && parts.every((p) => Number(p.amount) > 0) && Math.abs(partsSum - grand) < 0.01;
  const setPart = (i, patch) =>
    setParts((prev) => {
      const next = prev.map((p, k) => (k === i ? { ...p, ...patch } : p));
      // Keep the last part as "the rest" when an earlier amount changes.
      if (patch.amount !== undefined && i < next.length - 1) {
        const others = next.slice(0, -1).reduce((t, p) => t + (Number(p.amount) || 0), 0);
        next[next.length - 1] = { ...next[next.length - 1], amount: String(Math.max(0, round2(grand - others))) };
      }
      return next;
    });

  // A table order had no way to send an e-bill at all. The only button lived
  // in the counter invoice, which is never rendered for a table session -- so
  // every QR order, which is exactly where a phone number IS on file, could
  // never be sent one.
  const phone = String(session?.customerPhone || "").trim();
  const [alsoEBill, setAlsoEBill] = useState(true);

  const label = table?.displayId || table?.tableName || `Table ${table?.tableNumber ?? "?"}`;
  const chosen = METHODS.find((m) => m.id === method);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#C2410C]">
              Complete Order
            </p>
            <h3 className="text-[17px] font-extrabold text-[#0F172A] truncate">{label}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#475569] text-2xl leading-none shrink-0"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Bill, so the amount is confirmed before it is marked paid. */}
          <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 space-y-1 text-[13px]">
            <div className="flex justify-between text-[#475569]">
              <span>Subtotal</span>
              <span className="font-bold tabular-nums">{money(bills.subtotal)}</span>
            </div>
            {Number(bills.discount) > 0 && (
              <div className="flex justify-between text-[#475569]">
                <span>Discount</span>
                <span className="font-bold tabular-nums">−{money(bills.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-[#475569]">
              <span>Tax</span>
              <span className="font-bold tabular-nums">{money(bills.tax)}</span>
            </div>
            {Number(bills.charges) > 0 && (
              <div className="flex justify-between text-[#475569]">
                <span>{Number(bills.serviceCharge) > 0 ? "Service charge" : "Charges"}</span>
                <span className="font-bold tabular-nums">{money(bills.charges)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 mt-1 border-t border-[#E2E8F0] text-[15px] text-[#0F172A]">
              <span className="font-extrabold">Payable</span>
              <span className="font-extrabold tabular-nums">{money(payable)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 pt-1 text-[#475569]">
              <label htmlFor="settle-tip" className="text-[12.5px]">
                Tip (optional)
              </label>
              <input
                id="settle-tip"
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={tip}
                onChange={(e) => setTip(e.target.value)}
                placeholder="0"
                className="h-[34px] w-[110px] rounded-lg border border-[#E2E8F0] bg-white px-2 text-right text-[13px] font-bold tabular-nums"
              />
            </div>
            {tipAmt > 0 && (
              <div className="flex justify-between text-[14px] text-[#0F172A]">
                <span className="font-bold">To collect</span>
                <span className="font-extrabold tabular-nums">{money(grand)}</span>
              </div>
            )}
          </div>

          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#64748B] mb-2">
              Payment method
            </p>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((m) => {
                const on = m.id === method;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    aria-pressed={on}
                    className={`rounded-xl border p-3 flex flex-col items-center gap-1.5 transition-colors ${
                      on
                        ? "border-[#FD5302] bg-[#FFF1E8] text-[#C2410C]"
                        : "border-[#E2E8F0] bg-white text-[#475569] hover:border-[#CBD5E1]"
                    }`}
                  >
                    {m.icon}
                    <span className="text-[13px] font-extrabold">{m.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11.5px] text-[#94A3B8]">{chosen?.hint}</p>

            <button
              type="button"
              onClick={() => setSplit((v) => !v)}
              className={`mt-3 h-[36px] w-full rounded-xl border text-[12.5px] font-bold ${
                split ? "border-[#FD5302] bg-[#FFF1E8] text-[#C2410C]" : "border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]"
              }`}
            >
              {split ? "Paying with one method instead" : "Split the bill between methods"}
            </button>
            {split && (
              <div className="mt-2 space-y-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                {guests > 1 && (
                  <p className="text-[11.5px] text-[#64748B]">
                    {guests} guests · {money(perHead)} each if shared equally.
                  </p>
                )}
                {parts.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={p.method}
                      onChange={(e) => setPart(i, { method: e.target.value })}
                      className="h-[40px] rounded-lg border border-[#E2E8F0] bg-white px-2 text-[12.5px] font-bold"
                    >
                      {METHODS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={p.amount}
                      placeholder="0.00"
                      onChange={(e) => setPart(i, { amount: e.target.value })}
                      className="h-[40px] flex-1 rounded-lg border border-[#E2E8F0] bg-white px-3 text-[13px] font-bold tabular-nums"
                    />
                    {parts.length > 2 && (
                      <button
                        type="button"
                        aria-label="Remove part"
                        onClick={() => setParts((prev) => prev.filter((_, k) => k !== i))}
                        className="h-[40px] w-[36px] rounded-lg border border-[#E2E8F0] bg-white text-[#94A3B8] hover:text-[#DC2626]"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between text-[12px]">
                  <button
                    type="button"
                    disabled={parts.length >= 6}
                    onClick={() => setParts((prev) => [...prev, { method: "CARD", amount: "" }])}
                    className="font-bold text-[#C2410C] hover:underline disabled:opacity-40"
                  >
                    + Add a part
                  </button>
                  <span className={`font-bold tabular-nums ${splitOk ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                    {money(partsSum)} of {money(grand)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* E-bill. Offered only when there is somewhere to send it — an
              unticked box next to "no phone on file" just reads as broken. */}
          {phone ? (
            <label className="flex items-start gap-2.5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3.5 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={alsoEBill}
                onChange={(e) => setAlsoEBill(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#FD5302]"
              />
              <span className="text-[12.5px] leading-snug">
                <span className="font-bold text-[#0F172A]">Send the e-bill</span>
                <span className="text-[#64748B]"> to {phone} on WhatsApp</span>
              </span>
            </label>
          ) : (
            <p className="text-[11.5px] text-[#94A3B8] px-1">
              No phone number on this session, so no e-bill can be sent.
            </p>
          )}

          {payable <= 0 && (
            <p className="text-[12.5px] font-bold text-[#B45309] bg-[#FEF3C7] border border-[#FDE68A] rounded-lg px-3 py-2">
              This session has nothing to pay yet. Add items before completing it.
            </p>
          )}
        </div>

        <div className="px-5 pb-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 h-[44px] rounded-xl border border-[#E2E8F0] text-[13px] font-bold text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onConfirm({
                method: split ? "SPLIT" : method,
                amount: grand,
                tip: tipAmt || undefined,
                splits: split ? parts.map((p) => ({ method: p.method, amount: round2(p.amount) })) : undefined,
                sendEBill: Boolean(phone && alsoEBill),
                phone,
              })
            }
            disabled={busy || payable <= 0 || (split && !splitOk)}
            className="flex-[2] h-[44px] rounded-xl bg-[#FD5302] text-white text-[13.5px] font-extrabold hover:bg-[#D64502] disabled:opacity-60"
          >
            {busy ? "Completing…" : `Mark Paid · ${money(grand)}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TableSettleModal;
