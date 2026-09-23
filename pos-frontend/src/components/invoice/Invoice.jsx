/* API receipt data is intentionally flexible; this component accepts the server payload. */
 
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FaCheck } from "react-icons/fa6";
import { useMutation } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { printOrderReceipt } from "../../utils/printReceipt";
import { sendEBill } from "../../https";
import { billableItems, itemDisplayName, itemExtras, resolveItemAmounts } from "../../utils/orderItems";
import { money } from "../../utils";

/**
 * Invoice / receipt modal (Module 3 §5, §6, §7, §8).
 *
 * Design contract:
 *   - Header shows the AUTHENTICATED restaurant's name & logo, NEVER a
 *     hardcoded "KnotKitchen". Falls back to a sensible default only if the
 *     branding query hasn't loaded yet — never to a different restaurant.
 *   - The on-screen modal uses an OPAQUE dark card (§6). The THERMAL print
 *     stylesheet stays black-on-white for maximum printer compatibility.
 *   - Full bill breakdown: subtotal, discount, packing, delivery, GST,
 *     total, order id, payment id, payment method. Anything the server
 *     didn't populate is quietly omitted (e.g. no "Discount: ₹0" clutter).
 *   - Payment ID (the gateway's own id for online, or the first
 *     `payments[].transactionId` if present) is displayed and PERSISTED
 *     server-side against the order/payment record — no separate
 *     frontend-only Payment ID exists.
 *   - E-Bill button is ONLY enabled when a phone number exists (§7). Even
 *     if a user finds a way to click it, the backend still refuses without
 *     a phone number (defence in depth).
 *   - Print flow (§8): if the user cancels or clicks outside the print
 *     popup, `handlePrint` returns immediately without waiting. Nothing
 *     downstream is gated on the print completing — the invoice modal is
 *     already open, the order is already saved.
 */


const Invoice = ({
    orderInfo,
    setShowInvoice,
    restaurantName: propRestaurantName,
    restaurantLogo: propRestaurantLogo,
}) => {
    const safeOrder = orderInfo || {};
    const safeCustomer = safeOrder.customerDetails || {};
    const safeBills = safeOrder.bills || {};
    // Cancelled lines were not sold: they are not on the bill.
    const safeItems = billableItems(safeOrder.items);

    // Prefer explicit props from OrderPanel (react-query cached). Falls back
    // to whatever the server attached to the order document, then to a
    // generic label if the tenant hasn't configured a name yet.
    const restaurantName =
        propRestaurantName ||
        safeOrder.restaurantName ||
        safeOrder.storeName ||
        "Restaurant";
    const restaurantLogo = propRestaurantLogo || safeOrder.restaurantLogo || "";

    // Order + payment identifiers.
    // Prefer the human-friendly server-generated orderNumber (POS-YYYYMMDD-XXXXXX)
    // over the raw Mongo _id so receipts match Orders lookup.
    const orderId =
        safeOrder.orderNumber ||
        safeOrder._id ||
        `#${Math.floor(new Date(safeOrder.orderDate || Date.now()).getTime())}`;

    // Payment ID: the gateway's own payment id if present, else the first
    // ledger transactionId, else null (Cash orders may legitimately have
    // no gateway payment id — Module 3 §3 explicitly permits this).
    const paymentId =
        safeOrder.paymentData?.gatewayPaymentId ||
        (Array.isArray(safeOrder.payments) &&
            safeOrder.payments.find((p) => p?.transactionId)?.transactionId) ||
        "";

    const paymentMethodRaw = String(safeOrder.paymentMethod || "Cash");
    const paymentMethod = paymentMethodRaw.toLowerCase();
    const isCash = paymentMethod === "cash";
    const isLink =
        paymentMethod === "paymentlink" || paymentMethod === "payment_link" || paymentMethod === "link";

    const customerPhone = safeCustomer.phone || "";
    const canSendEBill = Boolean(customerPhone && safeOrder._id);

    const [emailedTo, setEmailedTo] = useState("");

    // Back to the order page on its own after 6 seconds, or at once on a tap
    // outside the card. A touch on the card (Print, E-Bill) keeps it open.
    const close = () => setShowInvoice(false);
    const autoClose = useRef(null);
    useEffect(() => {
        autoClose.current = setTimeout(close, 6000);
        return () => clearTimeout(autoClose.current);
        // Once, on open: the parent re-renders often and must not restart it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const eBillMutation = useMutation({
        mutationFn: () =>
            sendEBill({ orderId: safeOrder._id, phone: customerPhone }),
        onSuccess: (res) => {
            const data = res?.data;
            if (data?.sent) {
                enqueueSnackbar(`E-Bill sent to ${customerPhone}`, { variant: "success" });
                setEmailedTo(customerPhone);
            } else {
                enqueueSnackbar(
                    data?.message ||
                        "E-Bill could not be delivered — please share the receipt manually.",
                    { variant: "warning" },
                );
            }
        },
        onError: (err) =>
            enqueueSnackbar(
                err?.response?.data?.message || "Failed to send E-Bill.",
                { variant: "error" },
            ),
    });

    // One receipt for every screen: see utils/printReceipt.js. It prints on
    // this device's configured printer, or opens the print dialog if none.
    const handlePrint = async () => {
        try {
            await printOrderReceipt(safeOrder);
        } catch (err) {
            enqueueSnackbar(err?.message || "Could not print the receipt.", { variant: "error" });
        }
    };

    return (
        // Module 3 §6 — darker, more opaque overlay + card so the receipt
        // reads clearly on any wallpaper. Kept as its own <div> so the
        // print stylesheet above is unaffected.
        <div onClick={close} className="fixed inset-0 bg-[#0F172A]/85 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <div
                onClick={(e) => e.stopPropagation()}
                onPointerDown={() => clearTimeout(autoClose.current)}
                className="bg-[#0B1120] text-white rounded-2xl shadow-2xl w-full max-w-md border border-white/10 overflow-hidden"
            >
                <div className="p-6">
                    {/* Success tick */}
                    <div className="flex justify-center mb-4">
                        <motion.div
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1.2, opacity: 1 }}
                            transition={{ duration: 0.5, type: "spring", stiffness: 150 }}
                            className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg bg-gradient-to-br from-[#16A34A] to-[#059669]"
                        >
                            <motion.span
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ delay: 0.3, duration: 0.3 }}
                                className="text-2xl"
                            >
                                <FaCheck className="text-white" />
                            </motion.span>
                        </motion.div>
                    </div>

                    {/* Restaurant branding — never hardcoded */}
                    <div className="flex flex-col items-center gap-2">
                        {restaurantLogo ? (
                            <img
                                src={restaurantLogo}
                                alt={`${restaurantName} logo`}
                                className="w-14 h-14 rounded-xl object-contain bg-white/5 p-1"
                                onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                }}
                            />
                        ) : null}
                        <h2 className="font-display text-2xl font-extrabold text-center leading-tight">
                            {restaurantName}
                        </h2>
                        <p className="text-white/60 text-center text-[13px]">
                            Order Receipt — Thank you for your order!
                        </p>
                    </div>

                    {/* Order identifiers */}
                    <div className="mt-5 border-t border-white/10 pt-4 text-[13px] space-y-1">
                        <p className="flex justify-between gap-4">
                            <span className="text-white/50">Order ID</span>
                            <strong className="truncate max-w-[220px]" title={String(orderId)}>
                                {orderId}
                            </strong>
                        </p>
                        {paymentId ? (
                            <p className="flex justify-between gap-4">
                                <span className="text-white/50">Payment ID</span>
                                <strong className="truncate max-w-[220px]" title={paymentId}>
                                    {paymentId}
                                </strong>
                            </p>
                        ) : null}
                        {safeCustomer.name ? (
                            <p className="flex justify-between gap-4">
                                <span className="text-white/50">Customer</span>
                                <strong>{safeCustomer.name}</strong>
                            </p>
                        ) : null}
                        {customerPhone ? (
                            <p className="flex justify-between gap-4">
                                <span className="text-white/50">Phone</span>
                                <strong>{customerPhone}</strong>
                            </p>
                        ) : null}
                    </div>

                    {/* Items */}
                    <div className="mt-4 border-t border-white/10 pt-4">
                        <h3 className="text-[13px] font-semibold text-white/70 mb-2">
                            Items Ordered
                        </h3>
                        <div className="space-y-1.5">
                            {safeItems.map((item, index) => (
                                <div key={index} className="text-[13px]">
                                    <div className="flex justify-between items-start gap-3">
                                        <span className="text-white/90">
                                            {itemDisplayName(item)}{" "}
                                            <span className="text-white/40">x{resolveItemAmounts(item).quantity}</span>
                                        </span>
                                        {/* The LINE amount, so the rows add up to the subtotal below. */}
                                        <span className="font-semibold shrink-0">
                                            {money(resolveItemAmounts(item).lineTotal)}
                                        </span>
                                    </div>
                                    {itemExtras(item).map((extra, x) => (
                                        <div key={x} className="flex items-baseline gap-3 pl-3 mt-0.5 text-[11.5px]">
                                            <span className="min-w-0 flex-1 truncate text-white/50">
                                                {extra.quantity > 1 ? `${extra.quantity}× ${extra.name}` : extra.name}
                                            </span>
                                            <span className="shrink-0 text-white/60">
                                                {extra.price
                                                    ? money(extra.price * extra.quantity * resolveItemAmounts(item).quantity)
                                                    : ""}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Bill breakdown — omit zero rows */}
                    <div className="mt-4 border-t border-white/10 pt-4 text-[13px] space-y-1">
                        <p className="flex justify-between">
                            <span className="text-white/50">Subtotal</span>
                            <span>{money(safeBills.subtotal || safeBills.total || 0)}</span>
                        </p>
                        {Number(safeBills.discount) > 0 && (
                            <p className="flex justify-between">
                                <span className="text-white/50">Discount</span>
                                <span className="text-[#4ADE80]">
                                    − {money(safeBills.discount)}
                                </span>
                            </p>
                        )}
                        {Number(safeBills.packagingFee) > 0 && (
                            <p className="flex justify-between">
                                <span className="text-white/50">Packing charge</span>
                                <span>{money(safeBills.packagingFee)}</span>
                            </p>
                        )}
                        {Number(safeBills.deliveryFee) > 0 && (
                            <p className="flex justify-between">
                                <span className="text-white/50">Delivery charge</span>
                                <span>{money(safeBills.deliveryFee)}</span>
                            </p>
                        )}
                        {Number(safeBills.tax) > 0 && (
                            <p className="flex justify-between">
                                <span className="text-white/50">
                                    GST{Number(safeBills.taxPercent) > 0 ? ` @ ${safeBills.taxPercent}%` : ""}
                                </span>
                                <span>{money(safeBills.tax)}</span>
                            </p>
                        )}
                        {Number(safeBills.serviceCharge) > 0 && (
                            <p className="flex justify-between">
                                <span className="text-white/50">Service charge</span>
                                <span>{money(safeBills.serviceCharge)}</span>
                            </p>
                        )}
                        <p className="flex justify-between font-bold text-[15px] pt-2 border-t border-white/10 mt-2">
                            <span>Grand Total</span>
                            <span>
                                {money(safeBills.totalWithTax || safeBills.total || 0)}
                            </span>
                        </p>
                    </div>

                    {/* Payment method + Payment ID */}
                    <div className="mt-4 bg-white/5 rounded-xl p-3 text-[12.5px] border border-white/10 space-y-1">
                        <p className="flex justify-between">
                            <span className="text-white/50">Payment Method</span>
                            <strong
                                className={
                                    isCash
                                        ? "text-[#4ADE80]"
                                        : isLink
                                        ? "text-[#FBBF24]"
                                        : "text-[#818CF8]"
                                }
                            >
                                {paymentMethodRaw}
                            </strong>
                        </p>
                        {paymentId ? (
                            <p className="flex justify-between gap-4">
                                <span className="text-white/50">Payment ID</span>
                                <span
                                    className="truncate max-w-[220px] font-mono text-[11.5px]"
                                    title={paymentId}
                                >
                                    {paymentId}
                                </span>
                            </p>
                        ) : null}
                    </div>

                    {emailedTo && (
                        <p className="mt-3 text-[12px] text-[#4ADE80] text-center">
                            E-Bill sent to {emailedTo}.
                        </p>
                    )}
                </div>

                {/* Buttons — Module 3 §7: E-Bill visible only if phone exists.
                    Print + E-Bill sit alongside Close so the biller can move
                    on without waiting for the print dialog (Module 3 §8). */}
                <div
                    className={`grid gap-3 px-6 pb-6 ${
                        canSendEBill ? "grid-cols-3" : "grid-cols-2"
                    }`}
                >
                    <button
                        onClick={handlePrint}
                        className="h-11 rounded-xl border border-white/20 text-white text-[13px] font-bold hover:bg-white/10 transition-colors"
                    >
                        Print Receipt
                    </button>
                    {canSendEBill && (
                        <button
                            onClick={() => eBillMutation.mutate()}
                            disabled={eBillMutation.isPending}
                            className="h-11 rounded-xl bg-[#F59E0B] text-white text-[13px] font-bold hover:bg-[#D97706] disabled:opacity-50 transition-colors"
                            title={`Send E-Bill to ${customerPhone}`}
                        >
                            {eBillMutation.isPending ? "Sending…" : "E-Bill"}
                        </button>
                    )}
                    <button
                        onClick={close}
                        className="h-11 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Invoice;
