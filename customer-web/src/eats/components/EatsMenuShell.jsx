import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ProductCard from "../../components/ProductCard";
import ProductModal from "../../components/ProductModal";
import EatsCheckout from "./EatsCheckout";
import { thumbUrl } from "../../lib/thumbUrl";
import { priceFor, simpleLine } from "../../lib/cartLine";
import { getEatsOrder } from "../api";
import { holidayText, todayLines, weekGroups } from "../../lib/hoursText";
import { LEGAL_PAGES } from "../../lib/legalPages";
import { costLabel, distanceLabel, etaLabel, ratingView, tagText } from "../../lib/eatsFormat";
import { FOCUS } from "../shared";

const HEADER_OFFSET = 116; // top bar + the menu's search row
const hide = (e) => {
  e.currentTarget.style.display = "none";
};

/**
 * A restaurant on Knot Eats: the page StorePage draws when `eats.Shell` is
 * this (StorePage keeps the ordering engine: menu payload, cart, checkout and
 * payment). Laid out the way a food-delivery app is: the restaurant card
 * (rating, time, distance, price for two), its offers, the menu with
 * search, Veg / Non-veg / Bestseller filters and folding sections, a Menu
 * button, the cart bar, and EatsCheckout.
 *
 * Takes StoreShell's props (StorePage passes the same ones) plus Knot Eats'
 * own: `eatsStore` (GET /api/eats/stores/:id `store`), `dishTags`,
 * `locationStrip`, `reviews`.
 */
export default function EatsMenuShell({
  bootstrap,
  store,
  loadingFull,
  cart,
  placing,
  placeError,
  onPlaceOrder,
  notice,
  errorCode = "",
  back = null,
  headerActions = null,
  orderingOverride = null,
  offers: offersOverride = null,
  cartProps = null,
  openDishId = "",
  openCart = false,
  initialVegOnly = false,
  seller = null,
  eatsStore = null,
  dishTags = [],
  locationStrip = null,
  reviews = null,
  deliveryEta = "",
  reorderToken = "",
}) {
  const s = store || {};
  const b = bootstrap || {};
  const ordering = { ...(s.ordering || {}), ...orderingOverride };
  const symbol = ordering.currencySymbol || "₹";
  // Knot Eats names the restaurant as it is listed, never a website title.
  const name = eatsStore?.name || s.store?.name || b.name || "Restaurant";
  const offers = offersOverride || [];

  const [selected, setSelected] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(Boolean(openCart));
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [diet, setDiet] = useState(initialVegOnly ? "veg" : ""); // "" | veg | nonveg
  const [bestOnly, setBestOnly] = useState(false);
  const [closed, setClosed] = useState(() => new Set());
  const [activeCat, setActiveCat] = useState("");
  const [added, setAdded] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const addedTimer = useRef(0);
  const searchRef = useRef(null);

  // The name moves into the top bar once the restaurant card scrolls away.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 180);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // "Bestseller": the restaurant's popular dishes; "Must try": the ones it featured.
  const bestsellers = useMemo(() => new Set((s.landing?.featuredItems || []).map(String)), [s.landing]);
  const tagFor = (p) => (p.isFeatured ? "Must try" : bestsellers.has(String(p.id)) ? "Bestseller" : "");
  const hasBest = useMemo(
    () => (s.categories || []).some((c) => c.products.some((p) => p.isFeatured || bestsellers.has(String(p.id)))),
    [s.categories, bestsellers],
  );

  const q = query.trim().toLowerCase();
  const categories = useMemo(
    () =>
      (s.categories || [])
        .map((c) => ({
          ...c,
          products: c.products
            .filter(
              (p) =>
                (!diet || (diet === "veg" ? p.isVegetarian : !p.isVegetarian)) &&
                (!bestOnly || p.isFeatured || bestsellers.has(String(p.id))) &&
                (!q || `${p.name} ${p.description || ""} ${c.name}`.toLowerCase().includes(q)),
            )
            .map((p) => ({ ...p, price: priceFor(p, cart.channel) })),
        }))
        .filter((c) => c.products.length > 0),
    [s.categories, diet, bestOnly, q, bestsellers, cart.channel],
  );
  const dishCount = categories.reduce((n, c) => n + c.products.length, 0);
  // Which dishes are veg, for the marks in checkout (cart lines don't carry it).
  const vegById = useMemo(() => {
    const m = new Map();
    (s.categories || []).forEach((c) => c.products.forEach((p) => m.set(String(p.id), Boolean(p.isVegetarian))));
    return m;
  }, [s.categories]);

  // A dish link (/store/<id>?dish=<itemId>) opens that dish once, when the menu is in.
  const dishOpened = useRef(false);
  useEffect(() => {
    if (!openDishId || dishOpened.current || !s.categories) return;
    dishOpened.current = true;
    const dish = s.categories.flatMap((c) => c.products).find((p) => String(p.id) === String(openDishId));
    if (dish) setSelected(dish);
  }, [openDishId, s.categories]);

  // Reorder (/store/<id>?reorder=<order link>): the dishes of that order, by
  // name, at today's prices. A dish that had choices (size, add-ons) is left
  // for the diner to choose again; one no longer on the menu is skipped.
  const [reorderNote, setReorderNote] = useState("");
  const reordered = useRef(false);
  useEffect(() => {
    if (!reorderToken || reordered.current || !s.categories) return;
    reordered.current = true;
    // Once: a refresh must not add the same dishes again.
    const url = new URL(window.location.href);
    url.searchParams.delete("reorder");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    const byName = new Map();
    s.categories.forEach((c) => c.products.forEach((p) => byName.set(String(p.name).trim().toLowerCase(), p)));
    getEatsOrder(reorderToken)
      .then(async (res) => {
        const adding = [];
        const later = [];
        for (const i of res.data?.data?.order?.items || []) {
          const p = byName.get(String(i.name || "").trim().toLowerCase());
          const choices = i.variant || (i.addons || []).length || (i.options || []).length;
          if (!p || p.isAvailable === false) continue;
          if (choices || (p.variants || []).length || (p.modifierGroups || []).some((g) => g.required)) {
            later.push(p.name);
            continue;
          }
          adding.push(cart.addItem({ ...simpleLine({ ...p, price: priceFor(p, cart.channel) }), quantity: Math.max(1, Number(i.quantity) || 1) }));
        }
        // Counted once they are in: with a basket from another restaurant the
        // diner is asked first, and "Cancel" adds none of them.
        const added = (await Promise.all(adding)).filter((ok) => ok !== false).length;
        const first = added
          ? `Added ${added} dish${added === 1 ? "" : "es"} from your last order.`
          : adding.length
            ? "Nothing was added: you kept your other cart."
            : "None of those dishes can be added again right now.";
        setReorderNote([first, later.length ? `Choose options for ${later.join(", ")} from the menu.` : ""].filter(Boolean).join(" "));
      })
      .catch(() => setReorderNote("Couldn't load your last order. Add dishes from the menu."));
    // cart is a new object every render; once per page is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reorderToken, s.categories]);

  // The section being read lights up in the Menu sheet.
  useEffect(() => {
    const els = [...document.querySelectorAll("[data-kecat]")];
    if (!els.length || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0];
        if (top) setActiveCat(top.target.getAttribute("data-kecat"));
      },
      { rootMargin: `-${HEADER_OFFSET}px 0px -55% 0px` },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [categories]);

  const goTo = (id) => {
    setMenuOpen(false);
    setClosed((c) => {
      const n = new Set(c);
      n.delete(String(id));
      return n;
    });
    requestAnimationFrame(() => {
      const el = document.getElementById(`kecat-${id}`);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET + 4, behavior: "smooth" });
    });
  };
  const toggleSection = (id) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(String(id))) n.delete(String(id));
      else n.add(String(id));
      return n;
    });

  const onAdded = (dish) => {
    setAdded(dish || "Item");
    window.clearTimeout(addedTimer.current);
    addedTimer.current = window.setTimeout(() => setAdded(""), 2200);
  };

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: `${name} on Knot Eats`, url: window.location.href });
      else {
        await navigator.clipboard.writeText(window.location.href);
        onAdded("Link copied");
      }
    } catch {
      /* dismissed */
    }
  };

  const rating = ratingView(eatsStore?.rating, eatsStore?.ratingCount);
  const cuisines = tagText(eatsStore?.tags, dishTags);
  const facts = [
    deliveryEta || (eatsStore?.etaMinutes ? etaLabel(eatsStore.etaMinutes) : ordering.prepTimeMinutes ? `Ready in ~${ordering.prepTimeMinutes} min` : ""),
    eatsStore ? distanceLabel(eatsStore.distanceKm, eatsStore.distanceSource) : "",
    costLabel(eatsStore?.priceForTwo),
  ].filter(Boolean);
  const today = todayLines(s.hours, s.availability).filter((l) => l.text !== "closed today");
  const state = s.store || eatsStore;
  const cover = eatsStore?.cover || s.branding?.coverImage || "";
  const logo = eatsStore?.logo || s.branding?.logo || "";
  const showCartBar = cart.count > 0 && !checkoutOpen;

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      {/* Top bar: back, the name once scrolled, search, save, share. */}
      <header className={`sticky top-0 z-40 transition-colors ${scrolled ? "bg-white shadow-[0_1px_0_rgb(226_232_240)]" : "bg-slate-50"}`}>
        <div className="mx-auto flex max-w-3xl items-center gap-1 px-2 py-1.5">
          {back}
          <p className={`min-w-0 flex-1 truncate text-[16px] font-bold text-[color:var(--ke-ink)] transition-opacity ${scrolled ? "opacity-100" : "opacity-0"}`} aria-hidden={!scrolled}>
            {name}
          </p>
          <IconButton
            label="Search the menu"
            onClick={() => {
              searchRef.current?.focus();
              searchRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
            }}
          >
            <SearchIcon />
          </IconButton>
          {headerActions}
          <IconButton label="Share this restaurant" onClick={share}>
            <ShareIcon />
          </IconButton>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-3">
        {/* The restaurant card */}
        <section className="overflow-hidden rounded-3xl bg-white shadow-[0_2px_12px_rgba(15,23,42,0.08)]" aria-labelledby="ke-store-name">
          {cover ? (
            <div className="relative h-36 bg-slate-200 sm:h-48">
              <img src={thumbUrl(cover, 960)} alt="" onError={hide} className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
            </div>
          ) : null}
          <div className="p-4">
            <div className="flex items-start gap-3">
              {logo ? <img src={thumbUrl(logo, 160)} alt="" onError={hide} className="h-14 w-14 shrink-0 rounded-2xl border border-slate-100 object-cover" /> : null}
              <div className="min-w-0 flex-1">
                <h1 id="ke-store-name" className="text-[22px] font-extrabold leading-tight text-[color:var(--ke-ink)] sm:text-[26px]">
                  {name}
                </h1>
                {cuisines ? <p className="mt-0.5 truncate text-[14px] text-slate-500">{cuisines}</p> : null}
                {eatsStore?.area ? <p className="truncate text-[13px] text-slate-400">{eatsStore.area}</p> : null}
              </div>
              <RatingPill rating={rating} count={eatsStore?.ratingCount} />
            </div>

            {facts.length ? (
              <ul className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] font-medium text-slate-700">
                {facts.map((f, i) => (
                  <li key={f} className="flex items-center gap-3">
                    {i ? <span className="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" /> : null}
                    {f}
                  </li>
                ))}
                {eatsStore?.pureVeg ? <li className="rounded-md bg-green-50 px-2 py-0.5 text-[12px] font-bold text-[color:var(--ke-good)]">PURE VEG</li> : null}
              </ul>
            ) : null}

            {state ? (
              <p className="mt-2 text-[13.5px]">
                {state.isOpen ? (
                  <span className="font-semibold text-[color:var(--ke-good)]">Open now</span>
                ) : (
                  <span className="font-semibold text-[color:var(--ke-bad)]">Closed now</span>
                )}
                {today.length ? (
                  // Pickup and delivery on the same hours read as one line, without the labels.
                  <span className="text-slate-500">
                    {" · "}
                    {today.every((l) => l.text === today[0].text) ? today[0].text : today.map((l) => `${l.label} ${l.text}`).join(" · ")}
                  </span>
                ) : !state.isOpen && state.closedReason ? (
                  <span className="text-slate-500"> · {state.closedReason}</span>
                ) : null}
              </p>
            ) : null}
            {locationStrip}
          </div>
        </section>

        {offers.length ? (
          <div className="-mx-3 mt-4 flex gap-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none]" aria-label="Offers">
            {offers.map((o, i) => (
              <div key={`${o.code || o.title}-${i}`} className="flex w-[250px] shrink-0 items-center gap-3 rounded-2xl border border-orange-100 bg-white p-3 shadow-sm">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[color:var(--accent)] to-[color:var(--brand)] text-[16px] font-extrabold text-white" aria-hidden="true">
                  %
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-bold text-slate-900">{o.title}</span>
                  {o.code ? <span className="block truncate text-[12.5px] font-semibold uppercase tracking-wide text-slate-500">Use {o.code}</span> : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {notice ? <Banner tone="warn">{notice}</Banner> : null}
        {reorderNote ? <Banner>{reorderNote}</Banner> : null}

        {/* Menu: the search stays in reach while scrolling; the filters scroll away. */}
        <div className="sticky top-[56px] z-30 -mx-3 mt-4 bg-slate-50 px-3 pb-2 pt-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true">
              <SearchIcon />
            </span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search in ${name}`}
              aria-label="Search the menu"
              className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-3 text-[15px] shadow-sm outline-none focus:border-brand"
            />
          </div>
        </div>
        <div className="-mx-3 mb-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]" role="group" aria-label="Filter the menu">
            <Chip on={diet === "veg"} onClick={() => setDiet(diet === "veg" ? "" : "veg")}>
              <DietDot veg /> Veg
            </Chip>
            <Chip on={diet === "nonveg"} onClick={() => setDiet(diet === "nonveg" ? "" : "nonveg")}>
              <DietDot /> Non-veg
            </Chip>
            {hasBest ? (
              <Chip on={bestOnly} onClick={() => setBestOnly(!bestOnly)}>
                ★ Bestseller
              </Chip>
            ) : null}
        </div>

        {loadingFull && !s.categories ? (
          <div className="mt-2 space-y-3" aria-busy="true" aria-label="Loading the menu">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-4 rounded-2xl bg-white p-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-1/5 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
                </div>
                <div className="h-28 w-28 animate-pulse rounded-2xl bg-slate-200" />
              </div>
            ))}
          </div>
        ) : (s.categories || []).length === 0 ? (
          <Banner>This restaurant hasn&apos;t published a menu yet. Please check back later.</Banner>
        ) : categories.length === 0 ? (
          <Banner>
            {q ? `No dishes match “${query.trim()}”.` : "No dishes match these filters."}{" "}
            <button
              type="button"
              className="font-semibold text-brand underline"
              onClick={() => {
                setQuery("");
                setDiet("");
                setBestOnly(false);
              }}
            >
              Clear
            </button>
          </Banner>
        ) : (
          <div className="space-y-3">
            {categories.map((c) => {
              const isClosed = closed.has(String(c.id)) && !q;
              return (
                <section key={c.id} id={`kecat-${c.id}`} data-kecat={String(c.id)} className="rounded-2xl bg-white px-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
                  <h2>
                    <button
                      type="button"
                      onClick={() => toggleSection(c.id)}
                      aria-expanded={!isClosed}
                      className={`flex w-full items-center justify-between gap-3 py-4 text-left ${FOCUS}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-[18px] font-extrabold text-[color:var(--ke-ink)]">
                          {c.icon ? <span className="mr-1.5">{c.icon}</span> : null}
                          {c.name} <span className="font-semibold text-slate-400">({c.products.length})</span>
                        </span>
                        {c.dispatchLabel ? <span className="mt-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-700">{c.dispatchLabel}</span> : null}
                      </span>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`shrink-0 text-slate-500 transition-transform ${isClosed ? "" : "rotate-180"}`} aria-hidden="true">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  </h2>
                  {isClosed ? null : (
                    <div className="-mt-2 pb-2">
                      {c.products.map((p) => (
                        <ProductCard key={p.id} product={p} symbol={symbol} tag={tagFor(p)} cart={cart} onSelect={setSelected} onOpenCart={() => setCheckoutOpen(true)} onAdded={onAdded} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {reviews ? <div className="mt-4 rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">{reviews}</div> : null}
        <StoreAbout contact={s.contact} hours={s.hours} legal={s.legal} storeId={eatsStore?.storeId || s.store?.storeId} seller={seller} />
        {dishCount ? <p className="mt-6 text-center text-[12px] text-slate-400">Menu prices are set by the restaurant · Knot Eats by KnotKitchen</p> : null}
      </div>

      {/* The section list, one tap away. */}
      {categories.length > 1 && !checkoutOpen ? (
        <div className={`pointer-events-none fixed inset-x-0 z-[85] flex justify-end px-4 ${showCartBar ? "bottom-[92px]" : "bottom-6"}`}>
          <button type="button" onClick={() => setMenuOpen(true)} className={`pointer-events-auto flex items-center gap-2 rounded-full bg-[color:var(--ke-ink)] px-5 py-3 text-[14px] font-bold text-white shadow-xl ${FOCUS}`}>
            <MenuIcon /> Menu
          </button>
        </div>
      ) : null}
      {menuOpen ? <MenuSheet categories={categories} activeCat={activeCat} onPick={goTo} onClose={() => setMenuOpen(false)} /> : null}

      {selected ? (
        <ProductModal
          product={{ ...selected, price: priceFor(selected, cart.channel) }}
          symbol={symbol}
          allowNotes={ordering.specialInstructionsEnabled !== false}
          onClose={() => setSelected(null)}
          onAdd={(line) => {
            cart.addItem(line);
            onAdded(line.name);
          }}
        />
      ) : null}

      {showCartBar ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] p-3">
          <button
            type="button"
            onClick={() => setCheckoutOpen(true)}
            className={`pointer-events-auto mx-auto flex w-full max-w-3xl items-center justify-between rounded-2xl bg-brand px-5 py-3.5 text-left text-white shadow-[0_8px_24px_rgba(194,65,12,0.35)] ${FOCUS}`}
          >
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold">{added ? (added === "Link copied" ? added : `Added ${added}`) : `${cart.count} item${cart.count === 1 ? "" : "s"} added`}</span>
              <span className="block text-[12px] opacity-90">
                {symbol}
                {cart.subtotal.toFixed(2)} · plus taxes &amp; charges
              </span>
            </span>
            <span className="shrink-0 text-[15px] font-bold">View cart ›</span>
          </button>
        </div>
      ) : added === "Link copied" ? (
        <p role="status" className="fixed inset-x-0 bottom-6 z-[90] mx-auto w-max rounded-full bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white shadow-lg">
          Link copied
        </p>
      ) : null}

      <EatsCheckout
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        cart={cart}
        ordering={ordering}
        availability={s.availability}
        onPlaceOrder={onPlaceOrder}
        placing={placing}
        error={placeError}
        errorCode={errorCode}
        storeName={name}
        deliveryEta={deliveryEta}
        vegById={vegById}
        {...cartProps}
      />
    </div>
  );
}

/** Address, hours, holidays, licence and policies, under the menu. */
function StoreAbout({ contact, hours, legal, storeId, seller }) {
  const groups = weekGroups(hours);
  const address = [contact?.addressLine1, contact?.addressLine2, contact?.city, contact?.postalCode].filter(Boolean).join(", ");
  const phone = contact?.phone ? String(contact.phone).replace(/[^\d+]/g, "") : "";
  if (!address && !groups.length && !legal) return null;
  return (
    <section className="mt-4 rounded-2xl bg-white p-4 text-[14px] text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.06)]" aria-labelledby="ke-about">
      <h2 id="ke-about" className="text-[16px] font-extrabold text-[color:var(--ke-ink)]">
        About the restaurant
      </h2>
      {address ? <p className="mt-2">{address}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {contact?.mapUrl ? (
          <a href={contact.mapUrl} target="_blank" rel="noreferrer" className={`inline-flex min-h-[40px] items-center rounded-xl border border-slate-300 px-3 font-semibold text-slate-700 ${FOCUS}`}>
            Directions
          </a>
        ) : null}
        {phone ? (
          <a href={`tel:${phone}`} className={`inline-flex min-h-[40px] items-center rounded-xl border border-slate-300 px-3 font-semibold text-slate-700 ${FOCUS}`}>
            Call
          </a>
        ) : null}
      </div>
      {groups.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer font-semibold text-slate-800">Opening hours</summary>
          <div className="mt-2 space-y-3">
            {groups.map((g) => (
              <div key={g.title}>
                <p className="font-semibold text-slate-700">{g.title}</p>
                {g.days ? (
                  <ul className="mt-1 space-y-0.5">
                    {g.days.map((d) => (
                      <li key={d.day} className="flex max-w-xs justify-between gap-4">
                        <span>{d.day}</span>
                        <span>{d.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Every day · open all day</p>
                )}
              </div>
            ))}
            {hours?.holidays?.length ? (
              <ul className="space-y-0.5">
                {hours.holidays.map((h) => (
                  <li key={`${h.start}-${h.end}`}>Closed {holidayText(h)}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </details>
      ) : null}
      <div className="mt-3 border-t border-slate-100 pt-3 text-[12.5px] text-slate-500">
        {legal?.fssaiNumber ? <p>FSSAI Lic. No. {legal.fssaiNumber}</p> : null}
        {seller?.(legal)}
        {storeId ? (
          <nav className="mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-label="Restaurant policies">
            {LEGAL_PAGES.map((p) => (
              <Link key={p.key} to={`/store/${storeId}/legal/${p.key}`} className="underline underline-offset-2">
                {p.title}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </section>
  );
}

const TONE = { good: "bg-[color:var(--ke-good)]", ok: "bg-[color:var(--ke-ok)]", bad: "bg-[color:var(--ke-bad)]" };
function RatingPill({ rating, count = 0 }) {
  if (rating.tone === "new") {
    return (
      <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[12px] font-bold uppercase text-slate-600" aria-label={rating.label}>
        New
      </span>
    );
  }
  return (
    <span className="flex shrink-0 flex-col items-center overflow-hidden rounded-xl border border-slate-200 text-center" aria-label={rating.label} role="img">
      <span className={`flex items-center gap-0.5 px-2.5 py-1 text-[14px] font-extrabold text-white ${TONE[rating.tone] || TONE.good}`}>
        {rating.text} <span aria-hidden="true">★</span>
      </span>
      <span className="px-2 py-0.5 text-[10.5px] font-semibold text-slate-500" aria-hidden="true">
        {Number(count).toLocaleString("en-IN")} ratings
      </span>
    </span>
  );
}

function MenuSheet({ categories, activeCat, onPick, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-end bg-black/40 p-4 pb-24" onClick={onClose} role="dialog" aria-modal="true" aria-label="Menu sections">
      <ul className="max-h-[60vh] w-full max-w-xs overflow-y-auto rounded-3xl bg-[color:var(--ke-ink)] p-2 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {categories.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c.id)}
              className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-[15px] ${activeCat === String(c.id) ? "bg-white/10 font-bold" : "text-white/90"} ${FOCUS}`}
            >
              <span className="truncate">{c.name}</span>
              <span className="ml-3 shrink-0 text-white/60">{c.products.length}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Banner({ tone = "info", children }) {
  return (
    <div className={`mt-3 rounded-2xl border px-4 py-3 text-[14px] ${tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-700"}`} role={tone === "warn" ? "status" : undefined}>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl border px-3 text-[13.5px] font-semibold ${on ? "border-brand bg-orange-50 text-brand" : "border-slate-300 bg-white text-slate-700"} ${FOCUS}`}
    >
      {children}
    </button>
  );
}

function DietDot({ veg = false }) {
  return (
    <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border-[1.5px] ${veg ? "border-green-600" : "border-red-700"}`} aria-hidden="true">
      <span className={`h-1.5 w-1.5 rounded-full ${veg ? "bg-green-600" : "bg-red-700"}`} />
    </span>
  );
}

function IconButton({ label, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 ${FOCUS}`}>
      {children}
    </button>
  );
}

const svg = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
const SearchIcon = () => (
  <svg {...svg}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
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
  <svg {...svg} width={16} height={16}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);
