import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import BottomNav from "../components/BottomNav";
import { clearProfile, removeAddress, saveContact, useEatsProfile } from "../../lib/eatsProfile";
import { useEatsLocation } from "../../lib/eatsLocation";
import { clearSaved } from "../../lib/eatsSaved";
import { clearRecentOrders } from "../../lib/eatsOrders";
import { clearCartFor, getActiveCart } from "../../lib/eatsCart";
import { BTN_PRIMARY, FOCUS, useTitle } from "../shared";

const INPUT = "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-[15px] focus:border-brand focus:outline-none";

/**
 * /account. Knot Eats has no sign-in: this is what THIS device remembers
 * (lib/eatsProfile): the details checkout fills in and the saved addresses,
 * the way to the orders and favourites, help, policies, and Clear my data.
 */
export default function AccountPage() {
  useTitle("Account");
  const navigate = useNavigate();
  const profile = useEatsProfile();
  const { setLocation, clearLocation } = useEatsLocation();
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const phoneOk = /^[6-9]\d{9}$/.test(phone);
  const dirty = name.trim() !== profile.name || phone !== profile.phone;

  const save = (e) => {
    e.preventDefault();
    if (!phoneOk && phone) return;
    saveContact({ name, phone });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const deliverHere = (a) => {
    setLocation({ lat: a.lat, lng: a.lng, label: `${a.label}: ${a.line1}`.slice(0, 80), source: "places" });
    navigate("/");
  };

  const clearAll = () => {
    clearProfile();
    clearSaved();
    clearRecentOrders();
    const cart = getActiveCart();
    if (cart) clearCartFor(cart.storeId);
    clearLocation();
    setName("");
    setPhone("");
    setConfirming(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-100 text-[20px] font-extrabold text-brand" aria-hidden="true">
            {(profile.name || "K").charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[20px] font-extrabold text-[color:var(--ke-ink)]">{profile.name || "Your account"}</h1>
            <p className="text-[13px] text-slate-500">{profile.phone ? `+91 ${profile.phone}` : "Your details are kept on this device"}</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-3 px-3 pt-3">
        <nav className="grid grid-cols-2 gap-3" aria-label="Your activity">
          <Tile to="/orders" title="Your orders" sub="Track, reorder, rate" />
          <Tile to="/saved" title="Favourites" sub="Saved restaurants" />
        </nav>

        <Section title="Your details">
          <form onSubmit={save} className="space-y-2">
            <input aria-label="Your name" placeholder="Name" className={INPUT} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            <input aria-label="Mobile number" placeholder="10-digit mobile number" type="tel" inputMode="numeric" maxLength={10} className={`${INPUT} ${phone && !phoneOk ? "border-red-500" : ""}`} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} autoComplete="tel-national" />
            {phone && !phoneOk ? <p className="text-[13px] text-red-600">Enter a 10-digit mobile number starting 6 to 9.</p> : null}
            <button type="submit" disabled={!dirty || (phone && !phoneOk)} className={`${BTN_PRIMARY} w-full disabled:opacity-50`}>
              {saved ? "Saved" : "Save details"}
            </button>
          </form>
          <p className="mt-2 text-[12.5px] text-slate-500">Used to fill in checkout. Restaurants only see them on an order you place.</p>
        </Section>

        <Section title="Saved addresses">
          {profile.addresses.length === 0 ? (
            <p className="text-[14px] text-slate-500">Addresses you deliver to are saved here when you tick &quot;Remember my details&quot; at checkout.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {profile.addresses.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-3">
                  <span className="mt-0.5 rounded-lg bg-slate-100 px-2 py-0.5 text-[12px] font-bold text-slate-700">{a.label}</span>
                  <div className="min-w-0 flex-1 text-[14px] text-slate-700">
                    <p className="break-words">{[a.line2, a.line1].filter(Boolean).join(", ")}</p>
                    {a.city || a.postalCode ? <p className="text-[12.5px] text-slate-500">{[a.city, a.postalCode].filter(Boolean).join(" ")}</p> : null}
                    <div className="mt-1.5 flex gap-3">
                      {Number.isFinite(a.lat) ? (
                        <button type="button" onClick={() => deliverHere(a)} className={`min-h-[36px] text-[13px] font-semibold text-brand ${FOCUS}`}>
                          Deliver here
                        </button>
                      ) : null}
                      <button type="button" onClick={() => removeAddress(a.id)} className={`min-h-[36px] text-[13px] font-semibold text-slate-500 ${FOCUS}`}>
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Help & policies">
          <ul className="divide-y divide-slate-100 text-[15px]">
            <Row to="/legal/refunds">Refunds &amp; cancellations</Row>
            <Row to="/legal/grievance">Grievance redressal</Row>
            <Row to="/legal/terms">Terms of use</Row>
            <Row to="/legal/privacy">Privacy policy</Row>
            <li>
              <a href="https://knotkitchen.com/#contact" className={`flex min-h-[48px] items-center justify-between font-semibold text-brand ${FOCUS}`}>
                List your restaurant <span aria-hidden="true">›</span>
              </a>
            </li>
          </ul>
          <p className="mt-2 text-[12.5px] text-slate-500">For a problem with an order, open it under Your orders and call the restaurant.</p>
        </Section>

        <Section title="This device">
          {confirming ? (
            <div className="space-y-2">
              <p className="text-[14px] text-slate-700">Forget your details, addresses, favourites, recent orders, cart and location on this device? Your orders themselves are not affected.</p>
              <div className="flex gap-2">
                <button type="button" onClick={clearAll} className={`min-h-[44px] flex-1 rounded-xl bg-red-600 px-4 text-[14px] font-semibold text-white ${FOCUS}`}>
                  Clear everything
                </button>
                <button type="button" onClick={() => setConfirming(false)} className={`min-h-[44px] flex-1 rounded-xl border border-slate-300 px-4 text-[14px] font-semibold ${FOCUS}`}>
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className={`min-h-[44px] text-[14px] font-semibold text-red-600 ${FOCUS}`}>
              Clear my data
            </button>
          )}
        </Section>
        <p className="py-4 text-center text-[12px] text-slate-400">Knot Eats by KnotKitchen</p>
      </div>
      <BottomNav />
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]" aria-label={title}>
      <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.12em] text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function Tile({ to, title, sub }) {
  return (
    <Link to={to} className={`rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)] ${FOCUS}`}>
      <span className="block text-[15px] font-extrabold text-[color:var(--ke-ink)]">{title}</span>
      <span className="block text-[12.5px] text-slate-500">{sub}</span>
    </Link>
  );
}

function Row({ to, children }) {
  return (
    <li>
      <Link to={to} className={`flex min-h-[48px] items-center justify-between text-slate-800 ${FOCUS}`}>
        {children} <span aria-hidden="true" className="text-slate-400">›</span>
      </Link>
    </li>
  );
}
