import React, { useEffect, useMemo, useState } from "react";
import { formatPrice } from "../theme";
import { estimateTotals } from "../useCart";

/**
 * Slide-over cart + checkout (§10, §11).
 *
 * Two panes in one surface — "cart" and "checkout" — so ordering stays a
 * single, low-friction flow on mobile. Totals shown here are estimates; the
 * confirmation screen renders the server's authoritative bill.
 */
const CartDrawer = ({
  open,
  onClose,
  cart,
  ordering,
  storeOpen,
  onPlaceOrder,
  placing,
  error,
  canCheckout = true,
}) => {
  const [pane, setPane] = useState("cart");
  const [orderType, setOrderType] = useState(ordering?.pickupEnabled ? "pickup" : "delivery");
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "" });
  const [address, setAddress] = useState({ line1: "", line2: "", city: "", postalCode: "", instructions: "" });
  const [formError, setFormError] = useState("");

  const symbol = ordering?.currencySymbol || "₹";
  const totals = useMemo(
    () => estimateTotals(cart.subtotal, ordering, orderType),
    [cart.subtotal, ordering, orderType]
  );

  useEffect(() => {
    if (!open) setPane("cart");
  }, [open]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const belowMinimum = ordering?.minOrderValue > 0 && cart.subtotal < ordering.minOrderValue;

  const submit = (e) => {
    e.preventDefault();
    setFormError("");

    if (!customer.name.trim()) return setFormError("Please enter your name.");
    if (customer.phone.replace(/\D/g, "").length < 7) {
      return setFormError("Please enter a valid phone number.");
    }
    if (orderType === "delivery" && !address.line1.trim()) {
      return setFormError("Please enter your delivery address.");
    }

    onPlaceOrder({
      orderType,
      customer,
      ...(orderType === "delivery" ? { deliveryAddress: address } : {}),
    });
  };

  const inputClass =
    "w-full p-3 rounded-xl border border-black/10 bg-[var(--sf-surface)] text-[var(--sf-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sf-primary)]";

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Your order"
        className={`fixed top-0 right-0 bottom-0 z-[95] w-full sm:w-[440px] bg-[var(--sf-bg)] shadow-2xl flex flex-col transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <header className="shrink-0 flex items-center justify-between p-4 border-b border-black/10">
          <h2 className="text-lg font-bold text-[var(--sf-text)]">
            {pane === "cart" ? `Your Order (${cart.count})` : "Checkout"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cart"
            className="w-9 h-9 rounded-full hover:bg-[var(--sf-surface)] text-xl leading-none"
          >
            ×
          </button>
        </header>

        {/* ---------- CART PANE ---------- */}
        {pane === "cart" ? (
          <>
            <div className="flex-1 overflow-y-auto p-4">
              {cart.items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-16">
                  <div className="text-5xl mb-3" aria-hidden="true">🛒</div>
                  <p className="font-semibold text-[var(--sf-text)]">Your cart is empty</p>
                  <p className="text-sm text-[var(--sf-muted)] mt-1">
                    Add some delicious items to get started.
                  </p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {cart.items.map((item) => (
                    <li
                      key={item.signature}
                      className="flex gap-3 p-3 rounded-2xl bg-[var(--sf-surface)]"
                    >
                      {item.image ? (
                        <img
                          src={item.image}
                          alt=""
                          loading="lazy"
                          className="w-16 h-16 rounded-xl object-cover shrink-0"
                        />
                      ) : null}

                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[var(--sf-text)] text-sm">{item.name}</p>

                        {/* Configured options summary */}
                        {item.variantName ? (
                          <p className="text-xs text-[var(--sf-muted)]">{item.variantName}</p>
                        ) : null}
                        {item.optionNames?.length ? (
                          <p className="text-xs text-[var(--sf-muted)]">
                            {item.optionNames.join(", ")}
                          </p>
                        ) : null}
                        {item.addonNames?.length ? (
                          <p className="text-xs text-[var(--sf-muted)]">
                            + {item.addonNames.join(", ")}
                          </p>
                        ) : null}
                        {item.note ? (
                          <p className="text-xs italic text-[var(--sf-muted)] mt-0.5">
                            “{item.note}”
                          </p>
                        ) : null}

                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-1 bg-[var(--sf-bg)] border border-black/10 rounded-full p-0.5">
                            <button
                              type="button"
                              aria-label={`Decrease ${item.name}`}
                              onClick={() => cart.updateQuantity(item.signature, item.quantity - 1)}
                              className="w-7 h-7 rounded-full font-bold hover:bg-[var(--sf-surface)]"
                            >
                              −
                            </button>
                            <span className="w-6 text-center text-sm font-semibold">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase ${item.name}`}
                              onClick={() => cart.updateQuantity(item.signature, item.quantity + 1)}
                              className="w-7 h-7 rounded-full font-bold hover:bg-[var(--sf-surface)]"
                            >
                              +
                            </button>
                          </div>
                          <span className="font-bold text-sm text-[var(--sf-text)]">
                            {formatPrice(item.unitPrice * item.quantity, symbol)}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {cart.items.length > 0 ? (
              <footer className="shrink-0 p-4 border-t border-black/10 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--sf-muted)]">Subtotal</span>
                  <span className="font-semibold">{formatPrice(cart.subtotal, symbol)}</span>
                </div>

                {belowMinimum ? (
                  <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded-lg">
                    Minimum order is {formatPrice(ordering.minOrderValue, symbol)}. Add{" "}
                    {formatPrice(ordering.minOrderValue - cart.subtotal, symbol)} more to checkout.
                  </p>
                ) : null}

                <button
                  type="button"
                  disabled={belowMinimum || !storeOpen || !canCheckout}
                  onClick={() => setPane("checkout")}
                  className="w-full py-3 font-semibold bg-[var(--sf-button)] text-[var(--sf-button-text)] disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-all"
                  style={{ borderRadius: "var(--sf-radius)" }}
                >
                  {!canCheckout ? "Preview — ordering disabled" : storeOpen ? "Continue to Checkout" : "Restaurant Closed"}
                </button>
              </footer>
            ) : null}
          </>
        ) : (
          /* ---------- CHECKOUT PANE ---------- */
          <form onSubmit={submit} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Order type */}
              {ordering?.pickupEnabled && ordering?.deliveryEnabled ? (
                <div>
                  <span className="block font-semibold text-[var(--sf-text)] mb-2">Order Type</span>
                  <div className="grid grid-cols-2 gap-2">
                    {["pickup", "delivery"].map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setOrderType(type)}
                        className={`py-3 rounded-xl border-2 font-semibold text-sm capitalize transition-all ${
                          orderType === type
                            ? "border-[var(--sf-primary)] bg-[var(--sf-primary)]/10 text-[var(--sf-primary)]"
                            : "border-black/10 text-[var(--sf-muted)]"
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Customer details */}
              <div className="space-y-3">
                <div>
                  <label htmlFor="sf-name" className="block text-sm font-medium mb-1">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="sf-name"
                    className={inputClass}
                    value={customer.name}
                    autoComplete="name"
                    onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                    placeholder="Your full name"
                  />
                </div>
                <div>
                  <label htmlFor="sf-phone" className="block text-sm font-medium mb-1">
                    Phone <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="sf-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    className={inputClass}
                    value={customer.phone}
                    onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                    placeholder="10-digit mobile number"
                  />
                </div>
                <div>
                  <label htmlFor="sf-email" className="block text-sm font-medium mb-1">
                    Email <span className="text-[var(--sf-muted)]">(optional)</span>
                  </label>
                  <input
                    id="sf-email"
                    type="email"
                    autoComplete="email"
                    className={inputClass}
                    value={customer.email}
                    onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              {/* Delivery address */}
              {orderType === "delivery" ? (
                <div className="space-y-3">
                  <h3 className="font-semibold text-[var(--sf-text)]">Delivery Address</h3>
                  <input
                    className={inputClass}
                    value={address.line1}
                    autoComplete="address-line1"
                    onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                    placeholder="Address line 1 *"
                  />
                  <input
                    className={inputClass}
                    value={address.line2}
                    autoComplete="address-line2"
                    onChange={(e) => setAddress({ ...address, line2: e.target.value })}
                    placeholder="Address line 2"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      className={inputClass}
                      value={address.city}
                      autoComplete="address-level2"
                      onChange={(e) => setAddress({ ...address, city: e.target.value })}
                      placeholder="City"
                    />
                    <input
                      className={inputClass}
                      value={address.postalCode}
                      autoComplete="postal-code"
                      onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
                      placeholder="Postcode"
                    />
                  </div>
                  <input
                    className={inputClass}
                    value={address.instructions}
                    onChange={(e) => setAddress({ ...address, instructions: e.target.value })}
                    placeholder="Delivery instructions (optional)"
                  />
                </div>
              ) : null}

              {/* Bill summary */}
              <div className="p-4 rounded-2xl bg-[var(--sf-surface)] space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--sf-muted)]">Subtotal</span>
                  <span>{formatPrice(totals.subtotal, symbol)}</span>
                </div>
                {totals.packagingFee > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-[var(--sf-muted)]">Packaging</span>
                    <span>{formatPrice(totals.packagingFee, symbol)}</span>
                  </div>
                ) : null}
                {orderType === "delivery" ? (
                  <div className="flex justify-between">
                    <span className="text-[var(--sf-muted)]">Delivery</span>
                    <span>
                      {totals.deliveryFee > 0 ? formatPrice(totals.deliveryFee, symbol) : "FREE"}
                    </span>
                  </div>
                ) : null}
                {totals.tax > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-[var(--sf-muted)]">
                      Tax {ordering?.taxInclusive ? "(incl.)" : ""}
                    </span>
                    <span>{formatPrice(totals.tax, symbol)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between pt-2 border-t border-black/10 font-bold text-base">
                  <span>Total</span>
                  <span>{formatPrice(totals.total, symbol)}</span>
                </div>
                <p className="text-[11px] text-[var(--sf-muted)] pt-1">
                  Final total is confirmed by the restaurant when your order is placed.
                </p>
              </div>

              {formError || error ? (
                <p role="alert" className="text-sm text-red-600 font-medium">
                  {formError || error}
                </p>
              ) : null}
            </div>

            <footer className="shrink-0 p-4 border-t border-black/10 flex gap-3">
              <button
                type="button"
                onClick={() => setPane("cart")}
                className="px-4 py-3 rounded-xl border border-black/15 font-semibold text-sm"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={placing || !canCheckout}
                className="flex-1 py-3 font-semibold bg-[var(--sf-button)] text-[var(--sf-button-text)] disabled:opacity-60 hover:opacity-90 transition-all"
                style={{ borderRadius: "var(--sf-radius)" }}
              >
                {placing ? "Placing Order…" : `Place Order · ${formatPrice(totals.total, symbol)}`}
              </button>
            </footer>
          </form>
        )}
      </aside>
    </>
  );
};

export default CartDrawer;
