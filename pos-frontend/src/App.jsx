import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
  Navigate,
} from "react-router-dom";
import { useState } from "react";
import { useSelector } from "react-redux";
import {
  Home, Auth, Orders, Tables, Menu, KDS, OrderOnline, PaymentLink,
  Storefront, WebsiteSettings, OnlineOrders, Reports, Settings, ManageMenuPage, Support,
  Impersonate, Billing,
} from "./pages";

import Sidebar from "./components/shared/Sidebar";
import useLoadData from "./hooks/useLoadData";
import useRealtimeSync from "./hooks/useRealtimeSync";
import { isPublicPath } from "./utils/publicRoutes";
import FullScreenLoader from "./components/shared/FullScreenLoader";
import MarketplaceOrderPopup from "./components/dashboard/MarketplaceOrderPopup";
import QRTableOrderPopup from "./components/dashboard/QRTableOrderPopup";
import WaiterCallPopup from "./components/dashboard/WaiterCallPopup";
import AddedItemsPopup from "./components/dashboard/AddedItemsPopup";

function ProtectedRoutes({ children }) {
  const { isAuth } = useSelector((state) => state.user);
  if (!isAuth) return <Navigate to="/auth" />;
  return children;
}

function Layout() {
  const isLoading = useLoadData();
  // One subscription for the whole app: socket events become cache
  // invalidations, so screens update without anyone pressing refresh.
  useRealtimeSync();
  const location = useLocation();
  const { isAuth } = useSelector((state) => state.user);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Chrome-less pages: everything a guest can open, plus the owner's own
  // storefront preview. The old list matched "/pay" exactly, so the real
  // payment-link URL (/pay/<token>) fell through and rendered a customer's
  // payment page inside the staff sidebar.
  const bare = isPublicPath(location.pathname) || location.pathname === "/website/preview";

  if (isLoading) return <FullScreenLoader />;

  const routes = (
    <Routes>
      <Route path="/" element={<ProtectedRoutes><Menu /></ProtectedRoutes>} />
      <Route path="/auth" element={isAuth ? <Navigate to="/" /> : <Auth />} />
      <Route path="/impersonate" element={<Impersonate />} />
      <Route path="/menu" element={<ProtectedRoutes><Menu /></ProtectedRoutes>} />
      <Route path="/orders" element={<ProtectedRoutes><Orders /></ProtectedRoutes>} />
      <Route path="/reports" element={<ProtectedRoutes><Reports /></ProtectedRoutes>} />
      <Route path="/home" element={<ProtectedRoutes><Home /></ProtectedRoutes>} />
      <Route path="/tables" element={<ProtectedRoutes><Tables /></ProtectedRoutes>} />
      <Route path="/kds" element={<ProtectedRoutes><KDS /></ProtectedRoutes>} />
      <Route path="/online-orders" element={<ProtectedRoutes><OnlineOrders /></ProtectedRoutes>} />
      <Route path="/settings" element={<ProtectedRoutes><Settings /></ProtectedRoutes>} />
      {/* Reachable even when the account is locked -- see middlewares/accountLock.js */}
      <Route path="/settings/billing" element={<ProtectedRoutes><Billing /></ProtectedRoutes>} />
      <Route path="/support" element={<ProtectedRoutes><Support /></ProtectedRoutes>} />
      <Route path="/manage-menu" element={<ProtectedRoutes><ManageMenuPage /></ProtectedRoutes>} />

      {/* Manage Website is CSD-only. The preview below stays: it renders the
          storefront read-only and changes nothing. */}
      <Route path="/website" element={<Navigate to="/settings" replace />} />

      <Route path="/website/preview" element={<ProtectedRoutes><Storefront preview /></ProtectedRoutes>} />
      <Route path="/order" element={<OrderOnline />} />
      <Route path="/t/:token" element={<OrderOnline />} />
      <Route path="/pay/:token" element={<PaymentLink />} />
      <Route path="/store/:slug" element={<Storefront />} />
      <Route path="*" element={<div className="p-8">Not Found</div>} />
    </Routes>
  );

  if (bare) {
    return <main className="w-full min-h-screen overflow-y-auto bg-[#F8FAFC]">{routes}</main>;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#F8FAFC]">
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <main className="flex min-h-0 flex-1 min-w-0 flex-col overflow-hidden">
        {/* Mobile menu button */}
        <button
          onClick={() => setMobileOpen(true)}
          className="lg:hidden fixed bottom-5 left-5 z-30 w-12 h-12 rounded-full bg-[#FD5302] text-white shadow-lg flex items-center justify-center"
          aria-label="Open menu"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        {routes}
      </main>
      {isAuth && <MarketplaceOrderPopup />}
      {isAuth && <QRTableOrderPopup />}
      {isAuth && <WaiterCallPopup />}
      {isAuth && <AddedItemsPopup />}
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Layout />
    </Router>
  );
}
