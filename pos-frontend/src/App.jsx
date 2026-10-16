import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
  useNavigate,
  Navigate,
} from "react-router-dom";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { useSnackbar } from "notistack";
import { getSubscriptionStatus } from "./https";

import Sidebar, { MobileNav } from "./components/shared/Sidebar";
import { AccountLockBanner, LockRedirect, useAccountLock } from "./components/shared/AccountLock";
import GlobalPinPrompt from "./components/common/GlobalPinPrompt";
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
import useOfflineQueue from "./hooks/useOfflineQueue";
import OfflineBanner from "./components/shared/OfflineBanner";
import OldWebViewBanner from "./components/shared/OldWebViewBanner";

// One chunk per page: a guest opening the table QR or a payment link no longer
// downloads the whole POS first.
const PAGE_LOADERS = {
  Auth: () => import("./pages/Auth.jsx"),
  Orders: () => import("./pages/Orders.jsx"),
  Tables: () => import("./pages/Tables.jsx"),
  Menu: () => import("./pages/Menu.jsx"),
  OrderOnline: () => import("./pages/OrderOnline.jsx"),
  PaymentLink: () => import("./pages/PaymentLink.jsx"),
  Reports: () => import("./pages/Reports.jsx"),
  Settings: () => import("./pages/Settings.jsx"),
  ManageMenuPage: () => import("./pages/ManageMenuPage.jsx"),
  Support: () => import("./pages/Support.jsx"),
  Impersonate: () => import("./pages/Impersonate.jsx"),
  Billing: () => import("./pages/Billing.jsx"),
  WebsiteSettings: () => import("./pages/WebsiteSettings.jsx"),
};
const {
  Auth, Orders, Tables, Menu, OrderOnline, PaymentLink,
  Reports, Settings, ManageMenuPage, Support,
  Impersonate, Billing, WebsiteSettings,
} = Object.fromEntries(Object.entries(PAGE_LOADERS).map(([name, load]) => [name, lazy(load)]));

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
  // Orders taken with no internet wait on this device and sync when it is back.
  const offline = useOfflineQueue(Boolean(isAuth));
  const [mobileOpen, setMobileOpen] = useState(false);

  // Chrome-less pages: everything a guest can open, plus the owner's own
  // storefront preview. The old list matched "/pay" exactly, so the real
  // payment-link URL (/pay/<token>) fell through and rendered a customer's
  // payment page inside the staff sidebar.
  const bare = isPublicPath(location.pathname) || location.pathname === "/website/preview";
  // Unpaid: warn during the grace period, then only Billing stays open.
  const lock = useAccountLock(Boolean(isAuth) && !bare);
  const { data: subRes, isPending: planPending, isLoading: planLoading } = useQuery({ queryKey: ["subscription"], queryFn: getSubscriptionStatus, enabled: Boolean(isAuth) && !bare, staleTime: 60_000 });
  // Billing plan (services/planFeatures pos): no tables, table bookings, waiter calls or marketplace.
  const billingOnly = subRes?.data?.data?.features?.pos === false;
  // Their popups wait for the plan, so a Billing store's first poll is not refused (and prompted) before it is known.
  const tableService = !planPending && !billingOnly;

  // A call refused as not on this plan (axiosWrapper, PLAN_UPGRADE_REQUIRED): offer Billing, at most once per 10 s.
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const planPromptAt = useRef(0);
  useEffect(() => {
    const onPlanLocked = (e) => {
      if (Date.now() - planPromptAt.current < 10_000) return;
      planPromptAt.current = Date.now();
      enqueueSnackbar(e.detail || "Not on your plan. Upgrade in Billing & Subscription.", {
        variant: "warning",
        action: <button type="button" className="font-bold underline" onClick={() => navigate("/settings/billing")}>Billing</button>,
      });
    };
    window.addEventListener("kk:plan-locked", onPlanLocked);
    return () => window.removeEventListener("kk:plan-locked", onPlanLocked);
  }, [enqueueSnackbar, navigate]);

  // Staff devices load every page once, soon after start: the service worker
  // then holds them all for offline use, and a tab left open across a deploy
  // never asks for a chunk that deploy removed. Guest pages never load the POS.
  useEffect(() => {
    if (!isAuth || bare) return undefined;
    const timer = setTimeout(() => Object.values(PAGE_LOADERS).forEach((load) => load().catch(() => {})), 3000);
    return () => clearTimeout(timer);
  }, [isAuth, bare]);

  if (isLoading) return <FullScreenLoader />;

  const routes = (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route path="/" element={<ProtectedRoutes><Menu /></ProtectedRoutes>} />
        <Route path="/auth" element={isAuth ? <Navigate to="/" /> : <Auth />} />
        <Route path="/impersonate" element={<Impersonate />} />
        <Route path="/menu" element={<ProtectedRoutes><Menu /></ProtectedRoutes>} />
        <Route path="/orders" element={<ProtectedRoutes><Orders /></ProtectedRoutes>} />
        <Route path="/reports" element={<ProtectedRoutes><Reports /></ProtectedRoutes>} />
        {/* Settings draws the lock card: the tables tile is locked by tableQr. While the plan loads, neither (offline the query pauses, and the floor shows). */}
        <Route path="/tables" element={<ProtectedRoutes>{planLoading ? <FullScreenLoader /> : billingOnly ? <Navigate to="/settings?view=tables" replace /> : <Tables />}</ProtectedRoutes>} />
        <Route path="/settings" element={<ProtectedRoutes><Settings /></ProtectedRoutes>} />
        {/* Reachable even when the account is locked -- see middlewares/accountLock.js */}
        <Route path="/settings/billing" element={<ProtectedRoutes><Billing /></ProtectedRoutes>} />
        <Route path="/support" element={<ProtectedRoutes><Support /></ProtectedRoutes>} />
        <Route path="/manage-menu" element={<ProtectedRoutes><ManageMenuPage /></ProtectedRoutes>} />

        <Route path="/website" element={<ProtectedRoutes><WebsiteSettings /></ProtectedRoutes>} />

        <Route path="/order" element={<OrderOnline />} />
        <Route path="/t/:token" element={<OrderOnline />} />
        <Route path="/pay/:token" element={<PaymentLink />} />
        <Route path="*" element={<div className="p-8">Not Found</div>} />
      </Routes>
    </Suspense>
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
        {isAuth && <OfflineBanner online={offline.online} queued={offline.queued} rejected={offline.rejected} onSync={offline.flush} onDiscard={offline.discard} />}
        {isAuth && <OldWebViewBanner />}
        {isAuth && <AccountLockBanner {...lock} />}
        {isAuth && <GlobalPinPrompt />}
        {lock.locked ? <LockRedirect /> : null}
        {routes}
      </main>
      {isAuth && !lock.locked && (
        <>
          {tableService && <MarketplaceOrderPopup />}
          <NewOrderPopup />
          {tableService && <WaiterCallPopup />}
          {tableService && <TableBookingPopup />}
          <PrepDuePopup />
          {tableService && <AddedItemsPopup />}
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
