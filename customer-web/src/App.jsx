import React, { useMemo } from "react";
import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import { resolveStoreFromWindow } from "./lib/resolveStoreFromHostname";
import StorePage from "./pages/StorePage";
import Message from "./components/Message";

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

  return (
    <BrowserRouter>
      <Routes>
        {/* Explicit path-based routing (dev/preview); also matches bare /s/:slug */}
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
      // Marketing / discovery is out of scope for this app.
      return (
        <Message icon="🍽️" title="Knot Kitchen">
          Each Knot Kitchen restaurant has its own address — for example{" "}
          <span className="font-mono">burger-house.knotkitchen.com</span>. Please use the link
          your restaurant shared with you.
        </Message>
      );

    case "platform":
      // A platform subdomain reached the customer-web by mistake.
      return <Message icon="🔍" title="Restaurant not found">This URL is reserved for the Knot Kitchen platform.</Message>;

    default:
      return (
        <Message icon="🔍" title="Restaurant not found">
          This restaurant is not available right now. If you followed a link, please double-check the address.
        </Message>
      );
  }
}
