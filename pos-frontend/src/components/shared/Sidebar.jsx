import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { useMutation } from "@tanstack/react-query";
import { logout } from "../../https";
import { removeUser } from "../../redux/slices/userSlice";
import KnotLogo from "./KnotLogo";

/* Reference icons — drawn inline so they match the screenshot exactly */
const IconBag = ({ active }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.9} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);
const IconClipboard = ({ active }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.9} strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M9 12h6M9 16h4" />
  </svg>
);
const IconChart = ({ active }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.9} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <path d="M7 15v3M12 10v8M17 6v12" />
  </svg>
);
const IconGear = ({ active }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.9} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);
const IconHeadset = ({ active }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.9} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3ZM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3Z" />
  </svg>
);
const IconDots = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);
const IconArrowLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);
const IconArrowRight = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const NAV = [
  { path: "/menu", label: "Product", Icon: IconBag },
  { path: "/orders", label: "Orders", Icon: IconClipboard },
  { path: "/reports", label: "Reports", Icon: IconChart },
  { path: "/dashboard", label: "Dashboard", Icon: IconGear },
  { path: "/home", label: "Help & Support", Icon: IconHeadset },
];

const Sidebar = ({ mobileOpen = false, onMobileClose }) => {
  const [collapsed, setCollapsed] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();

  useEffect(() => {
    if (!moreOpen) return undefined;

    const closeOnOutsideClick = (event) => {
      if (!moreRef.current?.contains(event.target)) {
        setMoreOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [moreOpen]);

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: () => {
      dispatch(removeUser());
      navigate("/auth");
    },
  });

  const isActive = (path) =>
    path === "/menu"
      ? location.pathname === "/menu" || location.pathname === "/"
      : location.pathname === path;

  const go = (path) => {
    navigate(path);
    onMobileClose?.();
  };

  const Panel = ({ isCollapsed }) => (
    <div className="flex flex-col h-full bg-[#0B1120]">
      {/* Brand */}
      <div className={`flex items-center h-[76px] shrink-0 ${isCollapsed ? "justify-center px-2" : "px-6"}`}>
        <button onClick={() => go("/")} className="flex items-center gap-2.5" title="KnotKitchen POS">
          <KnotLogo size={34} />
          {!isCollapsed && (
            <div className="text-left leading-none">
              <div className="text-[19px] font-extrabold tracking-tight">
                <span className="text-white">Knot</span><span className="text-[#FF6A1F]">Kitchen</span>
              </div>
              <div className="text-[11px] font-bold text-[#8B93A8] tracking-[0.14em] mt-1">POS</div>
            </div>
          )}
        </button>
      </div>

      {/* Nav */}
      <nav className={`flex-1 overflow-y-auto no-scrollbar space-y-1.5 ${isCollapsed ? "px-2" : "px-4"}`}>
        {NAV.map(({ path, label, Icon }) => {
          const active = isActive(path);
          return (
            <button
              key={path}
              onClick={() => go(path)}
              title={isCollapsed ? label : undefined}
              className={`w-full flex items-center rounded-xl transition-colors duration-150 ${
                isCollapsed ? "justify-center py-3.5" : "gap-4 px-4 py-3.5"
              } ${
                active
                  ? "bg-[#5B42F3] text-white font-bold"
                  : "text-[#9AA3B8] hover:bg-[#161C33] hover:text-white font-semibold"
              }`}
            >
              <Icon active={active} />
              {!isCollapsed && <span className="text-[15px] whitespace-nowrap">{label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Footer: More + Collapse */}
      <div ref={moreRef} className={`relative shrink-0 pb-5 space-y-2 ${isCollapsed ? "px-2" : "px-4"}`}>
        {moreOpen && (
          <div className={`rounded-xl bg-[#161C33] border border-white/10 p-2 space-y-1 z-50 ${
            isCollapsed ? "absolute bottom-[76px] left-[76px] w-[210px] shadow-2xl" : ""
          }`}>
            <button
              onClick={() => { setMoreOpen(false); go("/tables"); }}
              className="w-full text-left px-3 py-2 rounded-lg text-[13px] font-semibold text-[#9AA3B8] hover:bg-white/5 hover:text-white"
            >
              Tables
            </button>
            <button
              onClick={() => { setMoreOpen(false); go("/kds"); }}
              className="w-full text-left px-3 py-2 rounded-lg text-[13px] font-semibold text-[#9AA3B8] hover:bg-white/5 hover:text-white"
            >
              Kitchen Display
            </button>
            <button
              onClick={() => { setMoreOpen(false); go("/online-orders"); }}
              className="w-full text-left px-3 py-2 rounded-lg text-[13px] font-semibold text-[#9AA3B8] hover:bg-white/5 hover:text-white"
            >
              Online Orders
            </button>
            <button
              onClick={() => { setMoreOpen(false); go("/website"); }}
              className="w-full text-left px-3 py-2 rounded-lg text-[13px] font-semibold text-[#9AA3B8] hover:bg-white/5 hover:text-white"
            >
              Website
            </button>
            <button
              onClick={() => { setMoreOpen(false); logoutMutation.mutate(); }}
              className="w-full text-left px-3 py-2 rounded-lg text-[13px] font-bold text-red-400 hover:bg-red-500/10"
            >
              Logout
            </button>
          </div>
        )}

        <button
          onClick={() => setMoreOpen((v) => !v)}
          title={isCollapsed ? "More" : undefined}
          className={`w-full flex items-center rounded-xl border border-white/10 bg-[#111729] text-[#9AA3B8] hover:text-white hover:bg-[#161C33] transition-colors ${
            isCollapsed ? "justify-center py-3.5" : "gap-4 px-4 py-3.5"
          }`}
        >
          <IconDots />
          {!isCollapsed && <span className="text-[15px] font-semibold">More</span>}
        </button>

        <button
          onClick={() => setCollapsed((c) => !c)}
          title={isCollapsed ? "Expand" : "Collapse"}
          className={`w-full flex items-center rounded-xl text-[#9AA3B8] hover:text-white hover:bg-[#161C33] transition-colors ${
            isCollapsed ? "justify-center py-3.5" : "gap-4 px-4 py-3.5"
          }`}
        >
          {isCollapsed ? <IconArrowRight /> : <IconArrowLeft />}
          {!isCollapsed && <span className="text-[15px] font-semibold">Collapse</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside
        className={`hidden lg:block shrink-0 h-full transition-[width] duration-200 ${
          collapsed ? "w-[84px]" : "w-[236px]"
        }`}
      >
        <Panel isCollapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden">
          <div onClick={onMobileClose} className="fixed inset-0 z-40 bg-black/60" />
          <aside className="fixed top-0 left-0 bottom-0 w-[260px] z-50">
            <Panel isCollapsed={false} />
          </aside>
        </div>
      )}
    </>
  );
};

export default Sidebar;
