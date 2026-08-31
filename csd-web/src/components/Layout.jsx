import React, { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  FiGrid, FiUserPlus, FiUsers, FiShoppingBag, FiSearch, FiMessageSquare,
  FiCheckSquare, FiBarChart2, FiSettings, FiLogOut, FiMenu, FiX, FiBell, FiFileText,
} from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import GlobalSearch from "./GlobalSearch";
import markUrl from "../assets/knotkitchen-mark.png";

/**
 * `adminOnly` here controls VISIBILITY only. Authorisation is enforced by
 * requireCsdAdmin on the server and by <RequireAdmin> on the route — this
 * array is not a security boundary.
 */
const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: FiGrid, adminOnly: true },
  { to: "/agreements", label: "Agreements", icon: FiFileText, adminOnly: true },
  { to: "/onboarding", label: "Store Onboarding", icon: FiUserPlus, adminOnly: true },
  { to: "/stores", label: "Store Management", icon: FiShoppingBag, adminOnly: false },
  { to: "/search", label: "Search Console", icon: FiSearch, adminOnly: false },
  { to: "/chat", label: "Chat", icon: FiMessageSquare, adminOnly: false },
  { to: "/jobs", label: "Jobs", icon: FiCheckSquare, adminOnly: false },
  { to: "/staff", label: "Staff Management", icon: FiUsers, adminOnly: true },
  { to: "/reports", label: "Reports", icon: FiBarChart2, adminOnly: true },
  { to: "/settings", label: "Settings", icon: FiSettings, adminOnly: true },
];

const Layout = () => {
  const { staff, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const items = NAV.filter((n) => !n.adminOnly || isAdmin);

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
      isActive ? "bg-brand-600 text-white" : "text-navy-200 hover:bg-navy-800 hover:text-white"
    }`;

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-navy-50">
      {/* Sidebar — collapsed to a 64px rail on lg+ by default; hover expands
          it to 288px without pushing content over (the wider state overlays).
          Mobile keeps the slide-in drawer behavior. */}
      <aside
        className={`group fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-navy-950 shadow-lg transition-[width,transform] duration-200 lg:w-16 lg:hover:w-72 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Primary navigation"
      >
        <div className="flex items-center gap-2.5 px-5 py-5 lg:px-4">
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
          className="mx-3 mb-4 flex items-center gap-3 rounded-xl border border-navy-800 bg-navy-900 p-3 hover:border-navy-700 lg:mx-2 lg:p-2"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
            {(staff?.fullName || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 opacity-100 transition-opacity duration-150 lg:opacity-0 lg:group-hover:opacity-100">
            <div className="truncate text-sm font-semibold text-white">{staff?.fullName}</div>
            <div className="text-[11px] text-navy-400 whitespace-nowrap">
              Staff ID: <span className="font-mono">{staff?.staffId}</span>
            </div>
          </div>
        </NavLink>

        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 pb-4 lg:px-2">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              title={label}
              className={linkClass}
            >
              <Icon className="shrink-0" aria-hidden="true" />
              <span className="whitespace-nowrap opacity-100 transition-opacity duration-150 lg:opacity-0 lg:group-hover:opacity-100">
                {label}
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-navy-800 p-3 lg:p-2">
          <div className="px-3 pb-2 text-[11px] uppercase tracking-wider text-navy-500 whitespace-nowrap opacity-100 transition-opacity duration-150 lg:opacity-0 lg:group-hover:opacity-100">
            {isAdmin ? "Administrator" : "CSD Staff"}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            title="Sign out"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-navy-200 hover:bg-navy-800 hover:text-white"
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
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-navy-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-navy-600 lg:hidden"
            aria-label="Open navigation"
          >
            <FiMenu size={20} />
          </button>

          <div className="flex-1">
            <GlobalSearch />
          </div>

          <button
            type="button"
            className="relative hidden text-navy-500 hover:text-navy-800 sm:block"
            aria-label="Notifications"
          >
            <FiBell size={19} />
          </button>

          <div className="hidden items-center gap-2.5 sm:flex">
            <div className="text-right leading-tight">
              <div className="text-sm font-semibold text-navy-900">{staff?.fullName}</div>
              <div className="text-[11px] text-navy-500">{staff?.staffId}</div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
              {(staff?.fullName || "?").slice(0, 1).toUpperCase()}
            </div>
          </div>
        </header>

        <main className="p-3 sm:p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
