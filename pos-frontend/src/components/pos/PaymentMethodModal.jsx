import React, { useState } from "react";
import { ModalShell } from "./ModalShell";
import { money } from "../../utils";
import { mobileDigits } from "../../redux/slices/customerSlice";

/**
 * Finish Order → Payment Method chooser (Module 2 §5).
 *
 * Shown after the biller taps "Finish Order" (for Delivery, after the address).
 * Every method is money taken at the counter, so the order is created paid:
 *
 *   - Cash / UPI / Card → onSelect("cash" | "upi" | "card").
 *   - Split             → onSelect("split", [{ method: "CASH", amount }, ...]),
 *                         parts adding up to the total, as at table settle.
 *
 * The bill breakdown (subtotal, discount, tax, packaging, delivery, total)
 * is shown here as a final review — this is the operator's last chance to
 * sanity-check the total before the order is created.
 */

const IconCash = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="3" />
        <path d="M6 10v.01M18 14v.01" />
    </svg>
);
const IconQR = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1" />
    </svg>
);
const IconCard = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20M6 15h4" />
    </svg>
);

const METHODS = [
    { id: "cash", title: "Cash", subtitle: "Collect physical cash at the counter.", Icon: IconCash, tint: { bg: "#DCFCE7", fg: "#15803D" } },
    { id: "upi", title: "UPI", subtitle: "Customer scans the in-store QR or pays by UPI.", Icon: IconQR, tint: { bg: "#FFF1E8", fg: "#FD5302" } },
    { id: "card", title: "Card", subtitle: "Debit or credit card machine.", Icon: IconCard, tint: { bg: "#E0F2FE", fg: "#0369A1" } },
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const Row = ({ label, value, strong = false, muted = false, positive = false, negative = false }) => (
    <div className="flex items-center justify-between text-[13.5px]">
        <span className={muted ? "text-[#94A3B8]" : "text-[#475569]"}>{label}</span>
        <span
            className={
                strong
                    ? "font-extrabold text-[#0F172A]"
                    : positive
                    ? "font-bold text-[#16A34A]"
                    : negative
                    ? "font-bold text-[#EF4444]"
                    : "font-bold text-[#0F172A]"
            }
        >
            {value}
        </span>
    </div>
);

const MethodTile = ({ Icon, title, subtitle, tint, onClick, disabled }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`w-full flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all ${
            disabled
                ? "opacity-50 cursor-not-allowed border-[#E2E8F0]"
                : "border-[#E2E8F0] hover:border-[#FD5302] hover:shadow-sm active:scale-[0.99]"
        }`}
    >
        <span
            className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: tint.bg, color: tint.fg }}
        >
            <Icon />
        </span>
        <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-extrabold text-[#0F172A] leading-tight">
                {title}
            </span>
            <span className="block text-[12px] text-[#64748B] mt-0.5 leading-snug">
                {subtitle}
            </span>
        </span>
        <span className="text-[#CBD5E1]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
            </svg>
        </span>
    </button>
);

const INPUT =
    "w-full h-[40px] px-3 bg-white rounded-lg border border-[#E2E8F0] text-[13.5px] font-medium text-[#0F172A] placeholder-[#94A3B8] focus:border-[#FD5302] focus:ring-1 focus:ring-[#FD5302] outline-none";

const PaymentMethodModal = ({
    orderType = "Collection",
    // { name, phone } for a Collection order: asked here, optional. null hides it.
    customer = null,
    onCustomerChange,
    bills = {},
    busy = false,
    onClose,
    onSelect,
}) => {
    const {
        subtotal = 0,
        discount = 0,
        tax = 0,
        packagingFee = 0,
        deliveryFee = 0,
        totalWithTax = 0,
    } = bills;

    // Split: the server takes CASH / UPI / CARD parts that add up to the total
    // (services/splitPayment). Editing a part leaves the last one as "the rest".
    const [split, setSplit] = useState(false);
    const [parts, setParts] = useState([
        { method: "CASH", amount: "" },
        { method: "UPI", amount: "" },
    ]);
    const partsSum = round2(parts.reduce((t, p) => t + (Number(p.amount) || 0), 0));
    const splitOk = parts.every((p) => Number(p.amount) > 0) && Math.abs(partsSum - totalWithTax) < 0.01;
    const setPart = (i, patch) =>
        setParts((prev) => {
            const next = prev.map((p, k) => (k === i ? { ...p, ...patch } : p));
            if (patch.amount !== undefined && i < next.length - 1) {
                const others = next.slice(0, -1).reduce((t, p) => t + (Number(p.amount) || 0), 0);
                next[next.length - 1] = { ...next[next.length - 1], amount: String(Math.max(0, round2(totalWithTax - others))) };
            }
            return next;
        });

    return (
        <ModalShell
            title="Finish Order"
            subtitle={customer ? undefined : `Choose how the customer will pay for this ${orderType.toLowerCase()} order.`}
            onClose={onClose}
            width={460}
        >
            {/* ===== Customer (optional, Collection) ===== */}
            {customer && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                    <input
                        type="text"
                        value={customer.name}
                        onChange={(e) => onCustomerChange?.({ name: e.target.value, phone: customer.phone })}
                        placeholder="Customer name (optional)"
                        maxLength={120}
                        className={INPUT}
                    />
                    <input
                        type="tel"
                        inputMode="numeric"
                        value={customer.phone}
                        onChange={(e) => onCustomerChange?.({ name: customer.name, phone: mobileDigits(e.target.value) })}
                        placeholder="Mobile (optional)"
                        className={INPUT}
                    />
                </div>
            )}

            {/* ===== Bill breakdown ===== */}
            <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 space-y-1.5">
                <Row label="Subtotal" value={money(subtotal)} />
                {discount > 0 && (
                    <Row label="Discount" value={`− ${money(discount)}`} positive />
                )}
                {packagingFee > 0 && <Row label="Packing charge" value={money(packagingFee)} />}
                {deliveryFee > 0 && <Row label="Delivery charge" value={money(deliveryFee)} />}
                {tax > 0 && <Row label="GST / Tax" value={money(tax)} />}
                <div className="border-t border-[#E2E8F0] pt-2 mt-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[15px] font-extrabold text-[#0F172A]">Total payable</span>
                        <span className="text-[20px] font-extrabold text-[#C2410C]">
                            {money(totalWithTax)}
                        </span>
                    </div>
                </div>
            </div>

            {/* ===== Payment methods ===== */}
            {!split ? (
                <div className="mt-4 space-y-2.5">
                    {METHODS.map((m) => (
                        <MethodTile key={m.id} {...m} disabled={busy} onClick={() => onSelect(m.id)} />
                    ))}
                </div>
            ) : (
                <div className="mt-4 space-y-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                    {parts.map((p, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <select
                                value={p.method}
                                onChange={(e) => setPart(i, { method: e.target.value })}
                                className="h-[40px] rounded-lg border border-[#E2E8F0] bg-white px-2 text-[12.5px] font-bold"
                            >
                                {METHODS.map((m) => (
                                    <option key={m.id} value={m.id.toUpperCase()}>
                                        {m.title}
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
                                className="h-[40px] flex-1 min-w-0 rounded-lg border border-[#E2E8F0] bg-white px-3 text-[13px] font-bold tabular-nums"
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
                            {money(partsSum)} of {money(totalWithTax)}
                        </span>
                    </div>
                    <button
                        type="button"
                        disabled={busy || !splitOk}
                        onClick={() => onSelect("split", parts.map((p) => ({ method: p.method, amount: round2(p.amount) })))}
                        className="h-[44px] w-full rounded-xl bg-[#FD5302] text-white text-[14px] font-bold hover:bg-[#D64502] disabled:opacity-50"
                    >
                        Complete with split payment
                    </button>
                </div>
            )}
            <button
                type="button"
                onClick={() => setSplit((v) => !v)}
                className={`mt-2.5 h-[36px] w-full rounded-xl border text-[12.5px] font-bold ${
                    split ? "border-[#FD5302] bg-[#FFF1E8] text-[#C2410C]" : "border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]"
                }`}
            >
                {split ? "Pay with one method instead" : "Split between methods"}
            </button>

            {busy && (
                <p className="mt-3 text-center text-[12px] text-[#94A3B8]">
                    Processing… please wait.
                </p>
            )}
        </ModalShell>
    );
};

export default PaymentMethodModal;
