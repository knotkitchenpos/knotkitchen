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
 */
export function useStorefront(identity) {
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
    setLoading(true);
    setError(null);

    // Fire both requests immediately — first paint uses the bootstrap payload.
    const bootstrapPromise = bootstrapStore(identity)
      .then((res) => {
        if (!cancelled) setBootstrap(res.data.data);
        return res.data.data;
      })
      .catch((err) => {
        if (!cancelled) {
          setError({
            status: err.response?.status || 0,
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
      getStorefront(effectiveSlug)
        .then((res) => {
          if (!cancelled) setStore(res.data.data);
        })
        .catch((err) => {
          if (!cancelled && !error) {
            setError({
              status: err.response?.status || 0,
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
    };
    // We intentionally exclude `error` from deps — restarting on error would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.slug, identity?.host]);

  return { bootstrap, store, error, loading };
}
