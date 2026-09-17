import React from "react";
import { ModalShell } from "./ModalShell";
import { money } from "../../utils";

/**
 * Finish Order → Payment Method chooser (Module 2 §5).
 *
 * Shown after the biller taps "Finish Order". Presents two ways to
 * collect payment:
 *
 *   - Cash       → order is created + immediately closed as paid-in-cash.
 *   - QR / Online→ order is created + immediately closed as paid via
 *                  in-store QR/online rail (existing behaviour).
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

const PaymentMethodModal = ({
    orderType = "Collection",
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

    return (
        <ModalShell
            title="Finish Order"
            subtitle={`Choose how the customer will pay for this ${orderType.toLowerCase()} order.`}
            onClose={onClose}
            width={460}
        >
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
            <div className="mt-4 space-y-2.5">
                <MethodTile
                    Icon={IconCash}
                    title="Cash"
                    subtitle="Collect physical cash at the counter."
                    tint={{ bg: "#DCFCE7", fg: "#15803D" }}
                    disabled={busy}
                    onClick={() => onSelect("cash")}
                />
                <MethodTile
                    Icon={IconQR}
                    title="QR / Online"
                    subtitle="Customer scans the in-store QR or pays via UPI."
                    tint={{ bg: "#FFF1E8", fg: "#FD5302" }}
                    disabled={busy}
                    onClick={() => onSelect("qr")}
                />
            </div>

            {busy && (
                <p className="mt-3 text-center text-[12px] text-[#94A3B8]">
                    Processing… please wait.
                </p>
            )}
        </ModalShell>
    );
};

export default PaymentMethodModal;
