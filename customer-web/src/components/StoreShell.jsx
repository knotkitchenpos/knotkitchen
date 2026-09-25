import React, { useEffect, useMemo, useRef, useState } from "react";
import { LegalLinks } from "./landing/parts";
import { Link, useLocation } from "react-router-dom";
import ProductCard from "./ProductCard";
import ProductModal from "./ProductModal";
import CartDrawer from "./CartDrawer";
import { thumbUrl } from "../lib/thumbUrl";

// A logo or cover whose file is gone hides instead of showing a broken image.
const hideBroken = (e) => {
  e.currentTarget.style.display = "none";
};

/**
 * StoreShell — the ordering page, laid out the way food-delivery apps are:
 * the restaurant's details on top, its offers, then the menu with the
 * categories down the left (a floating "Menu" button on a phone), each dish a
 * row with its photo and an ADD button, and the cart as a bar at the bottom.
 * In the store's own colours (--brand).
 *
 * Two rendering paths:
 *   - `store` present: full menu.
 *   - `bootstrap` only: header + details + skeleton, so the site paints
 *     instantly while the menu is still fetching.
 *
 * No blur anywhere on this page: older Android WebViews ghost the list while
 * scrolling under a frosted bar (lib/scrollPerf.test.mjs).
 */
const HEADER_OFFSET = 132; // header + search bar, so a section lands below them

export default function StoreShell({
  homePath,
  bootstrap,
  store,
  loadingFull,
  cart,
  placing,
  placeError,
  onPlaceOrder,
  notice,
}) {
  const [selected, setSelected] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [added, setAdded] = useState("");
  const [query, setQuery] = useState("");
  const [vegOnly, setVegOnly] = useState(false);
  const [activeCat, setActiveCat] = useState("");
  const addedTimer = useRef(0);
  const { pathname } = useLocation();

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
  const title = branding.siteTitle || b.name || "Restaurant";
  const websiteEnabled =
    b.websiteEnabled !== false && s.store?.acceptingOrders !== false;

  // Search and "Veg only" narrow every category; one left empty is not drawn.
  const q = query.trim().toLowerCase();
  const categories = useMemo(
    () =>
      (s.categories || [])
        .map((c) => ({
          ...c,
          products: c.products.filter(
            (p) =>
              (!vegOnly || p.isVegetarian) &&
              (!q ||
                `${p.name} ${p.description || ""} ${c.name}`
                  .toLowerCase()
                  .includes(q)),
          ),
        }))
        .filter((c) => c.products.length > 0),
    [s.categories, vegOnly, q],
  );

  // "Bestseller": the landing page's popular dishes (the operator's pick or
  // the month's best sellers); "Must try": dishes the restaurant featured.
  const bestsellers = useMemo(
    () => new Set((s.landing?.featuredItems || []).map(String)),
    [s.landing],
  );
  const tagFor = (p) =>
    p.isFeatured
      ? "Must try"
      : bestsellers.has(String(p.id))
        ? "Bestseller"
        : "";

  // The category being read lights up in the list as the page scrolls.
  useEffect(() => {
    const sections = [...document.querySelectorAll("[data-cat]")];
    if (!sections.length || typeof IntersectionObserver === "undefined")
      return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (x, y) => x.boundingClientRect.top - y.boundingClientRect.top,
          )[0];
        if (top) setActiveCat(top.target.getAttribute("data-cat"));
      },
      { rootMargin: `-${HEADER_OFFSET}px 0px -55% 0px` },
    );
    sections.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [categories]);

  const goTo = (id) => {
    setMenuOpen(false);
    setActiveCat(String(id));
    const el = document.getElementById(`cat-${id}`);
    if (el)
      window.scrollTo({
        top:
          el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET + 8,
        behavior: "smooth",
      });
  };

  const onAdded = (name) => {
    setAdded(name || "Item");
    window.clearTimeout(addedTimer.current);
    addedTimer.current = window.setTimeout(() => setAdded(""), 2200);
  };

  const showCartBar = cart.count > 0 && !cartOpen;
  const overview = homePath && homePath !== pathname ? homePath : "";

  return (
    <div className="min-h-screen bg-white">
      <Header
        homePath={homePath}
        title={title}
        logo={branding.logo}
        cartCount={cart.count}
        onOpenCart={() => setCartOpen(true)}
      />

      <div className="mx-auto max-w-6xl px-4">
        <RestaurantInfo
          title={title}
          tagline={branding.tagline || ""}
          coverImage={branding.coverImage}
          contact={s.contact}
          openingHours={s.openingHours}
          storeState={s.store}
          ordering={s.ordering ? ordering : null}
          symbol={symbol}
        />

        <nav
          className="mt-2 flex gap-8 border-b border-slate-200 text-[15px]"
          aria-label="Restaurant"
        >
          {overview ? (
            <Link
              to={overview}
              className="py-3 text-slate-500 hover:text-slate-800"
            >
              Overview
            </Link>
          ) : null}
          <span
            className="-mb-px border-b-2 border-brand py-3 font-semibold text-brand"
            aria-current="page"
          >
            Order Online
          </span>
        </nav>

        {s.offers?.length ? <Offers offers={s.offers} /> : null}

        {notice ? <Notice tone="warn">{notice}</Notice> : null}
        {!websiteEnabled ? (
          <Notice tone="warn">
            This restaurant is not accepting online orders right now.
          </Notice>
        ) : null}

        {loadingFull && !s.categories ? (
          <div className="mt-6 space-y-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-1/5 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
                </div>
                <div className="aspect-[4/3] w-[132px] animate-pulse rounded-xl bg-slate-200" />
              </div>
            ))}
          </div>
        ) : (s.categories || []).length === 0 ? (
          <Notice>
            This restaurant hasn&apos;t published a menu yet. Please check back
            later.
          </Notice>
        ) : (
          <div className="lg:grid lg:grid-cols-[230px_1fr] lg:gap-8">
            {/* Categories, down the left on a wide screen. */}
            <aside className="hidden lg:block">
              <ul className="sticky top-[76px] max-h-[calc(100vh-96px)] overflow-y-auto border-r border-slate-200 py-6">
                {categories.map((c) => {
                  const on = activeCat === String(c.id);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => goTo(c.id)}
                        aria-current={on ? "true" : undefined}
                        className={`relative -mr-px w-full py-2.5 pl-2 pr-4 text-left text-[15px] ${
                          on
                            ? "border-r-[3px] border-brand font-semibold text-brand"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {on ? (
                          <span
                            className="absolute inset-0 bg-brand opacity-[0.07]"
                            aria-hidden="true"
                          />
                        ) : null}
                        <span className="relative">
                          {c.name} ({c.products.length})
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            <section className="min-w-0 pb-40">
              <div className="sticky top-[60px] z-30 -mx-4 bg-white px-4 pb-3 pt-4 lg:mx-0 lg:px-0">
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <span
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    >
                      <SearchIcon />
                    </span>
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search within menu"
                      aria-label="Search within menu"
                      className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-[14px] outline-none focus:border-brand"
                    />
                  </div>
                  <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-[14px] text-slate-700">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={vegOnly}
                      onChange={(e) => setVegOnly(e.target.checked)}
                    />
                    <span className="relative h-5 w-9 rounded-full bg-slate-300 transition peer-checked:bg-green-600 peer-focus-visible:ring-2 peer-focus-visible:ring-green-300 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
                    Veg only
                  </label>
                </div>
              </div>

              {categories.length === 0 ? (
                <Notice>
                  {q
                    ? `No dishes match “${query.trim()}”.`
                    : "No vegetarian dishes on the menu right now."}
                </Notice>
              ) : (
                categories.map((category) => (
                  <div
                    key={category.id}
                    id={`cat-${category.id}`}
                    data-cat={String(category.id)}
                    className="pt-4"
                  >
                    <h3 className="text-[20px] font-semibold text-slate-900">
                      {category.icon ? (
                        <span className="mr-2">{category.icon}</span>
                      ) : null}
                      {category.name}
                    </h3>
                    <p className="mt-0.5 text-[13px] text-slate-500">
                      {category.products.length} item
                      {category.products.length === 1 ? "" : "s"}
                      {/* A category the restaurant restricted to one order type
                          says so up front, not at the payment step. */}
                      {category.dispatchLabel ? (
                        <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                          {category.dispatchLabel}
                        </span>
                      ) : null}
                    </p>
                    {category.products.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        symbol={symbol}
                        tag={tagFor(product)}
                        cart={cart}
                        onSelect={setSelected}
                        onOpenCart={() => setCartOpen(true)}
                        onAdded={onAdded}
                      />
                    ))}
                  </div>
                ))
              )}
            </section>
          </div>
        )}

        {s.contact ? (
          <Footer
            contact={s.contact}
            openingHours={s.openingHours}
            legal={s.legal}
          />
        ) : null}
      </div>

      {/* Phone: the category list is one tap away, floating over the menu. */}
      {categories.length > 1 && !cartOpen ? (
        <div
          className={`fixed inset-x-0 z-[85] flex justify-center lg:hidden pointer-events-none ${showCartBar ? "bottom-24" : "bottom-6"}`}
        >
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-[14px] font-semibold text-white shadow-xl"
          >
            <MenuIcon /> Menu
          </button>
        </div>
      ) : null}
      {menuOpen ? (
        <MenuSheet
          categories={categories}
          activeCat={activeCat}
          onPick={goTo}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}

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
            onAdded(line.name);
          }}
        />
      ) : null}

      {showCartBar ? (
        <div className="fixed inset-x-0 bottom-0 z-[90] p-3 sm:p-4 pointer-events-none">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="pointer-events-auto mx-auto flex w-full max-w-xl items-center justify-between rounded-xl bg-brand px-5 py-3 text-left text-brand-fg shadow-xl"
          >
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold">
                {added
                  ? `Added ${added}`
                  : `${cart.count} item${cart.count === 1 ? "" : "s"} added`}
              </span>
              <span className="block text-[12px] opacity-90">
                {symbol}
                {cart.subtotal.toFixed(2)} · plus taxes &amp; charges
              </span>
            </span>
            <span className="shrink-0 text-[15px] font-bold">View cart ›</span>
          </button>
        </div>
      ) : null}

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        ordering={ordering}
        availability={s.availability}
        onPlaceOrder={onPlaceOrder}
        placing={placing}
        error={placeError}
      />
    </div>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const time12 = (hhmm) => {
  const [h, m] = String(hhmm || "")
    .split(":")
    .map(Number);
  if (!Number.isFinite(h)) return hhmm || "";
  const d = new Date();
  d.setHours(h, Number.isFinite(m) ? m : 0, 0, 0);
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
};

/** Name, what it serves, where, whether it is open, and the ways to reach it. */
function RestaurantInfo({
  title,
  tagline,
  coverImage,
  contact,
  openingHours,
  storeState,
  ordering,
  symbol,
}) {
  const [copied, setCopied] = useState(false);
  const today = (openingHours || []).find(
    (h) => Number(h.day) === new Date().getDay(),
  );
  const address = [contact?.addressLine1, contact?.city]
    .filter(Boolean)
    .join(", ");
  const phone = contact?.phone
    ? String(contact.phone).replace(/[^\d+]/g, "")
    : "";

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) return await navigator.share({ title, url });
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* dismissed, or no clipboard: nothing to do */
    }
  };

  const chips = [];
  if (ordering) {
    if (ordering.pickupEnabled !== false) chips.push("Pickup");
    if (ordering.deliveryEnabled) chips.push("Delivery");
    if (ordering.prepTimeMinutes)
      chips.push(`Ready in ~${ordering.prepTimeMinutes} min`);
    if (Number(ordering.minOrderValue) > 0)
      chips.push(`Min order ${symbol}${Number(ordering.minOrderValue)}`);
  }

  return (
    <section className="pt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight text-slate-900 sm:text-[34px]">
            {title}
          </h1>
          {tagline ? (
            <p className="mt-1 text-[15px] text-slate-500 sm:text-[16px]">
              {tagline}
            </p>
          ) : null}
          {address ? (
            <p className="mt-0.5 text-[14px] text-slate-400">{address}</p>
          ) : null}
          {storeState ? (
            <p className="mt-1.5 text-[14px]">
              {storeState.isOpen ? (
                <span className="font-medium text-orange-600">Open now</span>
              ) : (
                <span className="font-medium text-red-600">
                  Closed
                  {storeState.closedReason
                    ? ` · ${storeState.closedReason}`
                    : ""}
                </span>
              )}
              {today ? (
                <span className="text-slate-500">
                  {" "}
                  –{" "}
                  {today.isOpen
                    ? `${time12(today.openTime)} – ${time12(today.closeTime)} (Today)`
                    : "Closed today"}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        {coverImage ? (
          <img
            src={thumbUrl(coverImage, 640)}
            alt=""
            onError={hideBroken}
            className="aspect-[4/3] w-28 shrink-0 rounded-xl object-cover sm:w-64"
          />
        ) : null}
      </div>
      {chips.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span
              key={c}
              className="rounded-md bg-slate-100 px-2.5 py-1 text-[12.5px] font-medium text-slate-700"
            >
              {c}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {contact?.mapUrl ? (
          <a
            href={contact.mapUrl}
            target="_blank"
            rel="noreferrer"
            className={ACTION}
          >
            <PinIcon /> Direction
          </a>
        ) : null}
        {phone ? (
          <a href={`tel:${phone}`} className={ACTION}>
            <PhoneIcon /> Call
          </a>
        ) : null}
        <button type="button" onClick={share} className={ACTION}>
          <ShareIcon /> {copied ? "Link copied" : "Share"}
        </button>
      </div>
    </section>
  );
}

const ACTION =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-[14px] text-slate-700 hover:bg-slate-50";

function Offers({ offers }) {
  return (
    <div className="-mx-4 mt-5 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
      {offers.map((o, i) => (
        <div
          key={`${o.title}-${i}`}
          className="flex w-[260px] shrink-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-[16px] font-bold text-brand-fg"
            aria-hidden="true"
          >
            %
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold text-slate-900">
              {o.title}
            </span>
            <span className="block truncate text-[12.5px] text-slate-500">
              {o.code ? `Use code ${o.code}` : o.description || ""}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function MenuSheet({ categories, activeCat, onPick, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/40 p-4 pb-24 lg:hidden"
      onClick={onClose}
      role="dialog"
      aria-label="Menu"
    >
      <ul
        className="max-h-[60vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-slate-900 p-2 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {categories.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c.id)}
              className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-[15px] ${
                activeCat === String(c.id)
                  ? "font-semibold text-accent"
                  : "text-white/90"
              }`}
            >
              <span className="truncate">{c.name}</span>
              <span className="ml-3 shrink-0 text-white/60">
                {c.products.length}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Header({ homePath, title, logo, cartCount, onOpenCart }) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* The masthead is the way back to the landing page. */}
        <Link to={homePath || "/"} className="flex min-w-0 items-center gap-3">
          {logo ? (
            <img src={thumbUrl(logo, 160)} alt="" onError={hideBroken} className="h-9 w-9 rounded-full object-cover" />
          ) : null}
          <span className="truncate font-semibold text-slate-900">{title}</span>
        </Link>
        <button
          type="button"
          onClick={onOpenCart}
          className="relative rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg"
        >
          Cart{cartCount ? ` · ${cartCount}` : ""}
        </button>
      </div>
    </header>
  );
}

function Notice({ tone = "info", children }) {
  const cls =
    tone === "warn"
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-slate-50 border-slate-200 text-slate-700";
  return (
    <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

function Footer({ contact, openingHours, legal }) {
  return (
    <footer className="mt-12 grid gap-6 border-t pb-10 pt-6 text-sm text-slate-600 sm:grid-cols-2">
      <div>
        <h3 className="mb-2 font-semibold text-slate-900">Contact</h3>
        {contact?.phone ? (
          <div>
            📞{" "}
            <a href={`tel:${String(contact.phone).replace(/[^\d+]/g, "")}`}>
              {contact.phone}
            </a>
          </div>
        ) : null}
        {contact?.email ? (
          <div>
            ✉️ <a href={`mailto:${contact.email}`}>{contact.email}</a>
          </div>
        ) : null}
        {contact?.addressLine1 ? (
          <div className="mt-1">
            {contact.addressLine1}
            {contact.addressLine2 ? `, ${contact.addressLine2}` : ""}
            {contact.city ? `, ${contact.city}` : ""}
            {contact.postalCode ? ` ${contact.postalCode}` : ""}
          </div>
        ) : null}
        {contact?.mapUrl ? (
          <a
            href={contact.mapUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block underline underline-offset-2"
          >
            Open in Google Maps ↗
          </a>
        ) : null}
      </div>
      {openingHours?.length ? (
        <div>
          <h3 className="mb-2 font-semibold text-slate-900">Opening hours</h3>
          <ul className="space-y-0.5">
            {openingHours.map((h) => (
              <li key={h.day} className="flex max-w-xs justify-between">
                <span>{DAYS[h.day]}</span>
                <span>
                  {h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="border-t pt-4 text-xs text-slate-500 sm:col-span-2">
        <LegalLinks fssai={legal?.fssaiNumber || ""} />
        <p className="mt-2">
          Website designed, hosted &amp; secured by{" "}
          <a
            href="https://knotkitchen.com"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            KnotKitchen
          </a>
          .
        </p>
      </div>
    </footer>
  );
}

const svg = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};
const SearchIcon = () => (
  <svg {...svg}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
const PinIcon = () => (
  <svg {...svg}>
    <path d="M12 21s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12Z" />
    <circle cx="12" cy="9" r="2.5" />
  </svg>
);
const PhoneIcon = () => (
  <svg {...svg}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
  </svg>
);
const ShareIcon = () => (
  <svg {...svg}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </svg>
);
const MenuIcon = () => (
  <svg {...svg}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);
