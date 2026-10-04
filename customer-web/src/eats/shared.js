import { useCallback, useEffect, useRef, useState } from "react";
import { getEatsConfig, listEatsStores } from "./api";

// Shared by the Knot Eats discovery pages and components: the config fetch,
// the store list with its session cache, the page title and a few classes.

export const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";
export const BTN_PRIMARY = `inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand px-5 text-[15px] font-semibold text-white ${FOCUS}`;
export const BTN_SECONDARY = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-[15px] font-semibold text-slate-800 ${FOCUS}`;

/** "Saved | Knot Eats" */
export function useTitle(text) {
  useEffect(() => {
    document.title = text ? `${text} | Knot Eats` : "Knot Eats";
  }, [text]);
}

// What the pages fall back to when /api/eats/config cannot be read: no
// Places box, no area chips, no dish chips. GPS still works.
const EMPTY_CONFIG = { maps: { browserKey: "" }, roadDistance: false, dishTags: [], collections: [], areas: [] };
let config = null;
let configLoad = null;

/** GET /api/eats/config once per page load; null while loading. A failure is retried on the next mount. */
export function useEatsConfig() {
  const [value, setValue] = useState(config);
  useEffect(() => {
    if (config) return undefined;
    let live = true;
    if (!configLoad) {
      configLoad = getEatsConfig()
        .then((res) => (config = { ...EMPTY_CONFIG, ...(res.data?.data || {}) }))
        .catch(() => {
          configLoad = null;
          return EMPTY_CONFIG;
        });
    }
    configLoad.then((c) => live && setValue(c));
    return () => {
      live = false;
    };
  }, []);
  return value;
}

// Back from a store page re-renders the list it left at once, every page
// already loaded included, instead of a skeleton and a refetch (§10.8).
const LIST_TTL = 60_000;
const listCache = new Map();
const cached = (key) => {
  const hit = listCache.get(key);
  return hit && Date.now() - hit.at < LIST_TTL ? hit.data : null;
};

/**
 * GET /api/eats/stores for `params` (eatsFilters.toApiParams), page by page.
 * null params fetch nothing. A new request aborts the one in flight, so fast
 * typing or filter taps never paint an older answer over a newer one. On an
 * error the stores already shown stay; `retry` asks for the page that failed.
 *
 * -> { data: { stores, facets, page, hasMore } | null, loading, error: { status, message } | null, loadMore, retry }
 */
export function useStoreList(params) {
  const key = params ? JSON.stringify(params) : "";
  const blank = { key, data: cached(key), loading: false, error: null, failedPage: 0 };
  const [state, setState] = useState(blank);
  const view = state.key === key ? state : blank;
  const latest = useRef(view);
  latest.current = view;
  const inFlight = useRef(null);

  const load = useCallback(
    (page) => {
      if (!key) return;
      inFlight.current?.abort();
      const ctrl = new AbortController();
      inFlight.current = ctrl;
      setState({ ...latest.current, loading: true, error: null });
      listEatsStores({ ...JSON.parse(key), ...(page > 1 ? { page } : {}) }, { signal: ctrl.signal })
        .then((res) => {
          const d = res.data?.data || {};
          const prev = page > 1 ? latest.current.data : null;
          // A store can move between pages when the list shifts under paging.
          const seen = new Set((prev?.stores || []).map((s) => s.storeId));
          const data = {
            stores: [...(prev?.stores || []), ...(d.stores || []).filter((s) => !seen.has(s.storeId))],
            facets: page === 1 ? d.facets || null : prev?.facets || null,
            page,
            hasMore: !!d.hasMore,
          };
          listCache.set(key, { at: Date.now(), data });
          setState({ key, data, loading: false, error: null, failedPage: 0 });
        })
        .catch((err) => {
          if (ctrl.signal.aborted) return;
          setState({
            ...latest.current,
            loading: false,
            error: { status: err.response?.status || 0, message: err.response?.data?.message || "" },
            failedPage: page,
          });
        });
    },
    [key],
  );

  useEffect(() => {
    if (!key) return undefined;
    if (!cached(key)) load(1);
    return () => inFlight.current?.abort();
  }, [key, load]);

  const loadMore = useCallback(() => {
    const v = latest.current;
    if (v.data?.hasMore && !v.loading && !v.error) load(v.data.page + 1);
  }, [load]);
  const retry = useCallback(() => load(latest.current.failedPage || 1), [load]);

  return { data: view.data, loading: view.loading, error: view.error, loadMore, retry };
}
