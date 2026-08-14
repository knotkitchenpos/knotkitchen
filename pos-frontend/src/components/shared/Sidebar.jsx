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
import KnotLogo from "./KnotLogo";

const navItems = [
  { path: "/menu", label: "Menu", icon: <FiCoffee size={18} /> },
  { path: "/home", label: "Dashboard", icon: <FiHome size={18} /> },
  { path: "/orders", label: "Orders", icon: <FiClipboard size={18} /> },
  { path: "/tables", label: "Tables", icon: <FiGrid size={18} /> },
  { path: "/kds", label: "Kitchen Display (KDS)", icon: <FiMonitor size={18} /> },
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
    <div className="flex flex-col h-full bg-[#0D1526]">
      {/* Sidebar Header / Logo */}
      <div className={`flex items-center h-20 border-b border-[#26344B] shrink-0 ${collapsed ? "justify-center px-2" : "justify-between px-5"}`}>
        <button
          onClick={() => { onNavigate?.(); navigate("/"); }}
          className="flex items-center gap-2 cursor-pointer overflow-hidden group text-left"
          title="KnotKitchen"
        >
          {collapsed ? (
            <div className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center text-white font-bold font-display text-xl shadow-orange">
              K
            </div>
          ) : (
            <KnotLogo size="md" />
          )}
        </button>
        {!collapsed && (
          <button onClick={onNavigate} className="lg:hidden p-2 rounded-xl hover:bg-[#162238] text-[#AEB8CA]">
            <FiX size={20} />
          </button>
        )}
      </div>

      {/* Collapse Toggle Control */}
      <div className="px-3 pt-3 shrink-0">
        <button
          onClick={onToggleCollapse}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all text-[#77839A] hover:bg-[#162238] hover:text-[#F5F7FA] ${
            collapsed ? "justify-center px-2" : ""
          }`}
          title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {collapsed ? <FiChevronRight size={18} /> : (
            <>
              <FiChevronLeft size={18} />
              <span>Collapse Menu</span>
            </>
          )}
        </button>
      </div>

      {/* User Info Bar */}
      <div className={`pt-4 shrink-0 ${collapsed ? "px-3 flex justify-center" : "px-5"}`}>
        <div className={`flex items-center gap-3 p-2.5 rounded-xl bg-[#111B2E] border border-[#26344B] ${collapsed ? "flex-col gap-1 p-2" : ""}`}>
          <div className="w-9 h-9 rounded-lg bg-gradient-brand flex items-center justify-center text-white font-bold shadow-orange shrink-0">
            {userData.name?.[0]?.toUpperCase() || "U"}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-xs text-[#F5F7FA] truncate">{userData.name || "Operator"}</p>
              <p className="text-[11px] text-[#77839A] truncate">{userData.role || "POS User"}</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto no-scrollbar">
        {!collapsed && (
          <p className="px-3 pb-2 text-[10px] font-bold text-[#77839A] uppercase tracking-wider">
            Menu Navigation
          </p>
        )}
        {allNavItems.map((item) => {
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => { onNavigate?.(); navigate(item.path); }}
              className={`relative w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                collapsed ? "justify-center px-2" : ""
              } ${
                active
                  ? "bg-accent/10 text-accent border border-accent/20 shadow-sm"
                  : "text-[#AEB8CA] hover:bg-[#162238] hover:text-[#F5F7FA]"
              }`}
              title={collapsed ? item.label : ""}
            >
              {active && (
                <motion.div
                  layoutId="sidebar-active-indicator"
                  className="absolute left-0 top-2 bottom-2 w-1 bg-accent rounded-r-full"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className={active ? "text-accent" : "text-[#77839A]"}>
                {item.icon}
              </span>
              {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Logout Action */}
      <div className={`pb-5 shrink-0 ${collapsed ? "px-3" : "px-5"}`}>
        {confirmLogout ? (
          <div className={`flex items-center gap-2 ${collapsed ? "flex-col" : ""}`}>
            <button onClick={() => logoutMutation.mutate()} className="flex-1 py-2.5 rounded-xl bg-accent-red text-white font-semibold text-xs">Confirm</button>
            <button onClick={() => setConfirmLogout(false)} className="flex-1 py-2.5 rounded-xl bg-[#162238] text-[#AEB8CA] font-semibold text-xs">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmLogout(true)}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent-red/10 border border-accent-red/20 text-accent-red font-semibold text-xs hover:bg-accent-red/20 transition-all ${
              collapsed ? "px-2" : ""
            }`}
            title="Logout"
          >
            <FiLogOut size={16} />
            {!collapsed && <span>Logout Operator</span>}
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
      <aside className={`hidden lg:flex flex-col shrink-0 h-full border-r border-[#26344B] bg-[#0D1526] transition-all duration-300 ${collapsed ? "w-[76px]" : "w-64"}`}>
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
              className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm lg:hidden"
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "tween", duration: 0.25 }}
              className="fixed top-0 left-0 bottom-0 w-72 z-[60] bg-[#0D1526] border-r border-[#26344B] lg:hidden"
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
