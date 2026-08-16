import React, { useEffect, useMemo, useRef, useState } from "react";
import ProductCard from "./components/ProductCard";
import { formatPrice } from "./theme";

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

  // Client-side search across the already-loaded menu (no extra API calls).
  const visibleCategories = useMemo(() => {
    if (!query.trim()) return categories;
    const q = query.trim().toLowerCase();
    return categories
      .map((c) => ({
        ...c,
        products: c.products.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.description || "").toLowerCase().includes(q)
        ),
      }))
      .filter((c) => c.products.length > 0);
  }, [categories, query]);

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
              <p className="text-xs text-[var(--sf-muted)]">
                {store.isOpen ? (
                  <span className="text-green-600 font-medium">● Open now</span>
                ) : (
                  <span className="text-red-500 font-medium">● Closed</span>
                )}
                {ordering?.prepTimeMinutes ? ` · ~${ordering.prepTimeMinutes} min` : ""}
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
                fetchpriority="high"
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
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search dishes…"
            aria-label="Search the menu"
            className="sm:ml-auto w-full sm:w-64 px-4 py-2 rounded-full border border-black/10 bg-[var(--sf-surface)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sf-primary)]"
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

      {/* ---------------- FOOTER / CONTACT ---------------- */}
      <footer
        id="contact"
        className="py-12 mt-4"
        style={{ background: "var(--sf-secondary)", color: "#fff" }}
      >
        <div className="max-w-6xl mx-auto px-4 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <h3 className="font-bold text-lg mb-3" style={{ fontFamily: "var(--sf-heading-font)" }}>
              {store.name}
            </h3>
            {branding.siteDescription ? (
              <p className="text-sm text-white/70 leading-relaxed">{branding.siteDescription}</p>
            ) : null}
          </div>

          {sections.showContact ? (
            <div>
              <h4 className="font-semibold mb-3">Contact</h4>
              <address className="not-italic text-sm text-white/70 space-y-1">
                {contact?.phone ? (
                  <p>
                    <a href={`tel:${contact.phone}`} className="hover:text-white">
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
        </div>

        <div className="max-w-6xl mx-auto px-4 mt-8 pt-6 border-t border-white/10 text-center text-xs text-white/50">
          © {new Date().getFullYear()} {store.name}. Powered by KnotKitchen.
        </div>
      </footer>

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
