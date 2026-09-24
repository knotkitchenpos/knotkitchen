import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  FiGrid, FiUserPlus, FiUsers, FiShoppingBag, FiSearch, FiMessageSquare,
  FiCheckSquare, FiBarChart2, FiSettings, FiLogOut, FiMenu, FiX, FiBell, FiFileText,
  FiDollarSign, FiPackage,
} from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { hardwareRequests } from "../api";
import GlobalSearch from "./GlobalSearch";
import markUrl from "../assets/knotkitchen-mark.png";

/**
 * `adminOnly` here controls VISIBILITY only. Authorisation is enforced by
 * requireCsdAdmin on the server and by <RequireAdmin> on the route — this
 * array is not a security boundary.
 */
const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: FiGrid, adminOnly: true, group: "Overview" },
  { to: "/reports", label: "Reports", icon: FiBarChart2, adminOnly: true, group: "Overview" },
  { to: "/stores", label: "Store Management", icon: FiShoppingBag, adminOnly: false, group: "Stores" },
  { to: "/onboarding", label: "Store Onboarding", icon: FiUserPlus, adminOnly: true, group: "Stores" },
  { to: "/agreements", label: "Agreements", icon: FiFileText, adminOnly: true, group: "Stores" },
  { to: "/search", label: "Search Console", icon: FiSearch, adminOnly: false, group: "Support" },
  { to: "/chat", label: "Chat", icon: FiMessageSquare, adminOnly: false, group: "Support" },
  { to: "/jobs", label: "Jobs", icon: FiCheckSquare, adminOnly: false, group: "Support" },
  { to: "/hardware", label: "Hardware requests", icon: FiPackage, adminOnly: false, group: "Support", badge: "hardware" },
  { to: "/billing", label: "Billing", icon: FiDollarSign, adminOnly: true, group: "Admin" },
  { to: "/staff", label: "Staff Management", icon: FiUsers, adminOnly: true, group: "Admin" },
  { to: "/settings", label: "Settings", icon: FiSettings, adminOnly: true, group: "Admin" },
];

// Fades with the rail: hidden while it is collapsed on a desktop, shown on hover.
const LABEL = "whitespace-nowrap opacity-100 transition-opacity duration-150 lg:opacity-0 lg:group-hover:opacity-100";

const Layout = () => {
  const { staff, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { pathname } = useLocation();
  // New (paid, not yet accepted) printer/tablet requests, on the nav. CSD is
  // not on the socket, so this polls; a minute is fresh enough for a delivery.
  const [newRequests, setNewRequests] = useState(0);
  useEffect(() => {
    let alive = true;
    const poll = () =>
      hardwareRequests.counts().then((c) => alive && setNewRequests(c.REQUESTED || 0)).catch(() => {});
    poll();
    const t = setInterval(poll, 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pathname]);
  const badges = { hardware: newRequests };
  const items = NAV.filter((n) => !n.adminOnly || isAdmin);
  const groups = [...new Set(items.map((n) => n.group))];
  // The header names the screen you are on.
  const here = NAV.find((n) => pathname.startsWith(n.to)) || (pathname.startsWith("/profile") ? { label: "My Profile" } : null);
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  // Active: a lit pill with an orange bar on its leading edge.
  const linkClass = ({ isActive }) =>
    `relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
      isActive
        ? "bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-brand-500"
        : "text-navy-300 hover:bg-white/5 hover:text-white"
    }`;

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-navy-50 bg-[radial-gradient(60rem_30rem_at_100%_-10%,rgba(244,98,10,.07),transparent_60%)]">
      {/* Sidebar — collapsed to a 64px rail on lg+ by default; hover expands
          it to 288px without pushing content over (the wider state overlays).
          Mobile keeps the slide-in drawer behavior. */}
      <aside
        className={`group fixed inset-y-0 left-0 z-40 flex w-72 flex-col overflow-hidden bg-gradient-to-b from-navy-900 to-navy-950 shadow-pop transition-[width,transform] duration-200 lg:w-16 lg:hover:w-72 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Primary navigation"
      >
        {/* The same warm glow as knotkitchen.com, drifting behind the rail. */}
        <span className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-[radial-gradient(closest-side,rgba(244,98,10,.26),rgba(244,98,10,.12)_45%,transparent)] will-change-transform animate-drift" aria-hidden="true" />
        <div className="relative flex items-center gap-2.5 px-5 py-5 lg:px-4">
          <img src={markUrl} alt="" className="h-9 w-9 shrink-0 object-contain" />
          <div className="leading-tight opacity-100 transition-opacity duration-150 lg:opacity-0 lg:group-hover:opacity-100">
            <div className="text-sm font-extrabold whitespace-nowrap">
              <span className="text-white">Knot</span>
              <span className="text-brand-500">Kitchen</span>
            </div>
            <div className="text-[11px] font-medium text-navy-400 whitespace-nowrap">Business Panel</div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto text-navy-300 lg:hidden"
            aria-label="Close navigation"
          >
            <FiX />
          </button>
        </div>

        {/* Profile card */}
        <NavLink
          to="/profile"
          onClick={() => setOpen(false)}
          title={staff?.fullName || ""}
          className="relative mx-3 mb-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 hover:bg-white/10 lg:mx-2 lg:p-1.5"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-white shadow-glow">
            {(staff?.fullName || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 opacity-100 transition-opacity duration-150 lg:opacity-0 lg:group-hover:opacity-100">
            <div className="truncate text-sm font-semibold text-white">{staff?.fullName}</div>
            <div className="text-[11px] text-navy-400 whitespace-nowrap">
              Staff ID: <span className="font-mono">{staff?.staffId}</span>
            </div>
          </div>
        </NavLink>

        <nav className="relative flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4 lg:px-2">
          {groups.map((group) => (
            <div key={group} className="mb-3 space-y-1">
              <p className={`px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-navy-500 ${LABEL}`}>{group}</p>
              {items
                .filter((n) => n.group === group)
                .map(({ to, label, icon: Icon, badge }) => (
                  <NavLink key={to} to={to} onClick={() => setOpen(false)} title={label} className={linkClass}>
                    <span className="relative shrink-0">
                      <Icon size={17} aria-hidden="true" />
                      {badges[badge] > 0 && (
                        <span className="absolute -right-2.5 -top-2 min-w-[16px] rounded-full bg-brand-600 px-1 text-center text-[10px] font-bold leading-4 text-white">
                          {badges[badge] > 99 ? "99+" : badges[badge]}
                          <span className="sr-only"> new</span>
                        </span>
                      )}
                    </span>
                    <span className={LABEL}>{label}</span>
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>

        <div className="relative border-t border-white/10 p-3 lg:p-2">
          <div className="px-3 pb-2 text-[11px] uppercase tracking-wider text-navy-500 whitespace-nowrap opacity-100 transition-opacity duration-150 lg:opacity-0 lg:group-hover:opacity-100">
            {isAdmin ? "Administrator" : "CSD Staff"}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            title="Sign out"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-navy-300 hover:bg-white/5 hover:text-white"
          >
            <FiLogOut className="shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap opacity-100 transition-opacity duration-150 lg:opacity-0 lg:group-hover:opacity-100">
              Sign out
            </span>
          </button>
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Main column — always offset by the COLLAPSED rail so content doesn't
          shift when the sidebar expands on hover. */}
      <div className="lg:pl-16">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-navy-200/70 bg-white/95 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-navy-600 lg:hidden"
            aria-label="Open navigation"
          >
            <FiMenu size={20} />
          </button>

          {here ? (
            <div className="hidden min-w-0 leading-tight md:block">
              <div className="truncate text-sm font-bold text-navy-900">{here.label}</div>
              <div className="text-[11px] text-navy-400">{today}</div>
            </div>
          ) : null}

          <div className="flex-1">
            <GlobalSearch />
          </div>

          <button
            type="button"
            className="relative hidden h-9 w-9 place-items-center rounded-full border border-navy-200 bg-white text-navy-500 hover:border-navy-300 hover:text-navy-800 sm:grid"
            aria-label="Notifications"
          >
            <FiBell size={19} />
          </button>

          <div className="hidden items-center gap-2.5 sm:flex">
            <div className="text-right leading-tight">
              <div className="text-sm font-semibold text-navy-900">{staff?.fullName}</div>
              <div className="text-[11px] text-navy-500">{staff?.staffId}</div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-white ring-2 ring-white shadow-card">
              {(staff?.fullName || "?").slice(0, 1).toUpperCase()}
            </div>
          </div>
        </header>

        <main className="p-3 sm:p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
