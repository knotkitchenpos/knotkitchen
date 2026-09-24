import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import KnotLogo from "./KnotLogo";
import { MENU_ITEMS, shortcutPath, shortLabel } from "../../pages/Settings";
import { useShortcuts } from "../../utils/shortcuts";

/* Reference icons — drawn inline to match design exactly */
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
const IconHeadset = ({ active }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.9} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3ZM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3Z" />
  </svg>
);
const IconSettingsGear = ({ active }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.9} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
/**
 * Main-area navigation.
 *
 * Manage Tables is in Settings; pin it (or any other Settings option) back
 * here with a long-press there (Quick Shortcuts). Help & Support is in both,
 * by request. Settings itself is the pinned footer button. Do not add "/settings" (or "/home") here -- that re-introduces the
 * duplicate buttons the QA screenshot flagged.
 */
const NAV = [
  { path: "/menu", label: "Product", Icon: IconBag },
  { path: "/orders", label: "Orders", Icon: IconClipboard },
  { path: "/reports", label: "Reports", Icon: IconChart },
  { path: "/support", label: "Help & Support", Icon: IconHeadset },
];

/** The pinned Settings options, in the order they were pinned, as nav entries. */
const useShortcutNav = () => {
  const ids = useShortcuts();
  return ids
    .map((id) => MENU_ITEMS.find((m) => m.id === id))
    .filter(Boolean)
    .map((item) => ({ path: shortcutPath(item), label: shortLabel(item), Icon: item.Icon, key: `shortcut-${item.id}` }));
};

/** A shortcut to a Settings sub-view is active only on that sub-view. */
const matches = (location, path) => {
  const [p, q] = path.split("?");
  if (q) return location.pathname === p && location.search === `?${q}`;
  if (p === "/menu") return location.pathname === "/menu" || location.pathname === "/";
  return location.pathname.startsWith(p) && !(p === "/settings" && location.search.includes("view="));
};

const Sidebar = ({ mobileOpen = false, onMobileClose }) => {
  // Desktop: collapsed to icons, expanded while the pointer is over it.
  const [collapsed, setCollapsed] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  const shortcuts = useShortcutNav();
  const isActive = (path) => matches(location, path);

  const go = (path) => {
    navigate(path);
    // A tap on a touch screen never "leaves", so close after choosing.
    setCollapsed(true);
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
        {[...NAV, ...shortcuts].map(({ path, label, Icon, key }, i) => {
          const active = isActive(path);
          return (
            <React.Fragment key={key || path}>
            {i === NAV.length && (
              <div className={`pt-3 pb-1 ${isCollapsed ? "border-t border-white/10 mx-2" : "px-4"}`}>
                {!isCollapsed && <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#5B6478]">Shortcuts</span>}
              </div>
            )}
            <button
              onClick={() => go(path)}
              title={isCollapsed ? label : undefined}
              className={`w-full flex items-center rounded-xl transition-colors duration-150 ${
                isCollapsed ? "justify-center py-3.5" : "gap-4 px-4 py-3.5"
              } ${
                active
                  ? "bg-[#FD5302] text-white font-bold"
                  : "text-[#9AA3B8] hover:bg-[#161C33] hover:text-white font-semibold"
              }`}
            >
              <Icon active={active} />
              {!isCollapsed && <span className="text-[15px] whitespace-nowrap">{label}</span>}
            </button>
            </React.Fragment>
          );
        })}
      </nav>

      {/* Footer: Module 6 §1 Settings Icon */}
      <div className={`relative shrink-0 pb-5 space-y-2 ${isCollapsed ? "px-2" : "px-4"}`}>
        <button
          onClick={() => go("/settings")}
          title={isCollapsed ? "Settings" : undefined}
          className={`w-full flex items-center rounded-xl border border-white/10 ${
            isActive("/settings") ? "bg-[#FD5302] text-white font-bold" : "bg-[#111729] text-[#9AA3B8] hover:text-white hover:bg-[#161C33]"
          } transition-colors ${
            isCollapsed ? "justify-center py-3.5" : "gap-4 px-4 py-3.5"
          }`}
        >
          <IconSettingsGear active={isActive("/settings")} />
          {!isCollapsed && <span className="text-[15px] font-semibold">Settings</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      {/* The aside keeps the collapsed width in the layout; the panel widens
          OVER the page on hover, so the screen underneath never reflows. */}
      <aside
        className="hidden lg:block relative shrink-0 h-full w-[84px] z-40"
        onMouseEnter={() => setCollapsed(false)}
        onMouseLeave={() => setCollapsed(true)}
      >
        <div
          className={`absolute inset-y-0 left-0 overflow-hidden transition-[width,box-shadow] duration-200 ${
            collapsed ? "w-[84px]" : "w-[236px] shadow-2xl shadow-black/40"
          }`}
        >
          <Panel isCollapsed={collapsed} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden">
          <div onClick={onMobileClose} className="fixed inset-0 z-[55] bg-black/60" />
          <aside className="fixed top-0 left-0 bottom-0 w-[260px] max-w-[85vw] z-[56] pb-[env(safe-area-inset-bottom)]">
            <Panel isCollapsed={false} />
          </aside>
        </div>
      )}
    </>
  );
};

/**
 * Phone and tablet navigation (below lg), fixed to the bottom of the screen.
 * The first four screens get a tab each; "More" opens the drawer, which also
 * holds Help & Support and Settings.
 */
const TABS = [
  { path: "/menu", label: "Product", Icon: IconBag },
  { path: "/orders", label: "Orders", Icon: IconClipboard },
  { path: "/reports", label: "Reports", Icon: IconChart },
];
// Pinned shortcuts beyond this many are in the "More" drawer.
const BAR_SHORTCUTS = 2;

const IconMore = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export const MobileNav = ({ onMore }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const tabs = [...TABS, ...useShortcutNav().slice(0, BAR_SHORTCUTS)];
  const isOn = (path) => matches(location, path);
  const moreOn = !tabs.some((t) => isOn(t.path));

  const tab = (key, label, Icon, on, onClick) => (
    <button
      key={key}
      onClick={onClick}
      aria-current={on ? "page" : undefined}
      className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-full text-[11px] font-bold ${
        on ? "text-[#FD5302]" : "text-[#9AA3B8]"
      }`}
    >
      <Icon active={on} />
      <span className="truncate max-w-full px-1">{label}</span>
    </button>
  );

  return (
    <nav
      className="lg:hidden fixed inset-x-0 bottom-0 z-50 bg-[#0B1120] border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
      aria-label="Main"
    >
      <div className="flex h-[60px]">
        {tabs.map(({ path, label, Icon, key }) => tab(key || path, label, Icon, isOn(path), () => navigate(path)))}
        {tab("more", "More", IconMore, moreOn, onMore)}
      </div>
    </nav>
  );
};

export default Sidebar;
