import React from "react";
import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import HomePage from "./pages/HomePage";
import SearchPage from "./pages/SearchPage";
import SavedPage from "./pages/SavedPage";
import EatsStorePage from "./pages/EatsStorePage";
import OrderStatusPage from "./pages/OrderStatusPage";
import EatsLegalPage from "./pages/EatsLegalPage";
import Message from "../components/Message";
import { getActiveCart } from "../lib/eatsCart";

// Knot Eats' own colours, set on the .ke wrapper only: a store website keeps
// the --brand its owner chose (hooks/useThemeVars.js). Light only.
const EATS_VARS = {
  "--brand": "#C2410C",
  "--brand-fg": "#FFFFFF",
  "--accent": "#FD5302",
  "--ke-ink": "#0B1B3B",
  "--ke-good": "#15803D",
  "--ke-ok": "#B45309",
  "--ke-bad": "#B91C1C",
};

/**
 * eats.<base>: the marketplace (contract §10.1). App.jsx loads this chunk
 * only on that host, inside its BrowserRouter and Suspense.
 */
export default function EatsApp() {
  return (
    <div className="ke min-h-screen bg-white text-slate-800" style={EATS_VARS}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:font-semibold focus:text-brand focus:shadow-lg"
      >
        Skip to content
      </a>
      <main id="main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/saved" element={<SavedPage />} />
          <Route path="/store/:storeId/menu" element={<ToStore />} />
          {/* One route for the store and its own policy pages, so moving
              between them keeps StorePage (and its menu fetch) mounted. */}
          <Route path="/store/:storeId/*" element={<EatsStorePage />} />
          <Route path="/order/:token" element={<OrderStatusPage />} />
          <Route path="/legal/:key" element={<EatsLegalPage />} />
          <Route path="/cart" element={<ToCart />} />
          <Route
            path="*"
            element={
              <Message icon="🔍" title="Page not found">
                <Link to="/" className="font-semibold text-brand underline">
                  Back to Knot Eats
                </Link>
              </Message>
            }
          />
        </Routes>
      </main>
    </div>
  );
}

/** /store/:id/menu: the store page always opens on its menu. */
function ToStore() {
  const { storeId } = useParams();
  return <Navigate to={`/store/${storeId}`} replace />;
}

/** /cart: the restaurant holding the basket, with its cart open; home if there is none. */
function ToCart() {
  const cart = getActiveCart();
  return <Navigate to={cart ? `/store/${cart.storeId}?cart=1` : "/"} replace />;
}
