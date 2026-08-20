import React, { useState } from "react";
import { ModalShell, Field, inputCls } from "./ModalShell";

/**
 * Cart-level Discount modal (Module 2 §1, §2).
 *
 * Two paths:
 *   1. Quick presets: 10 / 20 / 30 / 40 percent.
 *   2. Manual editor: choose Percentage (5/10/15 presets + free input) or
 *      Fixed ₹ (₹10/₹20/₹50 presets + free input).
 *
 * Rules enforced here BEFORE the value ever hits Redux:
 *   - Discount cannot be negative.
 *   - Percentage must be 0..100.
 *   - Fixed cannot exceed the applicable amount (subtotal) — displayed and
 *     enforced with a real number ceiling, not just a warning.
 *   - Zero is a valid "clear" value; explicit Remove button also clears.
 *
 * The parent (OrderPanel) is the single source of truth for `subtotal`,
 * which it derives from the cart. That means whenever the cart changes the
 * ceiling recomputes and the modal will refuse a fixed discount that
 * *would* have exceeded the new (smaller) subtotal.
 */
const DiscountModal = ({
    subtotal = 0,
    initialMode = "none",
    initialValue = 0,
    onClose,
    onApply,
    onClear,
}) => {
    const [manual, setManual] = useState(initialMode !== "none");
    const [type, setType] = useState(initialMode === "fixed" ? "fixed" : "percent");
    const [value, setValue] = useState(String(initialValue || ""));
    const [error, setError] = useState("");

    const applicable = Math.max(0, Number(subtotal) || 0);

    const applyPreset = (mode, v) => {
        setError("");
        onApply({ mode, value: Number(v) });
    };

    const submitManual = (e) => {
        e.preventDefault();
        setError("");
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) {
            setError("Discount cannot be negative.");
            return;
        }
        if (type === "percent") {
            if (n > 100) {
                setError("Percentage must be between 0 and 100.");
                return;
            }
        } else {
            if (n > applicable) {
                setError(
                    `Fixed discount cannot exceed the order subtotal (₹${applicable.toFixed(2)}).`,
                );
                return;
            }
        }
        onApply({ mode: n === 0 ? "none" : type, value: n });
    };

    const previewAmount = (() => {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return 0;
        if (type === "percent") return Math.round(Math.min(n, 100) * applicable) / 100;
        return Math.min(n, applicable);
    })();

    return (
        <ModalShell
            title="Apply Discount"
            subtitle="Choose a quick preset or enter a manual discount."
            onClose={onClose}
            width={460}
        >
            {/* ===== Quick presets ===== */}
            <div>
                <p className="text-[12px] font-bold text-[#475569] uppercase tracking-wide mb-2">
                    Quick presets
                </p>
                <div className="grid grid-cols-4 gap-2">
                    {[10, 20, 30, 40].map((pct) => (
                        <button
                            key={pct}
                            type="button"
                            onClick={() => applyPreset("percent", pct)}
                            className="h-[48px] rounded-xl bg-[#EEF0FE] text-[#5B42F3] text-[14px] font-extrabold hover:bg-[#5B42F3] hover:text-white transition-colors"
                        >
                            {pct}%
                        </button>
                    ))}
                </div>
            </div>

            {/* ===== Manual toggle ===== */}
            <div className="mt-4">
                <button
                    type="button"
                    onClick={() => setManual((v) => !v)}
                    className={`w-full h-[42px] rounded-xl border text-[13.5px] font-bold transition-colors ${
                        manual
                            ? "bg-[#5B42F3] text-white border-[#5B42F3]"
                            : "bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
                    }`}
                >
                    {manual ? "Manual Discount ▲" : "Manual Discount ▼"}
                </button>
            </div>

            {manual && (
                <form onSubmit={submitManual} className="mt-3 space-y-3">
                    {/* Percent / Fixed switcher — big and touch-friendly so the
                        biller cannot misread which mode is active. */}
                    <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#F1F5F9]">
                        <button
                            type="button"
                            onClick={() => setType("percent")}
                            className={`h-[40px] rounded-lg text-[13px] font-extrabold transition-colors ${
                                type === "percent"
                                    ? "bg-white text-[#5B42F3] shadow-sm"
                                    : "text-[#64748B] hover:text-[#0F172A]"
                            }`}
                            aria-pressed={type === "percent"}
                        >
                            Percentage %
                        </button>
                        <button
                            type="button"
                            onClick={() => setType("fixed")}
                            className={`h-[40px] rounded-lg text-[13px] font-extrabold transition-colors ${
                                type === "fixed"
                                    ? "bg-white text-[#5B42F3] shadow-sm"
                                    : "text-[#64748B] hover:text-[#0F172A]"
                            }`}
                            aria-pressed={type === "fixed"}
                        >
                            Fixed ₹
                        </button>
                    </div>

                    {/* Type-specific presets */}
                    <div className="grid grid-cols-3 gap-2">
                        {(type === "percent" ? [5, 10, 15] : [10, 20, 50]).map((v) => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => setValue(String(v))}
                                className="h-[42px] rounded-xl border border-[#E2E8F0] text-[13px] font-bold text-[#334155] hover:border-[#5B42F3] hover:text-[#5B42F3]"
                            >
                                {type === "percent" ? `${v}%` : `₹${v}`}
                            </button>
                        ))}
                    </div>

                    <Field
                        label={
                            type === "percent"
                                ? "Custom percentage (0 – 100)"
                                : `Custom amount (max ₹${applicable.toFixed(2)})`
                        }
                        error={error}
                    >
                        <div className="relative">
                            <input
                                autoFocus
                                type="number"
                                inputMode="decimal"
                                min="0"
                                max={type === "percent" ? 100 : applicable}
                                step={type === "percent" ? "0.5" : "1"}
                                value={value}
                                onChange={(e) => {
                                    setError("");
                                    setValue(e.target.value);
                                }}
                                placeholder={type === "percent" ? "e.g. 12.5" : "e.g. 25"}
                                className={`${inputCls(!!error)} pr-10`}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-[#94A3B8]">
                                {type === "percent" ? "%" : "₹"}
                            </span>
                        </div>
                    </Field>

                    {/* Live preview of what the customer will actually save so the
                        biller can sanity-check before applying. */}
                    <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                        <span className="text-[12.5px] font-bold text-[#475569]">
                            Discount preview
                        </span>
                        <span className="text-[15px] font-extrabold text-[#16A34A]">
                            − ₹{previewAmount.toFixed(2)}
                        </span>
                    </div>

                    <button
                        type="submit"
                        className="w-full h-[46px] rounded-xl bg-[#5B42F3] text-white text-[14px] font-extrabold hover:bg-[#4A32E0] transition-colors"
                    >
                        Apply Discount
                    </button>
                </form>
            )}

            {/* Clear + close row */}
            <div className="mt-4 flex items-center justify-between border-t border-[#E2E8F0] pt-3">
                <button
                    type="button"
                    onClick={() => {
                        onClear();
                    }}
                    className="text-[13px] font-bold text-[#EF4444] hover:underline"
                >
                    Remove discount
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    className="text-[13px] font-bold text-[#64748B] hover:text-[#0F172A]"
                >
                    Close
                </button>
            </div>
        </ModalShell>
    );
};

export default DiscountModal;
