import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiHome, FiClipboard, FiGrid, FiCoffee, FiLayout, FiMonitor,
  FiX, FiLogOut, FiChevronLeft, FiChevronRight
} from "react-icons/fi";
import { useDispatch, useSelector } from "react-redux";
import { useMutation } from "@tanstack/react-query";
import { logout } from "../../https";
import { removeUser } from "../../redux/slices/userSlice";
import { useLocation, useNavigate } from "react-router-dom";

const navItems = [
  { path: "/menu", label: "Menu", icon: <FiCoffee size={18} /> },
  { path: "/home", label: "Dashboard", icon: <FiHome size={18} /> },
  { path: "/orders", label: "Orders", icon: <FiClipboard size={18} /> },
  { path: "/tables", label: "Tables", icon: <FiGrid size={18} /> },
  { path: "/kds", label: "KDS", icon: <FiMonitor size={18} /> },
];

const SidebarContent = ({ collapsed, onToggleCollapse, onNavigate }) => {
  const userData = useSelector((s) => s.user);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [confirmLogout, setConfirmLogout] = useState(false);

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: () => { dispatch(removeUser()); navigate("/auth"); },
  });

  const isActive = (path) => {
    // "/" and "/menu" both render the Menu page
    if (path === "/menu") return location.pathname === "/menu" || location.pathname === "/";
    return location.pathname === path;
  };

  const allNavItems = [
    ...navItems,
    ...((userData.role === "Admin" || userData.role === "Owner")
      ? [{ path: "/dashboard", label: "Admin", icon: <FiLayout size={18} /> }]
      : []),
  ];

  return (
    <div className="flex flex-col h-full">
      <div className={`flex items-center h-16 border-b border-border shrink-0 ${collapsed ? "justify-center px-2" : "justify-between px-5"}`}>
        <button
          onClick={() => { onNavigate?.(); navigate("/"); }}
          className="flex items-center cursor-pointer overflow-hidden"
          title="KnotKitchen"
        >
          {collapsed ? (
            <span className="font-display text-2xl font-bold tracking-tight text-accent">K</span>
          ) : (
            <span className="font-display text-xl font-bold tracking-tight whitespace-nowrap">
              Knot<span className="text-accent">Kitchen</span>
            </span>
          )}
        </button>
        <div className="flex items-center">
          {!collapsed && (
            <button onClick={onNavigate} className="lg:hidden p-2 -mr-2 rounded-lg hover:bg-surface-tertiary text-content-muted">
              <FiX size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Collapse toggle */}
      <div className="px-3 pt-3 shrink-0">
        <button
          onClick={onToggleCollapse}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors text-content-muted hover:bg-surface-tertiary hover:text-content ${
            collapsed ? "justify-center px-2" : ""
          }`}
          title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {collapsed ? <FiChevronRight size={18} /> : (
            <>
              <FiChevronLeft size={18} />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>

      <div className={`pt-5 shrink-0 ${collapsed ? "px-3 flex justify-center" : "px-5"}`}>
        <div className={`flex items-center gap-3 ${collapsed ? "flex-col gap-1" : ""}`}>
          <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-white font-bold">
            {userData.name?.[0]?.toUpperCase() || "U"}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{userData.name || "User"}</p>
              <p className="text-xs text-content-muted">{userData.role || "Role"}</p>
            </div>
          )}
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto no-scrollbar">
        {!collapsed && (
          <p className="px-3 pb-2 text-[11px] font-bold text-content-muted uppercase tracking-wider">Navigation</p>
        )}
        {allNavItems.map((item) => (
          <button
            key={item.path}
            onClick={() => { onNavigate?.(); navigate(item.path); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
              collapsed ? "justify-center px-2" : ""
            } ${
              isActive(item.path)
                ? "bg-accent/10 text-accent"
                : "text-content-secondary hover:bg-surface-tertiary hover:text-content"
            }`}
            title={collapsed ? item.label : ""}
          >
            {item.icon}
            {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
          </button>
        ))}
      </nav>

      <div className={`pb-5 shrink-0 ${collapsed ? "px-3" : "px-5"}`}>
        {confirmLogout ? (
          <div className={`flex items-center gap-2 ${collapsed ? "flex-col" : ""}`}>
            <button onClick={() => logoutMutation.mutate()} className="flex-1 py-2.5 rounded-xl bg-accent-red text-white font-semibold text-sm">Confirm</button>
            <button onClick={() => setConfirmLogout(false)} className="flex-1 py-2.5 rounded-xl bg-surface-tertiary text-content-muted font-semibold text-sm">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmLogout(true)}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent-red/10 text-accent-red font-semibold text-sm hover:bg-accent-red/20 transition-colors ${
              collapsed ? "px-2" : ""
            }`}
            title="Logout"
          >
            <FiLogOut size={16} />
            {!collapsed && <span>Logout</span>}
          </button>
        )}
      </div>
    </div>
  );
};

const Sidebar = ({ mobileOpen = false, onMobileClose }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      <aside className={`hidden lg:flex flex-col shrink-0 h-full border-r border-border bg-surface-secondary transition-all duration-300 ${collapsed ? "w-[72px]" : "w-64"}`}>
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onMobileClose}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "tween", duration: 0.25 }}
              className="fixed top-0 left-0 bottom-0 w-72 z-[60] bg-surface-secondary border-r border-border lg:hidden"
            >
              <SidebarContent
                collapsed={false}
                onToggleCollapse={() => {}}
                onNavigate={onMobileClose}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default Sidebar;
