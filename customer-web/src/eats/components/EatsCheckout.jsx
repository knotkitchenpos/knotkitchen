import React, { useEffect, useMemo, useRef, useState } from "react";
import useScrollLock from "../../lib/useScrollLock";
import { allowsFulfilment } from "../../lib/dispatch";
import { cartEstimate, cartOrderType } from "../../lib/orderTotals";
import { buildOrder, checkoutState, pickupTimes } from "../../lib/eatsCheckout";
import { ADDRESS_LABELS, getProfile, saveAddress, saveContact, useEatsProfile } from "../../lib/eatsProfile";
import { useEatsLocation } from "../../lib/eatsLocation";
import { FoodMark } from "../../components/ProductCard";
import { FOCUS } from "../shared";

const clock = (d) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const rupees = (symbol, n) => `${symbol}${(Number(n) || 0).toFixed(2)}`;
const INPUT = `w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none`;

/**
 * Knot Eats checkout: a full screen on a phone, a panel on a wide screen.
 * Delivery or pickup, where to, the basket, offers, the bill, and who is
 * ordering, with one pay button that says what is still missing.
 *
 * Same order as the store website's cart (lib/eatsCheckout.buildOrder) and
 * the same payment: `onPlaceOrder` is StorePage's, which prices it on the
 * server and opens the gateway. Stays mounted while closed, so nothing typed
 * is lost when the diner goes back to add a dish.
 */
export default function EatsCheckout({
  open,
  onClose,
  cart,
  ordering,
  availability,
  onPlaceOrder,
  placing,
  error: placeError,
  errorCode = "",
  storeName = "",
  defaultOrderType = "",
  deliveryBlockedReason = "",
  deliveryPoint = null,
  deliveryEta = "",
  renderOffers = null,
  agreement = null,
  platformFeeNote = "",
  vegById = null,
}) {
  useScrollLock(open);
  const profile = useEatsProfile();
  const { setLocation } = useEatsLocation();
  const symbol = ordering?.currencySymbol || "₹";

  const [chosenType, setOrderType] = useState(defaultOrderType || "pickup");
  useEffect(() => {
    if (defaultOrderType) setOrderType(defaultOrderType);
  }, [defaultOrderType]);
  const orderType = cartOrderType(chosenType, ordering, deliveryBlockedReason);
  const delivery = orderType === "delivery";
  // Each line is priced at this channel's price (useCart), as the server bills it.
  const channel = delivery ? "delivery" : "collection";
  useEffect(() => {
    cart.setChannel?.(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  // Filled from this device once, the first time checkout opens.
  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [remember, setRemember] = useState(true);
  const [address, setAddress] = useState({ line1: "", line2: "", city: "", postalCode: "", instructions: "" });
  const [saveAs, setSaveAs] = useState("Home");
  const [editing, setEditing] = useState(false);
  const filled = useRef(false);
  useEffect(() => {
    if (!open || filled.current) return;
    filled.current = true;
    const p = getProfile();
    setCustomer({ name: p.name, phone: p.phone });
    // The saved address at this spot, if there is one; else the spot itself.
    const here = deliveryPoint && p.addresses.find((a) => Number.isFinite(a.lat) && Math.abs(a.lat - deliveryPoint.lat) < 0.001 && Math.abs(a.lng - deliveryPoint.lng) < 0.001);
    if (here) {
      setAddress({ line1: here.line1, line2: here.line2, city: here.city, postalCode: here.postalCode, instructions: here.instructions });
      setSaveAs(here.label);
    } else if (deliveryPoint?.label) {
      setAddress((a) => ({ ...a, line1: a.line1 || deliveryPoint.address || deliveryPoint.label }));
    }
  }, [open, deliveryPoint]);

  // Picking a saved address with a map point moves the delivery point too, so
  // the restaurant re-quotes the fee and whether it delivers there.
  const pickSaved = (a) => {
    setAddress({ line1: a.line1, line2: a.line2, city: a.city, postalCode: a.postalCode, instructions: a.instructions });
    setSaveAs(a.label);
    setEditing(false);
    if (Number.isFinite(a.lat)) setLocation({ lat: a.lat, lng: a.lng, label: `${a.label}: ${a.line1}`.slice(0, 80), source: "places" });
  };

  const [pickupWhen, setPickupWhen] = useState("now");
  const [pickupAt, setPickupAt] = useState("");
  const slots = useMemo(
    () => pickupTimes(ordering?.pickupWindowHours, availability?.collection?.windows),
    // `open`: rebuilt from the current time each time checkout opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ordering?.pickupWindowHours, availability, open],
  );
  useEffect(() => {
    if (pickupAt && !slots.some((t) => t.toISOString() === pickupAt)) setPickupAt("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  // Offers: the row is EatsStorePage's (`renderOffers`); it reports the coupon it applied.
  const [pickedCode, setPickedCode] = useState(null); // null: best offer · "": none
  const [coupon, setCoupon] = useState(null);

  const bill = cartEstimate({ subtotal: cart.subtotal, ordering, orderType, discount: coupon?.discount });
  const state = checkoutState({
    lines: cart.items,
    subtotal: cart.subtotal,
    ordering,
    availability,
    orderType,
    deliveryBlockedReason,
    customer,
    address,
    pickupWhen,
    pickupAt,
    placing,
  });
  // A coupon the server says this phone has already used: its Remove clears both.
  const error = errorCode === "COUPON_USED" && !coupon ? "" : placeError;
  const both = ordering?.pickupEnabled && ordering?.deliveryEnabled;
  // A saved address in use shows as one card; Edit (or a problem with it) opens the fields.
  const same = (a) => ["line1", "line2", "city", "postalCode"].every((k) => (a[k] || "") === (address[k] || ""));
  const savedInUse = profile.addresses.find(same);
  const compact = Boolean(savedInUse && !editing && address.line1.trim() && !state.pinBad);

  const submit = (e) => {
    e.preventDefault();
    if (!state.canSubmit) return;
    if (remember) {
      saveContact(customer);
      if (delivery) saveAddress({ ...address, label: saveAs, ...(deliveryPoint ? { lat: deliveryPoint.lat, lng: deliveryPoint.lng } : {}) });
    }
    onPlaceOrder(buildOrder({ orderType, customer, address, deliveryPoint, pickupWhen, pickupAt, coupon }));
  };

  return (
    <div className={`fixed inset-0 z-[95] ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="Checkout"
        className={`absolute inset-y-0 right-0 flex w-full flex-col bg-slate-50 shadow-2xl transition-transform duration-200 sm:w-[460px] ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-2 py-2">
          <button type="button" onClick={onClose} aria-label="Back to the menu" className={`flex h-11 w-11 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 ${FOCUS}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-bold text-[color:var(--ke-ink)]">{storeName || "Checkout"}</h2>
            <p className="truncate text-[12.5px] text-slate-500">
              {delivery ? (deliveryEta ? `Delivery in ${deliveryEta}` : "Delivery") : "Pickup from the restaurant"}
            </p>
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-3 pb-6">
          {both ? (
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-200 p-1" role="radiogroup" aria-label="Order type">
              {["delivery", "pickup"].map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={orderType === t}
                  disabled={t === "delivery" && Boolean(deliveryBlockedReason)}
                  onClick={() => setOrderType(t)}
                  className={`min-h-[42px] rounded-xl text-[14px] font-semibold disabled:opacity-40 ${orderType === t ? "bg-white text-brand shadow" : "text-slate-600"} ${FOCUS}`}
                >
                  {t === "delivery" ? "Delivery" : "Pickup"}
                </button>
              ))}
            </div>
          ) : null}
          {ordering?.deliveryEnabled && deliveryBlockedReason ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-800">{deliveryBlockedReason}</p>
          ) : null}

          {/* The basket */}
          <Card title="Your order">
            {cart.items.length === 0 ? (
              <p className="py-6 text-center text-[14px] text-slate-500">Your cart is empty.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {cart.items.map((l) => {
                  const sig = cart.lineSignature(l);
                  const extras = [l.variant?.name, ...(l.addons || []).map((a) => a.name), ...(l.modifierSelections || []).map((m) => m.optionName)].filter(Boolean);
                  const blocked = !allowsFulfilment(l.dispatchType, orderType);
                  return (
                    <li key={sig} className="flex items-start gap-3 py-3">
                      {vegById?.has(String(l.itemId)) ? (
                        <span className="mt-1">
                          <FoodMark veg={vegById.get(String(l.itemId))} />
                        </span>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-[15px] font-medium text-slate-900">{l.name}</p>
                        {extras.length ? <p className="text-[12.5px] text-slate-500">{extras.join(", ")}</p> : null}
                        {l.note ? <p className="text-[12.5px] italic text-slate-500">“{l.note}”</p> : null}
                        {l.dispatchLabel ? <p className={`text-[12px] font-medium ${blocked ? "text-red-600" : "text-amber-700"}`}>{l.dispatchLabel}</p> : null}
                        <p className="mt-0.5 text-[14px] text-slate-700">{rupees(symbol, Number(l.unitPrice || l.price) * l.quantity)}</p>
                      </div>
                      <Stepper qty={l.quantity} name={l.name} onLess={() => cart.updateQuantity(sig, l.quantity - 1)} onMore={() => cart.updateQuantity(sig, l.quantity + 1)} />
                    </li>
                  );
                })}
              </ul>
            )}
            <button type="button" onClick={onClose} className={`mt-1 inline-flex min-h-[44px] items-center gap-1 text-[14px] font-semibold text-brand ${FOCUS}`}>
              + Add more items
            </button>
          </Card>

          {renderOffers && cart.items.length ? (
            <Card title="Offers">{renderOffers({ subtotal: cart.subtotal, orderType, symbol, pickedCode, onPick: setPickedCode, onApplied: setCoupon })}</Card>
          ) : null}

          {delivery ? (
            <Card title="Delivery address">
              {profile.addresses.length > (compact ? 1 : 0) ? (
                <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                  {profile.addresses.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => pickSaved(a)}
                      className={`max-w-[220px] shrink-0 rounded-xl border px-3 py-2 text-left ${address.line1 === a.line1 && address.line2 === a.line2 ? "border-brand bg-orange-50" : "border-slate-200 bg-white"} ${FOCUS}`}
                    >
                      <span className="block text-[13px] font-bold text-slate-900">{a.label}</span>
                      <span className="block truncate text-[12px] text-slate-500">{[a.line2, a.line1].filter(Boolean).join(", ")}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {compact ? (
                <div className="mb-2 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-50 text-brand" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-bold text-slate-900">Delivering to {savedInUse.label}</p>
                    <p className="break-words text-[13px] text-slate-600">{[address.line2, address.line1, address.city, address.postalCode].filter(Boolean).join(", ")}</p>
                  </div>
                  <button type="button" onClick={() => setEditing(true)} aria-label="Edit delivery address" className={`min-h-[36px] shrink-0 px-1 text-[13.5px] font-bold text-brand ${FOCUS}`}>
                    Edit
                  </button>
                </div>
              ) : null}
              <div className="space-y-2">
                {compact ? null : (
                  <>
                <input aria-label="House or flat, floor, building" placeholder="House / flat, floor, building" className={INPUT} value={address.line2} onChange={(e) => setAddress((a) => ({ ...a, line2: e.target.value }))} autoComplete="address-line2" />
                <input aria-label="Street and area" placeholder="Street and area *" className={INPUT} value={address.line1} onChange={(e) => setAddress((a) => ({ ...a, line1: e.target.value }))} autoComplete="address-line1" />
                <div className="flex gap-2">
                  <input aria-label="City" placeholder="City" className={INPUT} value={address.city} onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))} autoComplete="address-level2" />
                  <input aria-label="Pincode" placeholder="Pincode" inputMode="numeric" maxLength={6} className={`${INPUT} ${state.pinBad ? "border-red-500" : ""}`} value={address.postalCode} onChange={(e) => setAddress((a) => ({ ...a, postalCode: e.target.value.replace(/\D/g, "").slice(0, 6) }))} autoComplete="postal-code" />
                </div>
                  </>
                )}
                <input aria-label="Instructions for the delivery partner" placeholder="Instructions for delivery (optional)" className={INPUT} maxLength={200} value={address.instructions} onChange={(e) => setAddress((a) => ({ ...a, instructions: e.target.value }))} />
              </div>
              {compact ? null : (
              <div className="mt-3 flex items-center gap-2" role="radiogroup" aria-label="Save address as">
                <span className="text-[13px] text-slate-500">Save as</span>
                {ADDRESS_LABELS.map((label) => (
                  <button key={label} type="button" role="radio" aria-checked={saveAs === label} onClick={() => setSaveAs(label)} className={`min-h-[34px] rounded-full border px-3 text-[13px] font-semibold ${saveAs === label ? "border-brand bg-orange-50 text-brand" : "border-slate-300 text-slate-600"} ${FOCUS}`}>
                    {label}
                  </button>
                ))}
              </div>
              )}
            </Card>
          ) : (
            <Card title="Pickup time">
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["now", "As soon as possible"],
                  ["later", "Later today"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPickupWhen(key)}
                    disabled={key === "later" && slots.length === 0}
                    className={`min-h-[44px] rounded-xl border text-[14px] font-semibold disabled:opacity-40 ${pickupWhen === key ? "border-brand bg-orange-50 text-brand" : "border-slate-300 bg-white text-slate-700"} ${FOCUS}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {pickupWhen === "later" ? (
                <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Pickup time">
                  {slots.map((t) => {
                    const iso = t.toISOString();
                    return (
                      <button key={iso} type="button" role="radio" aria-checked={pickupAt === iso} onClick={() => setPickupAt(iso)} className={`min-h-[38px] rounded-full border px-3 text-[13px] font-semibold ${pickupAt === iso ? "border-brand bg-brand text-white" : "border-slate-300 bg-white text-slate-700"} ${FOCUS}`}>
                        {clock(t)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </Card>
          )}

          <Card title="Your details">
            <div className="space-y-2">
              <input aria-label="Your name" placeholder="Your name *" className={INPUT} value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} autoComplete="name" maxLength={60} />
              <input aria-label="Mobile number" placeholder="10-digit mobile number *" type="tel" inputMode="numeric" maxLength={10} className={INPUT} value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))} autoComplete="tel-national" />
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-slate-600">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-[color:var(--brand)]" />
              Remember my details{delivery ? " and address" : ""} on this device
            </label>
          </Card>

          {cart.items.length ? (
            <Card title="Bill details">
              <dl className="space-y-1.5 text-[14px] text-slate-600">
                <Row label="Item total" value={rupees(symbol, cart.subtotal)} />
                {bill.discount ? <Row label="Offer" value={`−${rupees(symbol, bill.discount)}`} good /> : null}
                {delivery ? <Row label="Delivery fee" value={bill.deliveryFee ? rupees(symbol, bill.deliveryFee) : "Free"} good={!bill.deliveryFee} /> : null}
                {bill.packaging ? <Row label="Packaging" value={rupees(symbol, bill.packaging)} /> : null}
                {bill.taxAmount ? <Row label={`Taxes (${ordering?.taxPercent}%)`} value={rupees(symbol, bill.taxAmount)} /> : null}
                {bill.platformFee ? <Row label="Platform fee" value={rupees(symbol, bill.platformFee)} /> : null}
                {bill.platformFee && platformFeeNote ? <p className="text-[12px] text-slate-400">{platformFeeNote}</p> : null}
                <div className="mt-1 flex justify-between border-t border-dashed border-slate-300 pt-2 text-[16px] font-bold text-slate-900">
                  <dt>To pay</dt>
                  <dd>{rupees(symbol, bill.total)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-[12px] text-slate-400">The restaurant&apos;s final bill is worked out when you pay.</p>
            </Card>
          ) : null}

          {error ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-red-700">
              {error}
              {errorCode === "COUPON_USED" ? (
                <button type="button" onClick={() => setPickedCode("")} className="ml-2 font-semibold underline">
                  Remove offer
                </button>
              ) : null}
            </div>
          ) : null}
          {agreement ? <p className="px-2 text-center text-[12px] text-slate-500">{agreement}</p> : null}
        </div>

        <footer className="border-t border-slate-200 bg-white p-3">
          {!error && state.reason && cart.items.length ? (
            <p role="status" className="mb-2 text-center text-[13px] font-medium text-red-600">
              {state.reason}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={!state.canSubmit}
            className={`flex w-full items-center justify-between rounded-2xl bg-brand px-5 py-3.5 text-white shadow-lg disabled:opacity-50 ${FOCUS}`}
          >
            <span className="text-left">
              <span className="block text-[16px] font-bold">{rupees(symbol, bill.total)}</span>
              <span className="block text-[11.5px] opacity-90">TOTAL</span>
            </span>
            <span className="text-[16px] font-bold">{placing ? "Opening payment…" : "Proceed to pay ›"}</span>
          </button>
        </footer>
      </form>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]" aria-label={title}>
      <h3 className="mb-2 text-[13px] font-bold uppercase tracking-[0.12em] text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value, good = false }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className={good ? "font-semibold text-[color:var(--ke-good,#15803D)]" : ""}>{value}</dd>
    </div>
  );
}

/** − n + for a basket line. */
export function Stepper({ qty, name, onLess, onMore }) {
  return (
    <div className="flex h-9 shrink-0 items-center overflow-hidden rounded-lg border border-brand bg-orange-50 text-brand">
      <button type="button" onClick={onLess} aria-label={`One less ${name}`} className={`h-9 w-9 text-[18px] font-bold ${FOCUS}`}>
        −
      </button>
      <span className="min-w-[1.5rem] text-center text-[14px] font-bold" aria-live="polite">
        {qty}
      </span>
      <button type="button" onClick={onMore} aria-label={`One more ${name}`} className={`h-9 w-9 text-[18px] font-bold ${FOCUS}`}>
        +
      </button>
    </div>
  );
}
