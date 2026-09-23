import React, { useMemo, useState } from "react";

/**
 * Later-today pickup times: every 15 minutes from 30 minutes out, up to the
 * restaurant's pickup window (5 hours by default), never past midnight.
 */
function pickupTimes(windowHours, windows) {
  const now = new Date();
  const first = new Date(now.getTime() + 30 * 60000);
  first.setMinutes(Math.ceil(first.getMinutes() / 15) * 15, 0, 0);
  const last = new Date(now.getTime() + (Number(windowHours) || 5) * 3600000);
  const out = [];
  for (let t = first; t <= last && t.getDate() === now.getDate(); t = new Date(t.getTime() + 15 * 60000)) {
    const minute = t.getHours() * 60 + t.getMinutes();
    // Inside Collection Time only (null = no hours set, any time today).
    if (!windows || windows.some((w) => minute >= w.from && minute < w.to)) out.push(t);
  }
  return out;
}

const clock = (d) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
import { allowsFulfilment } from "../lib/dispatch";
import useScrollLock from "../lib/useScrollLock";

/**
 * Cart / checkout drawer.
 *
 * The checkout form collects only customer contact + delivery details. Every
 * total shown here is a client-side ESTIMATE — the definitive amount is
 * whatever the backend returns in the confirmation payload (§10).
 */
export default function CartDrawer({
  open,
  onClose,
  cart,
  ordering,
  availability,
  onPlaceOrder,
  placing,
  error,
}) {
  useScrollLock(open);
  const [orderType, setOrderType] = useState(
    ordering?.pickupEnabled !== false ? "pickup" : "delivery"
  );
  const [customer, setCustomer] = useState({ name: "", phone: "" });
  // Collection: "now" by default, or a later time today.
  const [pickupWhen, setPickupWhen] = useState("now");
  const [pickupAt, setPickupAt] = useState("");
  const pickupSlots = useMemo(
    () => pickupTimes(ordering?.pickupWindowHours, availability?.collection?.windows),
    // `open` so the list is rebuilt from the current time each time the cart opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ordering?.pickupWindowHours, availability, open]
  );
  const [address, setAddress] = useState({ line1: "", line2: "", city: "", postalCode: "", instructions: "" });

  const symbol = ordering?.currencySymbol || "£";
  const deliveryFee =
    orderType === "delivery" && cart.subtotal < (ordering?.freeDeliveryAbove || 0)
      ? Number(ordering?.deliveryFee || 0)
      : 0;
  const packaging = Number(ordering?.packagingFee || 0);
  const taxable = cart.subtotal + deliveryFee + packaging;
  const taxAmount = ordering?.taxInclusive ? 0 : taxable * (Number(ordering?.taxPercent || 0) / 100);
  const total = taxable + taxAmount;

  const minReached = cart.subtotal >= Number(ordering?.minOrderValue || 0);

  // Lines the restaurant does not sell through the fulfilment now selected.
  // The backend refuses these at checkout; catching them here means the
  // customer is told which item and why, while they can still do something
  // about it, instead of after they have filled in their address.
  const conflicting = cart.items.filter((l) => !allowsFulfilment(l.dispatchType, orderType));

  const phoneDigits = customer.phone.replace(/\D/g, "");
  // Website Timing & Holidays, as the server reported it.
  const channelState = availability?.[orderType === "delivery" ? "delivery" : "collection"];
  const channelClosed = Boolean(channelState && !channelState.open);
  const needsPickupTime = orderType === "pickup" && pickupWhen === "later";

  const canSubmit =
    cart.items.length > 0 &&
    customer.name.trim() &&
    phoneDigits.length === 10 &&
    (!needsPickupTime || pickupAt) &&
    !channelClosed &&
    minReached &&
    conflicting.length === 0 &&
    !placing &&
    (orderType === "pickup" || address.line1.trim());

  const submit = (e) => {
    e.preventDefault();
    onPlaceOrder({
      orderType,
      customer: {
        name: customer.name.trim(),
        phone: phoneDigits,
      },
      scheduledFor: needsPickupTime ? pickupAt : undefined,
      deliveryAddress: orderType === "delivery" ? address : undefined,
    });
  };

  return (
    <div
      className={`fixed inset-0 z-[95] transition ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 bottom-0 w-full sm:w-[420px] bg-white shadow-2xl flex flex-col transition-transform ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
      >
        <header className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-lg">Your order</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 text-2xl leading-none">×</button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.items.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-10">Your cart is empty.</p>
          ) : (
            cart.items.map((line) => {
              const sig = cart.lineSignature(line);
              return (
                <div key={sig} className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="font-medium">{line.name}</div>
                    {line.variant?.name ? (
                      <div className="text-xs text-slate-500">{line.variant.name}</div>
                    ) : null}
                    {line.addons?.length ? (
                      <div className="text-xs text-slate-500">
                        + {line.addons.map((a) => a.name).join(", ")}
                      </div>
                    ) : null}
                    {line.modifierSelections?.length ? (
                      <div className="text-xs text-slate-500">
                        {line.modifierSelections.map((m) => m.optionName).join(", ")}
                      </div>
                    ) : null}
                    {line.note ? <div className="text-xs italic text-slate-500 mt-0.5">“{line.note}”</div> : null}
                    {line.dispatchLabel ? (
                      <div
                        className={`text-[11px] mt-0.5 font-medium ${
                          allowsFulfilment(line.dispatchType, orderType)
                            ? "text-amber-700"
                            : "text-red-600"
                        }`}
                      >
                        {line.dispatchLabel}
                      </div>
                    ) : null}
                    <div className="text-sm mt-1 text-slate-700">
                      {symbol}
                      {(Number(line.unitPrice || line.price) * line.quantity).toFixed(2)}
                    </div>
                  </div>
                  <div className="flex items-center rounded-full border border-slate-200 overflow-hidden">
                    <button
                      type="button"
                      className="px-2 py-1"
                      onClick={() => cart.updateQuantity(sig, line.quantity - 1)}
                      aria-label="Decrease"
                    >
                      −
                    </button>
                    <span className="px-2 min-w-[1.5rem] text-center text-sm">{line.quantity}</span>
                    <button
                      type="button"
                      className="px-2 py-1"
                      onClick={() => cart.updateQuantity(sig, line.quantity + 1)}
                      aria-label="Increase"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {cart.items.length > 0 ? (
          <form onSubmit={submit} className="border-t p-4 space-y-3 max-h-[65vh] overflow-y-auto">
            {ordering?.pickupEnabled && ordering?.deliveryEnabled ? (
              <div className="flex gap-2">
                {["pickup", "delivery"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setOrderType(t)}
                    className={`flex-1 py-2 rounded-full text-sm font-medium border ${
                      orderType === t
                        ? "border-brand text-brand-fg bg-brand"
                        : "border-slate-200 text-slate-700 bg-white"
                    }`}
                  >
                    {t === "pickup" ? "Pickup" : "Delivery"}
                  </button>
                ))}
              </div>
            ) : null}

            <input
              type="text"
              required
              placeholder="Your name *"
              value={customer.name}
              onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
              autoComplete="name"
            />
            <input
              type="tel"
              required
              inputMode="numeric"
              maxLength={10}
              placeholder="10-digit phone number *"
              value={customer.phone}
              onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
              autoComplete="tel"
            />

            {orderType === "pickup" ? (
              <div>
                <p className="text-sm font-medium text-slate-800 mb-1.5">Pickup time *</p>
                <div className="flex gap-2">
                  {[
                    ["now", "Pickup now"],
                    ["later", "Later today"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPickupWhen(key)}
                      disabled={key === "later" && pickupSlots.length === 0}
                      className={`flex-1 py-2 rounded-full text-sm font-medium border disabled:opacity-40 ${
                        pickupWhen === key ? "border-brand bg-brand text-brand-fg" : "border-slate-200 text-slate-700 bg-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {pickupWhen === "later" ? (
                  <select
                    required
                    value={pickupAt}
                    onChange={(e) => setPickupAt(e.target.value)}
                    className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white"
                    aria-label="Pickup time"
                  >
                    <option value="">Choose a pickup time</option>
                    {pickupSlots.map((t) => (
                      <option key={t.toISOString()} value={t.toISOString()}>
                        {clock(t)}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : null}

            {orderType === "delivery" ? (
              <>
                <input
                  type="text"
                  required
                  placeholder="Address line 1"
                  value={address.line1}
                  onChange={(e) => setAddress((a) => ({ ...a, line1: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                />
                <input
                  type="text"
                  placeholder="Address line 2 (optional)"
                  value={address.line2}
                  onChange={(e) => setAddress((a) => ({ ...a, line2: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="City"
                    value={address.city}
                    onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))}
                    className="w-1/2 px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Postcode"
                    value={address.postalCode}
                    onChange={(e) => setAddress((a) => ({ ...a, postalCode: e.target.value }))}
                    className="w-1/2 px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
              </>
            ) : null}

            <div className="text-xs text-slate-500 space-y-0.5 pt-2 border-t">
              <Row label="Subtotal" value={`${symbol}${cart.subtotal.toFixed(2)}`} />
              {deliveryFee ? <Row label="Delivery" value={`${symbol}${deliveryFee.toFixed(2)}`} /> : null}
              {packaging ? <Row label="Packaging" value={`${symbol}${packaging.toFixed(2)}`} /> : null}
              {taxAmount ? (
                <Row label={`Tax (${ordering?.taxPercent}%)`} value={`${symbol}${taxAmount.toFixed(2)}`} />
              ) : null}
              <Row label="Estimated total" value={`${symbol}${total.toFixed(2)}`} bold />
            </div>

            {!minReached ? (
              <div className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
                Minimum order is {symbol}
                {Number(ordering?.minOrderValue).toFixed(2)}.
              </div>
            ) : null}
            {channelClosed ? (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2" role="alert">
                {channelState.reason || "This order type is not available right now."}
              </div>
            ) : null}
            {conflicting.length ? (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 space-y-1">
                <p className="font-semibold">
                  {conflicting.length === 1
                    ? "One item is not available for this order type:"
                    : `${conflicting.length} items are not available for this order type:`}
                </p>
                <ul className="list-disc pl-4">
                  {conflicting.map((l) => (
                    <li key={cart.lineSignature(l)}>
                      {l.name}{l.dispatchLabel ? ` — ${l.dispatchLabel}` : ""}
                    </li>
                  ))}
                </ul>
                <p>Switch order type above, or remove them from your basket.</p>
              </div>
            ) : null}
            {error ? <div className="text-sm text-red-600">{error}</div> : null}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full bg-brand text-brand-fg font-semibold rounded-full py-3 disabled:opacity-50"
            >
              {placing ? "Opening payment…" : `Place order & pay · ${symbol}${total.toFixed(2)}`}
            </button>
          </form>
        ) : null}
      </aside>
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div className={`flex justify-between ${bold ? "text-slate-900 font-semibold text-sm pt-1" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
