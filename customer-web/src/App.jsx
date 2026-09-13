import React, { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import { resolveStoreFromWindow } from "./lib/resolveStoreFromHostname";
import StorePage from "./pages/StorePage";
import NotFound from "./pages/NotFound";
import Apex from "./pages/Apex";

/**
 * Customer website router.
 *
 * Two ways to reach a store:
 *  1. **Subdomain / custom domain** (production): the hostname resolver picks
 *     the slug and we render <StorePage slug=… /> for the root path.
 *  2. **Path-based** (`/s/:slug`): a helpful fallback for testing on a plain
 *     `knotkitchen.com` host without DNS/TLS setup. Also works for shared
 *     preview links.
 *
 * All routing decisions are made once at mount time; a customer navigating
 * within the site never leaves this SPA.
 */
export default function App() {
  const resolution = useMemo(() => resolveStoreFromWindow(), []);
  const [debug] = useState(String(import.meta.env.VITE_DEBUG_RESOLVER || "").toLowerCase() === "true");

  useEffect(() => {
    if (debug) {
       
      console.info("[customer-web] hostname resolution", resolution);
    }
  }, [debug, resolution]);

  return (
    <BrowserRouter>
      {debug ? (
        <div className="fixed bottom-2 right-2 z-[9999] bg-black/80 text-white text-xs font-mono px-2 py-1 rounded">
          {resolution.mode}: {resolution.slug || resolution.host || "—"}
        </div>
      ) : null}

      <Routes>
        {/* Explicit path-based routing (dev/preview) */}
        <Route path="/s/:slug" element={<PathStorePage />} />
        <Route path="/s/:slug/*" element={<PathStorePage />} />

        {/* Hostname-based routing — the default */}
        <Route path="/*" element={<HostnameRouter resolution={resolution} />} />
      </Routes>
    </BrowserRouter>
  );
}

function PathStorePage() {
  const { slug } = useParams();
  return <StorePage slug={slug} />;
}

/**
 * Chooses what to render based on the hostname resolution result.
 *
 * We deliberately do NOT redirect here — the URL the customer arrived at is
 * kept intact (important for sharing / bookmarking / analytics).
 */
function HostnameRouter({ resolution }) {
  switch (resolution.mode) {
    case "subdomain":
      return <StorePage slug={resolution.slug} />;

    case "custom":
      // The backend accepts either a slug or a raw host; passing host lets
      // WebsiteSettings.customDomain match a real custom-domain store.
      return <StorePage host={resolution.host} />;

    case "apex":
    case "ip":
      // Someone visited the bare knotkitchen.com / an IP address.
      if (resolution.slug) return <StorePage slug={resolution.slug} />;
      return <Apex />;

    case "platform":
      // A platform subdomain reached the customer-web by mistake.
      return <NotFound reason="This URL is reserved for the Knot Kitchen platform." />;

    default:
      return <NotFound />;
  }
}
