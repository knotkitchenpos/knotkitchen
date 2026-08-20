import React, { useState } from "react";
import { enqueueSnackbar } from "notistack";
import { ModalShell } from "./ModalShell";

/**
 * Post-order "Pay via Link" result (Module 2 §5).
 *
 * Shown after the POS successfully creates an order + a payment link. The
 * link is generated server-side via /api/payment-link (paymentLinkController)
 * and returned intact here so the biller can:
 *
 *   - Copy the URL and paste it into WhatsApp / email.
 *   - Confirm the SMS/WhatsApp auto-send status (the controller kicks off a
 *     `sendPaymentLinkMessage` — if that provider is unconfigured the
 *     "messaging" field on the response tells us so, and we surface it here).
 *   - Close the modal to move on to the next customer; the order stays in
 *     "Pending" until the customer completes payment via /pay/:token, at
 *     which point the payment-link verify endpoint flips the order to
 *     "ready" and records the payment (see verifyAndCaptureLinkPayment).
 */
const PaymentLinkResultModal = ({ result, onClose }) => {
    const [copied, setCopied] = useState(false);
    const url = result?.paymentUrl || "";
    const amount = Number(result?.amount || 0);
    const currency = result?.currency || "INR";
    const expiresAt = result?.expiresAt ? new Date(result.expiresAt) : null;
    const messaging = result?.messaging || {};

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            enqueueSnackbar("Payment link copied to clipboard.", { variant: "success" });
            setTimeout(() => setCopied(false), 2000);
        } catch {
            enqueueSnackbar("Could not copy — long-press the link to copy manually.", {
                variant: "warning",
            });
        }
    };

    return (
        <ModalShell
            title="Payment Link Generated"
            subtitle="Share this link with the customer. The order stays pending until they pay."
            onClose={onClose}
            width={480}
        >
            <div className="rounded-xl border border-[#FDE68A] bg-[#FEFCE8] p-3.5">
                <div className="flex items-center justify-between text-[13px]">
                    <span className="font-bold text-[#92400E]">Amount</span>
                    <span className="font-extrabold text-[#0F172A]">
                        {currency === "INR" ? "₹" : `${currency} `}
                        {amount.toFixed(2)}
                    </span>
                </div>
                {expiresAt && (
                    <div className="flex items-center justify-between text-[12px] mt-1">
                        <span className="text-[#92400E]">Expires</span>
                        <span className="font-semibold text-[#334155]">
                            {expiresAt.toLocaleString()}
                        </span>
                    </div>
                )}
            </div>

            <div className="mt-4">
                <label className="block text-[12px] font-bold text-[#475569] uppercase tracking-wide mb-1.5">
                    Payment URL
                </label>
                <div className="flex items-stretch gap-2">
                    <input
                        readOnly
                        value={url}
                        className="flex-1 h-[44px] px-3.5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] text-[13px] text-[#0F172A] font-mono truncate focus:border-[#5B42F3]"
                        onFocus={(e) => e.target.select()}
                    />
                    <button
                        type="button"
                        onClick={copy}
                        className="h-[44px] px-4 rounded-xl bg-[#5B42F3] text-white text-[13px] font-extrabold hover:bg-[#4A32E0]"
                    >
                        {copied ? "Copied!" : "Copy"}
                    </button>
                </div>
            </div>

            {/* Messaging provider status — helps the operator understand why
                the customer may or may not have received an SMS/WhatsApp.
                Shape matches what `sendPaymentLinkMessage` in
                pos-backend/services/messagingService.js returns:
                  { success: bool, provider: string, error?: string, messageId?: string }
             */}
            <div className="mt-4 rounded-xl border border-[#E2E8F0] bg-white p-3 text-[12.5px]">
                <p className="font-bold text-[#334155]">Auto-send status</p>
                <p className="mt-1 text-[#64748B]">
                    {messaging?.success
                        ? `Sent via ${messaging.provider || "SMS"} to ${
                              result?.customerPhone || "customer"
                          }.`
                        : messaging?.error ||
                          "Messaging provider is not configured — please share the link manually."}
                </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
                <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="h-[46px] rounded-xl border border-[#5B42F3] bg-white text-[#5B42F3] text-[13.5px] font-bold flex items-center justify-center hover:bg-[#EEF0FE]"
                >
                    Open link
                </a>
                <button
                    type="button"
                    onClick={onClose}
                    className="h-[46px] rounded-xl bg-[#0F172A] text-white text-[13.5px] font-bold hover:bg-[#1E293B]"
                >
                    Done
                </button>
            </div>
        </ModalShell>
    );
};

export default PaymentLinkResultModal;
