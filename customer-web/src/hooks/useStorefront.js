import { useEffect, useState } from "react";
import { bootstrapStore, getStorefront } from "../lib/api";

/**
 * useStorefront — orchestrates the two-phase load for a store.
 *
 *  1. **Bootstrap** (`/api/public/store/by-domain/:slug?host=...`) — small
 *     payload that arrives quickly. Enough to set the page title/favicon and
 *     paint the correct brand colors before the full menu is ready.
 *
 *  2. **Storefront** (`/api/storefront/:slug`) — full site payload including
 *     categories, products, opening hours, offers, contact.
 *
 * The two calls are launched in parallel; the hook exposes whichever data is
 * available so the UI can render progressively.
 *
 * @param {{ slug?: string, host?: string }} identity
 * @param {(slug: string) => Promise} [loadStorefront] Knot Eats' own payload call;
 *   skips the website bootstrap, so a store without the website still opens on Knot Eats.
 */
export function useStorefront(identity, loadStorefront) {
  const [bootstrap, setBootstrap] = useState(null);
  const [store, setStore] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!identity?.slug && !identity?.host) {
      setLoading(false);
      setError({ status: 400, message: "No store identifier available." });
      return undefined;
    }

    let cancelled = false;
    let refresh = 0;
    setLoading(true);
    setError(null);

    // Fire both requests immediately — first paint uses the bootstrap payload.
    const bootstrapPromise = loadStorefront
      ? Promise.resolve(null)
      : bootstrapStore(identity)
          .then((res) => {
            if (!cancelled) setBootstrap(res.data.data);
            return res.data.data;
          })
          .catch((err) => {
            if (!cancelled) {
              setError({
                status: err.response?.status || 0,
                code: err.response?.data?.code || "",
                message: err.response?.data?.message || "We couldn't find this restaurant.",
              });
            }
            return null;
          });

    // Full storefront needs the slug that came back from bootstrap (in case
    // the request was made by hostname/customDomain).
    bootstrapPromise.then((boot) => {
      const effectiveSlug = boot?.slug || identity.slug;
      if (!effectiveSlug || cancelled) {
        if (!cancelled) setLoading(false);
        return;
      }
      const load = () => (loadStorefront || getStorefront)(effectiveSlug);
      load()
        .then((res) => {
          if (cancelled) return;
          setStore(res.data.data);
          // Prices follow the store clock (happy hours), so the menu refreshes
          // while the page is in view; a failed refresh keeps what is shown.
          // shortcut: prices can be up to 30 s stale at a price-rule boundary; the server always bills the live price.
          refresh = setInterval(() => {
            if (document.visibilityState !== "visible") return;
            load()
              .then((r) => {
                if (!cancelled) setStore(r.data.data);
              })
              .catch(() => {});
          }, 30000);
        })
        .catch((err) => {
          if (!cancelled && !error) {
            setError({
              status: err.response?.status || 0,
              // STORE_UNAVAILABLE etc.: StorePage shows "temporarily unavailable", not an error.
              code: err.response?.data?.code || "",
              message: err.response?.data?.message || "We couldn't load this restaurant's menu.",
            });
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });

    return () => {
      cancelled = true;
      clearInterval(refresh);
    };
    // We intentionally exclude `error` from deps — restarting on error would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.slug, identity?.host]);

  return { bootstrap, store, error, loading };
}
