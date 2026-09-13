import React, { useCallback, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useStorefront } from "../hooks/useStorefront";
import { useDocumentMeta, useThemeVars } from "../hooks/useThemeVars";
import { useCart } from "../hooks/useCart";
import StoreShell from "../components/StoreShell";
import LoadingSkeleton from "../components/LoadingSkeleton";
import ErrorPage from "../components/ErrorPage";
import LandingTemplate from "../components/LandingTemplates";
import { landingRoute } from "../lib/landingRoute";
import { placeOrder } from "../lib/api";

/**
 * StorePage — the customer-facing restaurant page.
 *
 * Data model:
 *  - `identity` describes how the store was found (slug or host).
 *  - `useStorefront(identity)` provides the two payloads.
 *  - `useCart(slug)` provides an isolated cart per store.
 *
 * The page is intentionally thin — it composes hooks and hands the fully
 * hydrated data to <StoreShell />, which handles rendering and interaction.
 *
 * It also owns the landing/menu split. Both views live in this ONE component
 * on purpose: the landing page and the menu share the storefront payload and
 * the cart, and routing them as two <Route> elements would remount the page on
 * every click, refetch the menu and empty the basket.
 */
export default function StorePage({ slug, host }) {
  const identity = useMemo(() => ({ slug, host }), [slug, host]);
  const { bootstrap, store, error, loading } = useStorefront(identity);
  const { isMenu, homePath, menuPath } = landingRoute(useLocation().pathname);

  // Bootstrap arrives first, so apply meta/theme from whichever is available.
  useDocumentMeta(store || bootstrap);
  useThemeVars(store || bootstrap);

  const effectiveSlug = store?.store?.slug || bootstrap?.slug || slug || "";
  const cart = useCart(effectiveSlug);

  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [confirmedOrder, setConfirmedOrder] = useState(null);

  /**
   * Idempotency key per checkout attempt — a double-click or a retry after a
   * dropped response cannot create a second order (§10). Reset after a
   * successful place so the customer's *next* order isn't deduped away.
   */
  const idempotencyKeyRef = useRef(null);
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = makeIdempotencyKey();

  const handlePlaceOrder = useCallback(
    async (checkout) => {
      if (!effectiveSlug) return;
      setPlacing(true);
      setPlaceError("");
      try {
        const res = await placeOrder(effectiveSlug, {
          ...checkout,
          items: cart.toOrderItems(),
          idempotencyKey: idempotencyKeyRef.current,
        });
        setConfirmedOrder(res.data.data);
        cart.clear();
        idempotencyKeyRef.current = makeIdempotencyKey();
      } catch (err) {
        setPlaceError(err.response?.data?.message || "We couldn't place your order. Please try again.");
      } finally {
        setPlacing(false);
      }
    },
    [effectiveSlug, cart]
  );

  if (loading && !bootstrap && !store) return <LoadingSkeleton />;
  if (error && !store) {
    return (
      <ErrorPage
        title={error.status === 404 ? "Restaurant not found" : "Something went wrong"}
        message={error.message}
      />
    );
  }

  // The landing page renders from the bootstrap payload, which arrives well
  // before the menu — so the front door paints immediately and fills in the
  // hours/contact/offers blocks when the full storefront lands.
  //
  // Take the NEWER of the two, not the later. Both responses describe the same
  // design and are cached independently, so after an edit one can come back
  // fresh and the other from cache. Preferring whichever arrived last meant a
  // stale storefront could overwrite a fresh bootstrap, and the template
  // appeared to switch and then switch back.
  const landing = newerLanding(store?.landing, bootstrap?.landing);
  if (!isMenu && landing) {
    return <LandingTemplate landing={landing} store={store} menuPath={menuPath} slug={effectiveSlug} />;
  }

  return (
    <StoreShell
      homePath={homePath}
      bootstrap={bootstrap}
      store={store}
      loadingFull={!store}
      cart={cart}
      placing={placing}
      placeError={placeError}
      confirmedOrder={confirmedOrder}
      onDismissOrder={() => setConfirmedOrder(null)}
      onPlaceOrder={handlePlaceOrder}
    />
  );
}

/** Whichever of the two payloads describes a later edit of the settings. */
function newerLanding(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (Number(b.version) || 0) > (Number(a.version) || 0) ? b : a;
}

function makeIdempotencyKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
