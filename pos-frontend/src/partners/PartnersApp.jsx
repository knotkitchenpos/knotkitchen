import React, { Suspense, lazy, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDispatch } from "react-redux";
import { MdDashboard, MdStorefront, MdReceiptLong, MdBarChart, MdListAlt, MdPerson, MdLogout, MdFileDownload } from "react-icons/md";
import { setUser } from "../redux/slices/userSlice";
import { partnersApi } from "./api";
import { activePartnerStore, setActivePartnerStore } from "./mode";
import Login from "./pages/Login";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Stores = lazy(() => import("./pages/Stores"));
const BillingPage = lazy(() => import("./pages/BillingPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const OrdersPage = lazy(() => import("./pages/OrdersPage"));
const Account = lazy(() => import("./pages/Account"));
const Exports = lazy(() => import("./pages/Exports"));

const NAV = [
  { to: "/", label: "Dashboard", Icon: MdDashboard, end: true },
  { to: "/orders", label: "Orders", Icon: MdListAlt },
  { to: "/reports", label: "Reports", Icon: MdBarChart },
  { to: "/billing", label: "Billing", Icon: MdReceiptLong },
  { to: "/exports", label: "Exports", Icon: MdFileDownload },
  { to: "/stores", label: "Stores", Icon: MdStorefront },
  { to: "/account", label: "Account", Icon: MdPerson, desktopOnly: true },
];

export const usePartner = () =>
  useQuery({ queryKey: ["partner-me"], queryFn: () => partnersApi.me().then((r) => r.data.data), retry: false, staleTime: 30_000 });

/**
 * The store the Billing and Reports screens act as: kept per tab, and always
 * one that is linked and usable. The POS screens read it through redux too.
 */
export const useActiveStore = (stores) => {
  const dispatch = useDispatch();
  const qc = useQueryClient();
  const usable = (stores || []).filter((s) => s.linkStatus === "ok");
  const [storeId, setStoreId] = useState(activePartnerStore);
  const current = usable.find((s) => s.storeId === storeId) || usable[0] || null;
  useEffect(() => {
    if (!current) return;
    if (current.storeId !== activePartnerStore()) setActivePartnerStore(current.storeId);
    dispatch(setUser({ _id: "", name: current.name, role: "Owner", storeId: current.storeId, restaurantId: current.restaurantId }));
  }, [current, dispatch]);
  const choose = (id) => {
    if (id === current?.storeId) return;
    setActivePartnerStore(id);
    setStoreId(id);
    // One store's billing and reports must never show under another's name.
    qc.removeQueries({ predicate: (q) => !String(q.queryKey[0] || "").startsWith("partner-") });
  };
  return { current, usable, choose };
};

const Loading = () => (
  <div className="flex justify-center py-20">
    <div className="w-8 h-8 rounded-full border-[3px] border-[#FD5302] border-t-transparent animate-spin" />
  </div>
);

const Shell = ({ me, children }) => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const signOut = async () => {
    await partnersApi.logout().catch(() => {});
    qc.clear();
    navigate("/login", { replace: true });
  };
  const locked = (me?.stores || []).filter((s) => s.locked).length;
  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-[#0F172A] lg:flex">
      {/* Desktop side bar */}
      <aside className="hidden lg:flex w-[232px] shrink-0 flex-col bg-[#0B1120] text-white min-h-dvh sticky top-0">
        <div className="px-5 py-5 border-b border-white/10">
          <p className="text-[17px] font-extrabold tracking-tight">
            Knot<span className="text-[#FD5302]">Kitchen</span>
          </p>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/50 mt-0.5">Partners</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 h-11 px-3 rounded-xl text-[14px] font-bold transition-colors ${
                  isActive ? "bg-[#FD5302] text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                }`
              }
            >
              <Icon size={19} />
              {label}
              {to === "/billing" && locked > 0 && <span className="ml-auto text-[10px] font-extrabold bg-[#DC2626] rounded-full px-1.5 py-0.5">{locked}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          <p className="px-3 text-[12.5px] font-bold truncate">{me?.name || "Owner"}</p>
          <p className="px-3 text-[11.5px] text-white/50">{(me?.stores || []).length} store{(me?.stores || []).length === 1 ? "" : "s"} linked</p>
          <button type="button" onClick={signOut} className="mt-2 w-full flex items-center gap-3 h-10 px-3 rounded-xl text-[13px] font-bold text-white/70 hover:bg-white/10 hover:text-white">
            <MdLogout size={18} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Phone header */}
        <header className="lg:hidden sticky top-0 z-30 bg-[#0B1120] text-white px-4 h-14 flex items-center justify-between">
          <p className="text-[16px] font-extrabold">
            Knot<span className="text-[#FD5302]">Kitchen</span> <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/50">Partners</span>
          </p>
          <NavLink to="/account" aria-label="Account" className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
            <MdPerson size={20} />
          </NavLink>
        </header>

        <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-7 pb-24 lg:pb-10">{children}</main>

        {/* Phone bottom bar */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#E2E8F0] grid grid-cols-6 pb-[env(safe-area-inset-bottom)]">
          {NAV.filter((n) => !n.desktopOnly).map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `h-[58px] flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-bold ${isActive ? "text-[#FD5302]" : "text-[#64748B]"}`}
            >
              <Icon size={21} />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
};

const Protected = ({ children }) => {
  const { data: me, isLoading, isError } = usePartner();
  const location = useLocation();
  if (isLoading) return <Loading />;
  if (isError || !me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return (
    <Shell me={me}>
      <Suspense fallback={<Loading />}>{children(me)}</Suspense>
    </Shell>
  );
};

const PartnersApp = () => (
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/" element={<Protected>{(me) => <Dashboard me={me} />}</Protected>} />
    <Route path="/stores" element={<Protected>{(me) => <Stores me={me} />}</Protected>} />
    <Route path="/billing" element={<Protected>{(me) => <BillingPage me={me} />}</Protected>} />
    <Route path="/reports" element={<Protected>{(me) => <ReportsPage me={me} />}</Protected>} />
    <Route path="/orders" element={<Protected>{(me) => <OrdersPage me={me} />}</Protected>} />
    <Route path="/account" element={<Protected>{(me) => <Account me={me} />}</Protected>} />
    <Route path="/exports" element={<Protected>{(me) => <Exports me={me} />}</Protected>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

export default PartnersApp;
