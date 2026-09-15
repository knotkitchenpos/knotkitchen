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
  Storefront, OnlineOrders, Reports, Settings, ManageMenuPage, Support,
  Impersonate, Billing, WebsiteSettings,
} from "./pages";

import Sidebar, { MobileNav } from "./components/shared/Sidebar";
import { AccountLockBanner, LockRedirect, useAccountLock } from "./components/shared/AccountLock";
import useLoadData from "./hooks/useLoadData";
import useRealtimeSync from "./hooks/useRealtimeSync";
import { isPublicPath } from "./utils/publicRoutes";
import FullScreenLoader from "./components/shared/FullScreenLoader";
import MarketplaceOrderPopup from "./components/dashboard/MarketplaceOrderPopup";
import NewOrderPopup from "./components/dashboard/NewOrderPopup";
import WaiterCallPopup from "./components/dashboard/WaiterCallPopup";
import TableBookingPopup from "./components/dashboard/TableBookingPopup";
import PrepDuePopup from "./components/dashboard/PrepDuePopup";
import AddedItemsPopup from "./components/dashboard/AddedItemsPopup";
import useAutoReceiptPrint from "./hooks/useAutoReceiptPrint";

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
  // Prints each new order on this device's printer when it is set to.
  useAutoReceiptPrint();
  const location = useLocation();
  const { isAuth } = useSelector((state) => state.user);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Chrome-less pages: everything a guest can open, plus the owner's own
  // storefront preview. The old list matched "/pay" exactly, so the real
  // payment-link URL (/pay/<token>) fell through and rendered a customer's
  // payment page inside the staff sidebar.
  const bare = isPublicPath(location.pathname) || location.pathname === "/website/preview";
  // Unpaid: warn during the grace period, then only Billing stays open.
  const lock = useAccountLock(Boolean(isAuth) && !bare);

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

      <Route path="/website" element={<ProtectedRoutes><WebsiteSettings /></ProtectedRoutes>} />

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
    // dvh, not vh: on a phone 100vh runs under the browser's toolbar and
    // hides the bottom navigation.
    <div className="flex h-dvh w-full overflow-hidden bg-[#F8FAFC]">
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      {/* Below lg the bottom navigation covers the last 60px (+ the home bar). */}
      <main className={`flex min-h-0 flex-1 min-w-0 flex-col overflow-hidden ${lock.locked ? "" : "pb-[calc(60px+env(safe-area-inset-bottom))] lg:pb-0"}`}>
        {!lock.locked && <MobileNav onMore={() => setMobileOpen(true)} />}
        {isAuth && <AccountLockBanner {...lock} />}
        {lock.locked ? <LockRedirect /> : null}
        {routes}
      </main>
      {isAuth && !lock.locked && (
        <>
          <MarketplaceOrderPopup />
          <NewOrderPopup />
          <WaiterCallPopup />
          <TableBookingPopup />
          <PrepDuePopup />
          <AddedItemsPopup />
        </>
      )}
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
