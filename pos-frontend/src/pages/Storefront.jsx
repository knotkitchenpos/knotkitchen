import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import DefaultRestaurantTheme from "../storefront/DefaultRestaurantTheme";
import ProductModal from "../storefront/components/ProductModal";
import CartDrawer from "../storefront/components/CartDrawer";
import OrderConfirmation from "../storefront/components/OrderConfirmation";
import StorefrontSkeleton from "../storefront/components/StorefrontSkeleton";
import { useCart } from "../storefront/useCart";
import { buildThemeVars, buildFontUrl } from "../storefront/theme";
import { getStorefront, placeStorefrontOrder, previewWebsite } from "../https/storefrontApi";

/**
 * Storefront container (§1, §18).
 *
 * Resolves the tenant from the :slug route parameter, loads that store's
 * public payload and hands it to the theme renderer registered for the store's
 * themeKey. Adding a theme = one more entry in THEME_RENDERERS.
 */

const THEME_RENDERERS = {
  "default-restaurant": DefaultRestaurantTheme,
};

/** Applies theme CSS variables + font loading to the document. */
const useThemeStyles = (data) => {
  useEffect(() => {
    if (!data?.theme) return undefined;

    const vars = buildThemeVars(data.theme);
    const root = document.documentElement;
    Object.entries(vars).forEach(([key, value]) => root.style.setProperty(key, value));

    // Load only the fonts this store uses.
    const fontUrl = buildFontUrl(data.theme);
    let link;
    if (fontUrl) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = fontUrl;
      document.head.appendChild(link);
    }

    return () => {
      Object.keys(vars).forEach((key) => root.style.removeProperty(key));
      if (link) link.remove();
    };
  }, [data]);
};

/** Sets document title/description/favicon per store (SEO + tab identity). */
const useDocumentMeta = (data) => {
  useEffect(() => {
    if (!data) return undefined;
    const previousTitle = document.title;
    const siteTitle = data.branding?.siteTitle || data.name || data.store?.name || "Order Online";
    document.title = siteTitle;

    const setMeta = (nameOrProperty, content, isProperty = false) => {
      if (!content) return null;
      const selector = isProperty ? `meta[property="${nameOrProperty}"]` : `meta[name="${nameOrProperty}"]`;
      let tag = document.querySelector(selector);
      if (!tag) {
        tag = document.createElement("meta");
        if (isProperty) tag.setAttribute("property", nameOrProperty);
        else tag.name = nameOrProperty;
        document.head.appendChild(tag);
      }
      tag.content = content;
      return tag;
    };

    setMeta("description", data.branding?.siteDescription);
    setMeta("og:title", siteTitle, true);
    setMeta("og:description", data.branding?.siteDescription || data.branding?.tagline, true);
    setMeta("og:image", data.coverImageUrl || data.logoUrl || data.branding?.coverImage || data.branding?.logo, true);
    setMeta("og:type", "website", true);
    setMeta("og:site_name", data.name || data.store?.name, true);

    let favicon;
    const fav = data.faviconUrl || data.branding?.favicon;
    if (fav) {
      favicon = document.querySelector("link[rel='icon']") || document.createElement("link");
      favicon.rel = "icon";
      favicon.href = fav;
      document.head.appendChild(favicon);
    }

    return () => {
      document.title = previousTitle;
    };
  }, [data]);
};

const Storefront = ({ preview = false }) => {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [confirmedOrder, setConfirmedOrder] = useState(null);

  const cart = useCart(slug || "preview");

  /**
   * Idempotency key (§32). Generated once per cart "session" and reused for
   * retries, so a double-click or a retried request can never create two
   * orders. It is regenerated only after a successful order.
   */
  const idempotencyKeyRef = useRef(null);
  if (!idempotencyKeyRef.current) {
    idempotencyKeyRef.current =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setLoadError(null);
        // Preview mode uses the authenticated endpoint so an owner can view an
        // otherwise-disabled/closed site.
        const res = preview ? await previewWebsite() : await getStorefront(slug);
        if (!cancelled) setData(res.data.data);
      } catch (err) {
        if (!cancelled) {
          setLoadError({
            status: err.response?.status,
            message: err.response?.data?.message || "We couldn't load this restaurant.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (slug || preview) load();
    return () => {
      cancelled = true;
    };
  }, [slug, preview]);

  useThemeStyles(data);
  useDocumentMeta(data);

  const handlePlaceOrder = useCallback(
    async (checkout) => {
      if (preview || !slug) {
        setOrderError("Preview mode cannot place orders.");
        return;
      }
      setPlacing(true);
      setOrderError("");
      try {
        // NOTE: only identifiers + quantities are sent. The server computes
        // every price and total itself.
        const res = await placeStorefrontOrder(slug, {
          ...checkout,
          items: cart.toOrderItems(),
          idempotencyKey: idempotencyKeyRef.current,
        });

        setConfirmedOrder(res.data.data);
        cart.clearCart();
        setCartOpen(false);
        // Fresh key so the customer's next order isn't deduplicated away.
        idempotencyKeyRef.current =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      } catch (err) {
        setOrderError(err.response?.data?.message || "We couldn't place your order. Please try again.");
      } finally {
        setPlacing(false);
      }
    },
    [preview, slug, cart]
  );

  const Renderer = useMemo(
    () => THEME_RENDERERS[data?.theme?.key] || DefaultRestaurantTheme,
    [data]
  );

  if (loading) return <StorefrontSkeleton />;

  // ---- Error / disabled / not-found states (§20) ----
  if (loadError || !data) {
    const isDisabled = loadError?.status === 403;
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
          <div className="text-5xl mb-4" aria-hidden="true">{isDisabled ? "🕒" : "🔍"}</div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {isDisabled ? "Currently Unavailable" : "Restaurant Not Found"}
          </h1>
          <p className="text-slate-500 text-sm">{loadError?.message}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {preview ? (
        <div className="sticky top-0 z-[110] bg-amber-500 text-white text-center text-xs font-semibold py-1.5">
          PREVIEW MODE — only you can see this
        </div>
      ) : null}

      <Renderer
        data={data}
        cart={cart}
        onSelectProduct={setSelectedProduct}
        onOpenCart={() => setCartOpen(true)}
      />

      {selectedProduct ? (
        <ProductModal
          product={selectedProduct}
          currencySymbol={data.ordering?.currencySymbol}
          allowNotes={data.ordering?.specialInstructionsEnabled !== false}
          onClose={() => setSelectedProduct(null)}
          onAdd={(line) => {
            cart.addItem(line);
            setCartOpen(true);
          }}
        />
      ) : null}

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        ordering={data.ordering}
        storeOpen={data.store?.acceptingOrders}
        onPlaceOrder={handlePlaceOrder}
        canCheckout={!preview}
        placing={placing}
        error={orderError}
      />

      {confirmedOrder ? (
        <OrderConfirmation
          order={confirmedOrder}
          currencySymbol={data.ordering?.currencySymbol}
          prepTime={data.ordering?.prepTimeMinutes}
          onClose={() => setConfirmedOrder(null)}
        />
      ) : null}
    </>
  );
};

export default Storefront;
