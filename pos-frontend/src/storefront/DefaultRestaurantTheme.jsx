import React, { useEffect, useMemo, useRef, useState } from "react";
import ProductCard from "./components/ProductCard";
import { formatPrice } from "./theme";
import { dispatchLabel } from "./dispatch";

/**
 * "default-restaurant" theme renderer.
 *
 * Purely presentational: it receives the storefront payload and cart callbacks
 * and renders them according to the store's saved layout options. A future
 * theme is a sibling component with the same props — no changes to the data,
 * cart or checkout layers.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DefaultRestaurantTheme = ({ data, cart, onSelectProduct, onOpenCart }) => {
  const { store, branding, theme, ordering, contact, offers, openingHours, categories } = data;
  const layout = theme?.layout || {};
  const sections = theme?.sections || {};
  const symbol = ordering?.currencySymbol || "₹";

  const [activeCategory, setActiveCategory] = useState(categories?.[0]?.id || null);
  const [query, setQuery] = useState("");
  const [vegFilter, setVegFilter] = useState("all"); // "all" | "veg" | "nonveg"
  const [selectedOrderType, setSelectedOrderType] = useState(
    ordering?.pickupEnabled !== false ? "collection" : "delivery"
  );
  const [activePolicyModal, setActivePolicyModal] = useState(null); // "faq" | "privacy" | "terms" | "refund" | "cookies"
  const sectionRefs = useRef({});

  // Highlight the category currently in view while the customer scrolls.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveCategory(visible.target.dataset.categoryId);
      },
      { rootMargin: "-120px 0px -70% 0px", threshold: 0 }
    );

    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [categories]);

  const scrollToCategory = (id) => {
    setActiveCategory(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Client-side search & Veg/Non-Veg filters across loaded menu (preserves cart state).
  const visibleCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    return categories
      .map((c) => ({
        ...c,
        products: c.products.filter((p) => {
          const matchesQuery =
            !q ||
            p.name.toLowerCase().includes(q) ||
            (p.description || "").toLowerCase().includes(q);
          const matchesVeg =
            vegFilter === "all" ||
            (vegFilter === "veg" && (p.isVegetarian || p.isVeg)) ||
            (vegFilter === "nonveg" && (!p.isVegetarian && !p.isVeg));
          return matchesQuery && matchesVeg;
        }),
      }))
      .filter((c) => c.products.length > 0);
  }, [categories, query, vegFilter]);

  const gridClass =
    layout.productCardStyle === "list" || layout.productCardStyle === "compact"
      ? "grid grid-cols-1 lg:grid-cols-2 gap-4"
      : layout.productCardStyle === "showcase"
      ? "grid grid-cols-1 sm:grid-cols-2 gap-6"
      : "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5";

  return (
    <div
      className="min-h-screen bg-[var(--sf-bg)] text-[var(--sf-text)] pb-28 md:pb-0"
      style={{ fontFamily: "var(--sf-body-font)", fontSize: "var(--sf-base-size)" }}
    >
      {/* ---------------- HEADER ---------------- */}
      <header
        className={`sticky top-0 z-40 border-b border-black/5 backdrop-blur-md ${
          layout.headerStyle === "transparent" ? "bg-[var(--sf-bg)]/80" : "bg-[var(--sf-bg)]"
        }`}
      >
        <div
          className={`max-w-6xl mx-auto px-4 py-3 flex items-center gap-4 ${
            layout.headerStyle === "centered" ? "flex-col sm:flex-row sm:justify-center" : ""
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            {branding.logo ? (
              <img
                src={branding.logo}
                alt={`${store.name} logo`}
                className="w-10 h-10 rounded-xl object-cover shrink-0"
              />
            ) : (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shrink-0"
                style={{ background: "var(--sf-primary)" }}
                aria-hidden="true"
              >
                {store.name?.[0]?.toUpperCase() || "K"}
              </div>
            )}
            <div className="min-w-0">
              <h1
                className="font-bold leading-tight truncate"
                style={{ fontFamily: "var(--sf-heading-font)" }}
              >
                {store.name}
              </h1>
              <p className="text-xs text-[var(--sf-muted)] flex items-center gap-1.5 flex-wrap">
                {store.isOpen ? (
                  <span className="text-green-600 font-medium">● Open now</span>
                ) : (
                  <span className="text-red-500 font-medium">● Closed</span>
                )}
                <span>· {contact?.addressLine1 ? `${contact.addressLine1}, ${contact.city || ""}` : "Main Outlet"}</span>
                <span>· 🛍️ Pickup ~{ordering?.prepTimeMinutes || 20} min</span>
                {ordering?.deliveryEnabled !== false && (
                  <span>· 🛵 Delivery ~{ordering?.deliveryTimeMinutes || 45} min</span>
                )}
              </p>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-5 ml-auto text-sm font-medium">
            <a href="#menu" className="hover:text-[var(--sf-primary)]">Menu</a>
            {sections.showOffers && offers?.length ? (
              <a href="#offers" className="hover:text-[var(--sf-primary)]">Offers</a>
            ) : null}
            {sections.showAbout && branding.aboutText ? (
              <a href="#about" className="hover:text-[var(--sf-primary)]">About</a>
            ) : null}
            {sections.showContact ? (
              <a href="#contact" className="hover:text-[var(--sf-primary)]">Contact</a>
            ) : null}
          </nav>

          <button
            type="button"
            onClick={onOpenCart}
            className="ml-auto md:ml-0 relative flex items-center gap-2 px-4 py-2 font-semibold text-sm shadow-sm"
            style={{
              background: "var(--sf-button)",
              color: "var(--sf-button-text)",
              borderRadius: "var(--sf-radius)",
            }}
            aria-label={`Open cart, ${cart.count} items`}
          >
            🛒 <span className="hidden sm:inline">Cart</span>
            {cart.count > 0 ? (
              <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 flex items-center justify-center text-[11px] font-bold rounded-full bg-[var(--sf-accent)] text-white">
                {cart.count}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      {/* ---------------- HERO ---------------- */}
      {layout.heroStyle !== "minimal" ? (
        <section className="relative">
          <div
            className={`relative overflow-hidden ${
              layout.heroStyle === "fullbleed" ? "h-[420px]" : "h-[300px] sm:h-[360px]"
            }`}
          >
            {branding.coverImage ? (
              <img
                src={branding.coverImage}
                alt={branding.coverImageAlt || `${store.name} cover`}
                fetchPriority="high"
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(135deg, var(--sf-primary), var(--sf-secondary))`,
                }}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10" />

            <div className="relative h-full max-w-6xl mx-auto px-4 flex flex-col justify-end pb-8">
              <h2
                className="text-3xl sm:text-5xl font-bold text-white mb-2 drop-shadow"
                style={{ fontFamily: "var(--sf-heading-font)" }}
              >
                {branding.siteTitle || store.name}
              </h2>
              {branding.tagline ? (
                <p className="text-white/90 text-base sm:text-lg mb-5 max-w-xl">{branding.tagline}</p>
              ) : null}
              <a
                href="#menu"
                className="self-start px-7 py-3 font-semibold shadow-lg hover:opacity-90 transition-opacity"
                style={{
                  background: "var(--sf-button)",
                  color: "var(--sf-button-text)",
                  borderRadius: "var(--sf-radius)",
                }}
              >
                Order Now
              </a>
            </div>
          </div>
        </section>
      ) : null}

      {/* ---------------- CLOSED BANNER ---------------- */}
      {!store.isOpen ? (
        <div className="bg-amber-50 border-y border-amber-200 text-amber-900">
          <div className="max-w-6xl mx-auto px-4 py-3 text-sm text-center">
            <strong>Restaurant Closed.</strong>{" "}
            {store.nextOpen
              ? `We reopen ${DAY_NAMES[store.nextOpen.day]} at ${store.nextOpen.time}.`
              : ""}{" "}
            {ordering?.acceptPreOrders ? "You can still place a pre-order." : ""}
          </div>
        </div>
      ) : null}

      {/* ---------------- OFFERS ---------------- */}
      {sections.showOffers && offers?.length ? (
        <section id="offers" className="max-w-6xl mx-auto px-4 py-8">
          <h2 className="text-xl font-bold mb-4" style={{ fontFamily: "var(--sf-heading-font)" }}>
            Offers for you
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
            {offers.map((offer, i) => (
              <div
                key={i}
                className="min-w-[280px] p-5 rounded-2xl border border-black/5 bg-[var(--sf-surface)]"
              >
                <h3 className="font-bold mb-1">{offer.title}</h3>
                {offer.description ? (
                  <p className="text-sm text-[var(--sf-muted)] mb-2">{offer.description}</p>
                ) : null}
                {offer.code ? (
                  <span className="inline-block px-3 py-1 text-xs font-bold rounded-lg border-2 border-dashed border-[var(--sf-primary)] text-[var(--sf-primary)]">
                    {offer.code}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---------------- MENU ---------------- */}
      <section id="menu" className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
          <h2 className="text-2xl font-bold" style={{ fontFamily: "var(--sf-heading-font)" }}>
            Our Menu
          </h2>

          {/* Delivery / Collection Selector */}
          <div className="flex items-center gap-1.5 p-1 bg-black/5 rounded-full text-xs font-bold sm:ml-auto">
            {ordering?.pickupEnabled !== false && (
              <button
                type="button"
                onClick={() => setSelectedOrderType("collection")}
                className={`px-3 py-1.5 rounded-full transition-all ${
                  selectedOrderType === "collection" ? "bg-white text-black shadow-sm" : "text-black/60"
                }`}
              >
                🛍️ Collection (~{ordering?.prepTimeMinutes || 20} min)
              </button>
            )}
            {ordering?.deliveryEnabled !== false && (
              <button
                type="button"
                onClick={() => setSelectedOrderType("delivery")}
                className={`px-3 py-1.5 rounded-full transition-all ${
                  selectedOrderType === "delivery" ? "bg-white text-black shadow-sm" : "text-black/60"
                }`}
              >
                🛵 Delivery (~{ordering?.deliveryTimeMinutes || 45} min)
              </button>
            )}
          </div>

          {/* Veg / Non-Veg Filters */}
          <div className="flex items-center gap-1.5 text-xs font-bold">
            <button
              type="button"
              onClick={() => setVegFilter("all")}
              className={`px-3 py-1.5 rounded-full border transition-all ${
                vegFilter === "all" ? "bg-black text-white border-black" : "bg-white text-black border-black/10"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setVegFilter("veg")}
              className={`px-3 py-1.5 rounded-full border transition-all flex items-center gap-1 ${
                vegFilter === "veg" ? "bg-green-700 text-white border-green-700" : "bg-white text-green-700 border-green-300"
              }`}
            >
              🟢 Veg Only
            </button>
            <button
              type="button"
              onClick={() => setVegFilter("nonveg")}
              className={`px-3 py-1.5 rounded-full border transition-all flex items-center gap-1 ${
                vegFilter === "nonveg" ? "bg-red-700 text-white border-red-700" : "bg-white text-red-700 border-red-300"
              }`}
            >
              🔴 Non-Veg
            </button>
          </div>

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search dishes…"
            aria-label="Search the menu"
            className="w-full sm:w-56 px-4 py-2 rounded-full border border-black/10 bg-[var(--sf-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sf-primary)]"
          />
        </div>

        {/* Category navigation */}
        {categories.length > 1 && !query ? (
          <nav
            className="sticky top-[68px] z-30 -mx-4 px-4 py-3 bg-[var(--sf-bg)]/95 backdrop-blur border-b border-black/5 mb-6"
            aria-label="Menu categories"
          >
            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => scrollToCategory(c.id)}
                  className={`shrink-0 px-4 py-2 text-sm font-semibold whitespace-nowrap transition-all ${
                    layout.categoryNavStyle === "tabs" ? "rounded-none border-b-2" : "rounded-full"
                  } ${
                    activeCategory === c.id
                      ? layout.categoryNavStyle === "tabs"
                        ? "border-[var(--sf-primary)] text-[var(--sf-primary)]"
                        : "bg-[var(--sf-primary)] text-white"
                      : layout.categoryNavStyle === "tabs"
                      ? "border-transparent text-[var(--sf-muted)]"
                      : "bg-[var(--sf-surface)] text-[var(--sf-muted)] hover:bg-black/5"
                  }`}
                >
                  {c.icon ? `${c.icon} ` : ""}
                  {c.name}
                </button>
              ))}
            </div>
          </nav>
        ) : null}

        {/* Empty state */}
        {visibleCategories.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-3" aria-hidden="true">🍽️</div>
            <p className="font-semibold">
              {query ? "No dishes match your search" : "Menu coming soon"}
            </p>
            <p className="text-sm text-[var(--sf-muted)] mt-1">
              {query
                ? "Try a different search term."
                : "This restaurant hasn't published its menu yet."}
            </p>
          </div>
        ) : null}

        {visibleCategories.map((category) => (
          <div
            key={category.id}
            id={`category-${category.id}`}
            data-category-id={category.id}
            ref={(el) => {
              sectionRefs.current[category.id] = el;
            }}
            className="mb-10 scroll-mt-32"
          >
            <h3
              className="text-lg font-bold mb-4 flex items-center gap-2"
              style={{ fontFamily: "var(--sf-heading-font)" }}
            >
              {category.icon ? <span aria-hidden="true">{category.icon}</span> : null}
              {category.name}
              <span className="text-sm font-normal text-[var(--sf-muted)]">
                ({category.products.length})
              </span>
              {/* A category the restaurant sells through only some order
                  types says so here, rather than letting the customer find
                  out when checkout refuses the item. */}
              {dispatchLabel(category.dispatchType) ? (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  {dispatchLabel(category.dispatchType)}
                </span>
              ) : null}
            </h3>

            <div className={gridClass}>
              {category.products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  layout={layout.productCardStyle}
                  currencySymbol={symbol}
                  onSelect={onSelectProduct}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* ---------------- ABOUT ---------------- */}
      {sections.showAbout && branding.aboutText ? (
        <section id="about" className="bg-[var(--sf-surface)] py-12">
          <div className="max-w-3xl mx-auto px-4 text-center">
            <h2 className="text-2xl font-bold mb-4" style={{ fontFamily: "var(--sf-heading-font)" }}>
              About Us
            </h2>
            {/* Plain text only — never dangerouslySetInnerHTML (§24 XSS) */}
            <p className="text-[var(--sf-muted)] leading-relaxed whitespace-pre-line">
              {branding.aboutText}
            </p>
          </div>
        </section>
      ) : null}

      {/* ---------------- POPULAR ITEMS ---------------- */}
      {sections.showPopular !== false && (
        <section className="max-w-6xl mx-auto px-4 py-8">
          <h2 className="text-xl font-bold mb-4" style={{ fontFamily: "var(--sf-heading-font)" }}>
            Popular Items
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {categories
              .flatMap((c) => c.products)
              .filter((p) => p.isPopular || p.isFeatured || p.rating >= 4.5)
              .slice(0, 4)
              .map((product) => (
                <ProductCard
                  key={`popular-${product.id}`}
                  product={product}
                  layout={layout.productCardStyle}
                  currencySymbol={symbol}
                  onSelect={onSelectProduct}
                />
              ))}
          </div>
        </section>
      )}

      {/* ---------------- CUSTOMER REVIEWS ---------------- */}
      {(data.reviews?.length || sections.showReviews) ? (
        <section className="max-w-6xl mx-auto px-4 py-8 bg-[var(--sf-surface)] rounded-3xl my-6">
          <h2 className="text-xl font-bold mb-4 text-center" style={{ fontFamily: "var(--sf-heading-font)" }}>
            Customer Reviews & Ratings
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(data.reviews || [
              { name: "Rahul S.", rating: 5, comment: "Amazing food and super fast ordering!" },
              { name: "Priya M.", rating: 5, comment: "Authentic taste and lovely packaging." },
              { name: "Amit K.", rating: 4, comment: "Great dining experience every single time." },
            ]).map((rev, i) => (
              <div key={i} className="p-4 bg-white rounded-2xl border border-black/5 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-sm">{rev.name}</span>
                  <span className="text-amber-500 text-xs">{"★".repeat(rev.rating)}</span>
                </div>
                <p className="text-xs text-[var(--sf-muted)] italic">"{rev.comment}"</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ---------------- FOOTER / CONTACT ---------------- */}
      <footer
        id="contact"
        className="py-12 mt-4"
        style={{ background: "var(--sf-secondary)", color: "#fff" }}
      >
        <div className="max-w-6xl mx-auto px-4 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h3 className="font-bold text-lg mb-3" style={{ fontFamily: "var(--sf-heading-font)" }}>
              {store.name}
            </h3>
            {branding.siteDescription ? (
              <p className="text-sm text-white/70 leading-relaxed mb-3">{branding.siteDescription}</p>
            ) : null}

            {/* Android App Download Button (ONLY when configured) */}
            {(store.appUrl || branding.androidAppUrl) ? (
              <a
                href={store.appUrl || branding.androidAppUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-bold text-xs rounded-xl hover:bg-emerald-500 shadow-md"
              >
                <span>🤖 Download Android App</span>
              </a>
            ) : null}
          </div>

          {sections.showContact ? (
            <div>
              <h4 className="font-semibold mb-3">Contact</h4>
              <address className="not-italic text-sm text-white/70 space-y-1.5">
                {contact?.phone ? (
                  <p>
                    <a href={`tel:${contact.phone}`} className="hover:text-white font-bold text-emerald-400">
                      📞 {contact.phone}
                    </a>
                  </p>
                ) : null}
                {contact?.email ? (
                  <p>
                    <a href={`mailto:${contact.email}`} className="hover:text-white">
                      ✉️ {contact.email}
                    </a>
                  </p>
                ) : null}
                {contact?.addressLine1 ? (
                  <p>
                    📍 {contact.addressLine1}
                    {contact.city ? `, ${contact.city}` : ""}
                    {contact.postalCode ? ` ${contact.postalCode}` : ""}
                  </p>
                ) : null}
              </address>
            </div>
          ) : null}

          {sections.showHours && openingHours?.length ? (
            <div>
              <h4 className="font-semibold mb-3">Opening Hours</h4>
              <ul className="text-sm text-white/70 space-y-1">
                {openingHours.map((h) => (
                  <li key={h.day} className="flex justify-between max-w-[220px]">
                    <span>{DAY_NAMES[h.day]}</span>
                    <span>{h.isOpen ? `${h.openTime} – ${h.closeTime}` : "Closed"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Secure Payment Gateway Logos */}
          <div>
            <h4 className="font-semibold mb-3">Accepted Payment Methods</h4>
            <div className="flex flex-wrap gap-2 text-xs font-bold text-white/90">
              <span className="px-2.5 py-1 bg-white/10 rounded-lg">💵 Cash</span>
              {(data.paymentGateways?.razorpayConfigured || ordering?.razorpayEnabled) && (
                <span className="px-2.5 py-1 bg-blue-600/40 rounded-lg border border-blue-400/30">💳 Razorpay</span>
              )}
              {(data.paymentGateways?.cashfreeConfigured || ordering?.cashfreeEnabled) && (
                <span className="px-2.5 py-1 bg-purple-600/40 rounded-lg border border-purple-400/30">💳 Cashfree</span>
              )}
              {(data.paymentGateways?.phonepeConfigured || ordering?.phonepeEnabled) && (
                <span className="px-2.5 py-1 bg-indigo-600/40 rounded-lg border border-indigo-400/30">📱 PhonePe</span>
              )}
            </div>
          </div>
        </div>

        {/* Policies Links */}
        <div className="max-w-6xl mx-auto px-4 pt-6 mt-6 border-t border-white/10 flex flex-wrap gap-4 text-xs text-white/60 justify-center">
          <button type="button" onClick={() => setActivePolicyModal("faq")} className="hover:text-white underline">
            FAQ
          </button>
          <button type="button" onClick={() => setActivePolicyModal("terms")} className="hover:text-white underline">
            Terms & Conditions
          </button>
          <button type="button" onClick={() => setActivePolicyModal("privacy")} className="hover:text-white underline">
            Privacy Policy
          </button>
          <button type="button" onClick={() => setActivePolicyModal("refund")} className="hover:text-white underline">
            Refund & Cancellation Policy
          </button>
          <button type="button" onClick={() => setActivePolicyModal("cookies")} className="hover:text-white underline">
            Cookie Policy
          </button>
        </div>

        <div className="max-w-6xl mx-auto px-4 mt-4 pt-4 text-center text-xs text-white/50 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} {store.name}. All rights reserved.</span>
          <span>Powered by KnotKitchen POS · Support Helpline: +91 98765 43210</span>
        </div>
      </footer>

      {/* ---------------- POLICY MODAL ---------------- */}
      {activePolicyModal ? (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white text-slate-900 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold">
                {activePolicyModal === "faq" && "Frequently Asked Questions"}
                {activePolicyModal === "terms" && "Terms & Conditions"}
                {activePolicyModal === "privacy" && "Privacy Policy"}
                {activePolicyModal === "refund" && "Refund & Cancellation Policy"}
                {activePolicyModal === "cookies" && "Cookie Policy"}
              </h3>
              <button
                type="button"
                onClick={() => setActivePolicyModal(null)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-slate-600 space-y-3 leading-relaxed">
              {activePolicyModal === "faq" && (
                <>
                  <p className="font-bold text-slate-800">Q: How do I place an order online?</p>
                  <p>A: Browse our online menu, add your favorite items to the cart, select pickup or delivery, and proceed to checkout.</p>
                  <p className="font-bold text-slate-800">Q: What payment methods are accepted?</p>
                  <p>A: We accept online UPI/Cards/Netbanking via secure payment gateways and Cash on delivery/pickup where enabled.</p>
                </>
              )}
              {activePolicyModal === "terms" && (
                <p>
                  By ordering from {store.name}, you agree to our terms of service. Orders are subject to item availability and store operating hours. All prices are calculated authoritatively by the store system.
                </p>
              )}
              {activePolicyModal === "privacy" && (
                <p>
                  {store.name} respects your privacy. Customer details (Name, Phone, Address) provided during checkout are strictly used for fulfilling food orders and order status notifications. We never sell or leak customer PII.
                </p>
              )}
              {activePolicyModal === "refund" && (
                <p>
                  Cancellation requests are accepted before food preparation begins. For issues with completed orders, please contact our support team at {contact?.phone || "+91 98765 43210"} within 30 minutes of delivery.
                </p>
              )}
              {activePolicyModal === "cookies" && (
                <p>
                  This website uses essential session cookies to preserve your cart items and order state across pages. No tracking cookies are stored without consent.
                </p>
              )}
            </div>

            <div className="pt-2 text-right">
              <button
                type="button"
                onClick={() => setActivePolicyModal(null)}
                className="px-4 py-2 bg-slate-900 text-white font-semibold text-xs rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------------- STICKY MOBILE CART BAR ---------------- */}
      {cart.count > 0 ? (
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 p-3 bg-[var(--sf-bg)] border-t border-black/10 shadow-[0_-4px_20px_rgba(0,0,0,.08)]">
          <button
            type="button"
            onClick={onOpenCart}
            className="w-full flex items-center justify-between px-5 py-3.5 font-semibold"
            style={{
              background: "var(--sf-button)",
              color: "var(--sf-button-text)",
              borderRadius: "var(--sf-radius)",
            }}
          >
            <span>
              {cart.count} item{cart.count > 1 ? "s" : ""}
            </span>
            <span>View Cart · {formatPrice(cart.subtotal, symbol)}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default DefaultRestaurantTheme;
