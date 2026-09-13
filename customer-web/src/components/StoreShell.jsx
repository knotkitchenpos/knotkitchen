import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import ProductCard from "./ProductCard";
import { dispatchLabel } from "../lib/dispatch";
import ProductModal from "./ProductModal";
import CartDrawer from "./CartDrawer";
import OrderConfirmation from "./OrderConfirmation";

/**
 * StoreShell — presentational layout that receives the resolved store data
 * plus the cart controller from <StorePage />.
 *
 * Two rendering paths:
 *   - `store` present: full menu + hero + categories.
 *   - `bootstrap` only: header + hero + skeleton, so the site paints instantly
 *     while the menu is still fetching.
 */
export default function StoreShell({
  homePath,
  bootstrap,
  store,
  loadingFull,
  cart,
  placing,
  placeError,
  confirmedOrder,
  onPlaceOrder,
  onDismissOrder,
}) {
  const [selected, setSelected] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [added, setAdded] = useState("");
  const addedTimer = useRef(0);

  const b = bootstrap || {};
  const s = store || {};
  const branding = s.branding || {
    siteTitle: b.siteTitle || b.name,
    tagline: b.tagline,
    logo: b.logoUrl,
    coverImage: b.coverImageUrl,
  };
  const ordering = s.ordering || {
    currencySymbol: b.currencySymbol,
    currency: b.currency,
    pickupEnabled: b.pickupEnabled,
    deliveryEnabled: b.deliveryEnabled,
  };
  const symbol = ordering.currencySymbol || "£";
  const websiteEnabled = b.websiteEnabled !== false && s.store?.acceptingOrders !== false;

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        homePath={homePath}
        title={branding.siteTitle || b.name || "Restaurant"}
        logo={branding.logo}
        cartCount={cart.count}
        onOpenCart={() => setCartOpen(true)}
      />

      <Hero
        coverImage={branding.coverImage}
        title={branding.siteTitle || b.name || "Restaurant"}
        tagline={branding.tagline || ""}
      />

      <main className="max-w-5xl mx-auto px-4 py-6">
        {!websiteEnabled ? (
          <Notice tone="warn">
            This restaurant is not accepting online orders right now.
          </Notice>
        ) : null}

        {loadingFull && !s.categories ? (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 mt-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-56 rounded-2xl bg-slate-200 animate-pulse" />
            ))}
          </div>
        ) : (s.categories || []).length === 0 ? (
          <Notice>This restaurant hasn't published a menu yet. Please check back later.</Notice>
        ) : (
          (s.categories || []).map((category) => {
            // A category the restaurant has restricted to one order type says
            // so here, so the customer knows before they add anything rather
            // than being refused at the payment step.
            const dispatch = dispatchLabel(category.dispatchType);
            return (
            <section key={category.id} className="mt-8">
              <h2 className="text-lg font-semibold text-slate-900 mb-3 flex flex-wrap items-center gap-2">
                <span>
                  {category.icon ? <span className="mr-2">{category.icon}</span> : null}
                  {category.name}
                </span>
                {dispatch ? (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    {dispatch}
                  </span>
                ) : null}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                {category.products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    symbol={symbol}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            </section>
            );
          })
        )}

        {s.contact ? <Footer contact={s.contact} openingHours={s.openingHours} /> : null}
      </main>

      {selected ? (
        <ProductModal
          product={selected}
          symbol={symbol}
          allowNotes={ordering.specialInstructionsEnabled !== false}
          onClose={() => setSelected(null)}
          onAdd={(line) => {
            // Stay on the menu: customers add several dishes, then open the
            // cart themselves when they are ready.
            cart.addItem(line);
            setAdded(line.name || "Item");
            window.clearTimeout(addedTimer.current);
            addedTimer.current = window.setTimeout(() => setAdded(""), 2200);
          }}
        />
      ) : null}

      {cart.count > 0 && !cartOpen ? (
        <div className="fixed inset-x-0 bottom-0 z-[90] p-3 sm:p-4 pointer-events-none">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="pointer-events-auto mx-auto flex w-full max-w-md items-center justify-between rounded-full bg-brand px-5 py-3.5 text-brand-fg font-semibold shadow-xl"
          >
            <span>
              {added ? `Added ${added}` : `${cart.count} item${cart.count === 1 ? "" : "s"}`}
            </span>
            <span>
              View cart · {symbol}
              {cart.subtotal.toFixed(2)}
            </span>
          </button>
        </div>
      ) : null}

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        ordering={ordering}
        storeOpen={s.store?.isOpen !== false}
        onPlaceOrder={onPlaceOrder}
        placing={placing}
        error={placeError}
      />

      {confirmedOrder ? (
        <OrderConfirmation
          order={confirmedOrder}
          symbol={symbol}
          prepTime={ordering.prepTimeMinutes}
          onClose={onDismissOrder}
        />
      ) : null}
    </div>
  );
}

function Header({ homePath, title, logo, cartCount, onOpenCart }) {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-5xl mx-auto flex items-center justify-between px-4 py-3">
        {/* The masthead is the way back to the landing page — the convention
            everywhere else on the web, and the only route back now that the
            menu is no longer the front page. */}
        <Link to={homePath || "/"} className="flex items-center gap-3 min-w-0">
          {logo ? (
            <img src={logo} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : null}
          <span className="font-semibold text-slate-900 truncate">{title}</span>
        </Link>
        <button
          type="button"
          onClick={onOpenCart}
          className="relative bg-brand text-brand-fg px-4 py-2 rounded-full text-sm font-semibold"
        >
          Cart{cartCount ? ` · ${cartCount}` : ""}
        </button>
      </div>
    </header>
  );
}

function Hero({ coverImage, title, tagline }) {
  return (
    <section
      className="relative h-56 sm:h-72 bg-slate-800 text-white flex items-end"
      style={
        coverImage
          ? { backgroundImage: `url(${coverImage})`, backgroundSize: "cover", backgroundPosition: "center" }
          : undefined
      }
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      <div className="relative max-w-5xl w-full mx-auto px-4 pb-6">
        <h1 className="text-2xl sm:text-3xl font-bold">{title}</h1>
        {tagline ? <p className="text-white/80 text-sm mt-1">{tagline}</p> : null}
      </div>
    </section>
  );
}

function Notice({ tone = "info", children }) {
  const cls = tone === "warn" ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-slate-50 border-slate-200 text-slate-700";
  return (
    <div className={`mt-4 border rounded-2xl px-4 py-3 text-sm ${cls}`}>{children}</div>
  );
}

function Footer({ contact, openingHours }) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <footer className="mt-12 border-t pt-6 pb-10 text-sm text-slate-600 grid sm:grid-cols-2 gap-6">
      <div>
        <h3 className="font-semibold text-slate-900 mb-2">Contact</h3>
        {contact?.phone ? <div>📞 {contact.phone}</div> : null}
        {contact?.email ? <div>✉️ {contact.email}</div> : null}
        {contact?.addressLine1 ? (
          <div className="mt-1">
            {contact.addressLine1}
            {contact.city ? `, ${contact.city}` : ""}
            {contact.postalCode ? ` ${contact.postalCode}` : ""}
          </div>
        ) : null}
      </div>
      {openingHours?.length ? (
        <div>
          <h3 className="font-semibold text-slate-900 mb-2">Opening hours</h3>
          <ul className="space-y-0.5">
            {openingHours.map((h) => (
              <li key={h.day} className="flex justify-between max-w-xs">
                <span>{days[h.day]}</span>
                <span>{h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </footer>
  );
}
