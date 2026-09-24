import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toggleShortcut, useShortcuts } from "../utils/shortcuts";
import { clearActiveStoreId } from "../utils/storeSession";
import { useDispatch } from "react-redux";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getSubscriptionStatus, logout } from "../https";
import { removeUser } from "../redux/slices/userSlice";
import DeviceConfiguration from "../components/settings/DeviceConfiguration";
import ShiftView from "../components/settings/ShiftView";
import InventoryView from "../components/settings/InventoryView";
import { I } from "../components/settings/icons";
import ManageCacheView from "../components/settings/ManageCacheView";
import StorePropertiesView from "../components/settings/StorePropertiesView";
import OrderTypesAutoReadyView from "../components/settings/OrderTypesAutoReadyView";
import TimingsHolidaysView from "../components/settings/TimingsHolidaysView";
import ManageStaffView from "../components/settings/ManageStaffView";
import RulesChargesView from "../components/settings/RulesChargesView";

const SHOW_LATER_FEATURES = false;

export const MENU_ITEMS = [
  { id: "cache", title: "1. Manage Cache", desc: "Publish menu changes to the POS tills.", Icon: I.database, mode: "view" },
  { id: "device", title: "2. Device Configuration", desc: "Printer paper sizes, auto-print & e-bill settings.", Icon: I.printer, mode: "view" },
  { id: "properties", title: "3. Store Properties", desc: "Store details & protection PIN.", Icon: I.store, mode: "view" },
  { id: "menu", title: "4. Manage Menu", desc: "Categories, dishes, variants and add-ons.", Icon: I.utensils, path: "/manage-menu" },
  // Moved here from the side panel; pin it back with a long-press (Quick Shortcuts).
  { id: "tables", title: "5. Manage Tables", desc: "Tables, areas and table QR codes.", Icon: I.tables, path: "/tables", feature: "tableQr" },
  { id: "staff", title: "6. Manage Staff", desc: "Add/delete staff and PIN privileges.", Icon: I.users, mode: "view" },
  { id: "toggles", title: "7. Order Toggles & Auto-Ready", desc: "Channel ON/OFF & auto-ready durations.", Icon: I.toggle, mode: "view", feature: "onlineOrdering" },
  { id: "timings", title: "8. Website Timing & Holidays", desc: "Collection, delivery and table booking hours, Close for Today and holidays for the website.", Icon: I.calendar, mode: "view", feature: "website" },
  { id: "rules", title: "9. Rules, Charges & Promotions", desc: "Min orders, delivery slabs, GST, coupons, free items.", Icon: I.fileText, mode: "view", feature: "onlineOrdering" },
  { id: "reports", title: "10. Reports", desc: "Sales, revenue and order breakdowns.", Icon: I.chart, path: "/reports" },
  // Shift & Day End and Inventory are built (ShiftView, InventoryView) but
  // hidden until the user wants them on. Flip SHOW_LATER_FEATURES to list them.
  ...(SHOW_LATER_FEATURES
    ? [
        { id: "shift", title: "Shift & Day End", desc: "Open the till with a float, close with a cash count, print the Z report.", Icon: I.cash, mode: "view" },
        { id: "inventory", title: "Inventory", desc: "Ingredients, stock levels, recipes per dish, wastage. Sales deplete stock automatically.", Icon: I.boxes, mode: "view" },
      ]
    : []),
  // Reachable even when the account is locked -- it is the only screen that
  // can clear a lock, so it must never be gated. See middlewares/accountLock.js.
  { id: "billing", title: "11. Billing & Subscription", desc: "Wallet, POS plan, add-ons, tablets, printers and invoices.", Icon: I.fileText, path: "/settings/billing" },

  { id: "website", title: "12. Manage Website", desc: "Landing page, branding, colours, domain and payments.", Icon: I.globe, path: "/website", feature: "website", lockedDesc: "Payment gateway only. The website is an add-on.", openWhenLocked: "paymentGateway" },

  // Activity Log stays CSD-only: it is the audit trail of who did what,
  // including support's own actions, and has no POS route at all (CSD reads
  // it through /api/csd).
  // Also in the side panel; listed here so it is one tap away on a phone.
  { id: "support", title: "13. Help & Support", desc: "Call or message KnotKitchen support.", Icon: I.headset, path: "/support" },
  { id: "logout", title: "14. Logout", desc: "Securely sign out of the POS system.", Icon: I.logout, action: "logout" },
];

/** Which add-on unlocks a locked option (services/planFeatures on the server). */
const ADDON_FOR = { website: "Website", tableQr: "QR Table Ordering", onlineOrdering: "Website or QR Table Ordering" };

/** "5. Manage Tables" -> "Manage Tables". */
export const shortLabel = (item) => String(item?.title || "").replace(/^\d+\.\s*/, "");

/** Anything that opens a screen can be pinned; Logout cannot. Help & Support is always in the side panel. */
export const canPin = (item) => Boolean(item && (item.path || item.mode === "view") && item.id !== "support");

/** Where a pinned option goes when tapped in the side panel. */
export const shortcutPath = (item) => (item.path ? item.path : `/settings?view=${item.id}`);

const Settings = () => {
  useEffect(() => {
    document.title = "KnotKitchen | Settings";
  }, []);

  // The open sub-view is in the URL (?view=cache), so a Quick Shortcut can
  // open it directly and the back button closes it.
  const [params, setParams] = useSearchParams();
  const activeSubView = params.get("view");
  const setActiveSubView = (id) => setParams(id ? { view: id } : {});
  const navigate = useNavigate();

  // Long-press (or right-click) an option to pin it to the side panel.
  const shortcuts = useShortcuts();
  const [pinFor, setPinFor] = useState(null);
  const pressTimer = useRef(null);
  const longPressed = useRef(false);
  const startPress = (item) => {
    longPressed.current = false;
    clearTimeout(pressTimer.current);
    if (!canPin(item) || blockedByPlan(item)) return;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setPinFor(item);
    }, 550);
  };
  const cancelPress = () => clearTimeout(pressTimer.current);
  const dispatch = useDispatch();

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: () => {
      // Releases this tab only. Other takeaways open elsewhere keep their
      // own sessionStorage and their own session cookie.
      clearActiveStoreId();
      dispatch(removeUser());
      navigate("/auth");
    },
  });

  // Add-on features (services/planFeatures on the server, which also enforces
  // them): the website tiles need the Website add-on, Manage Tables the QR
  // Table Ordering add-on, and Order Toggles / Rules & Charges either one.
  // On the POS plan alone they are locked.
  const { data: subRes } = useQuery({ queryKey: ["subscription"], queryFn: getSubscriptionStatus });
  const features = subRes?.data?.data?.features;
  const lockedByPlan = (item) => Boolean(item.feature && features && features[item.feature] === false);
  // Manage Website still opens as the payment gateway only when a store has
  // online payments without the website; today both come with the Website add-on.
  const blockedByPlan = (item) =>
    lockedByPlan(item) && !(item.openWhenLocked && features?.[item.openWhenLocked] !== false);
  const lockedNote = (item) =>
    `Needs the ${ADDON_FOR[item.feature] || "Website"} add-on. Tap to add it in Billing.`;

  const handleClick = (item) => {
    // The click that ends a long-press only opens the pin sheet.
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (blockedByPlan(item)) {
      navigate("/settings/billing");
      return;
    }
    if (item.action === "logout") {
      logoutMutation.mutate();
      return;
    }
    if (item.path) {
      navigate(item.path);
      return;
    }
    if (item.mode === "view") {
      setActiveSubView(item.id);
    }
  };

  const activeMeta = MENU_ITEMS.find((m) => m.id === activeSubView);

  return (
    <div className="h-full w-full overflow-y-auto bg-[#F8FAFC]">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-7 py-4 sm:py-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-5 sm:mb-6">
          {activeSubView && (
            <button
              onClick={() => setActiveSubView(null)}
              className="h-[36px] px-3 shrink-0 whitespace-nowrap rounded-xl border border-[#E2E8F0] bg-white text-[#334155] text-[13px] font-bold hover:border-[#CBD5E1]"
            >
              ← Back
            </button>
          )}
          <div>
            <h1 className="text-[22px] sm:text-[28px] font-extrabold text-[#0F172A] tracking-tight">
              {activeMeta ? activeMeta.title : "Settings"}
            </h1>
            <p className="text-[13.5px] text-[#94A3B8] mt-0.5">
              {activeMeta ? activeMeta.desc : "Configure store properties, device printers, order toggles, staff and cache."}
            </p>
            {!activeMeta && (
              <p className="text-[12px] text-[#94A3B8] mt-1">Tip: long-press an option to add it to the side panel as a Quick Shortcut.</p>
            )}
          </div>
        </div>

        {/* Active sub-view or item list */}
        {activeMeta && blockedByPlan(activeMeta) ? (
          <button
            type="button"
            onClick={() => navigate("/settings/billing")}
            className="w-full text-left bg-white border border-[#E2E8F0] rounded-2xl p-5 flex items-center gap-3 hover:border-[#FD5302]"
          >
            <span className="text-[#94A3B8]"><I.lock /></span>
            <span className="text-[13.5px] font-bold text-[#334155]">{lockedNote(activeMeta)}</span>
          </button>
        ) : activeSubView === "cache" ? (
          <ManageCacheView />
        ) : activeSubView === "device" ? (
          <DeviceConfiguration />
        ) : activeSubView === "properties" ? (
          <StorePropertiesView />
        ) : activeSubView === "toggles" ? (
          <OrderTypesAutoReadyView />
        ) : activeSubView === "timings" ? (
          <TimingsHolidaysView />
        ) : activeSubView === "staff" ? (
          <ManageStaffView />
        ) : activeSubView === "rules" ? (
          <RulesChargesView />
        ) : activeSubView === "shift" ? (
          <ShiftView />
        ) : activeSubView === "inventory" ? (
          <InventoryView />
        ) : (

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {MENU_ITEMS.map((item) => {
              const Icon = item.Icon;
              const isLogout = item.action === "logout";
              const locked = blockedByPlan(item);
              return (
                <button
                  key={item.id}
                  onClick={() => handleClick(item)}
                  onPointerDown={() => startPress(item)}
                  onPointerUp={cancelPress}
                  onPointerLeave={cancelPress}
                  onPointerCancel={cancelPress}
                  onContextMenu={(e) => {
                    if (!canPin(item) || blockedByPlan(item)) return;
                    e.preventDefault();
                    cancelPress();
                    longPressed.current = true;
                    setPinFor(item);
                  }}
                  style={{ WebkitTouchCallout: "none" }}
                  className={`select-none w-full text-left p-4 rounded-2xl border transition-all flex items-center gap-4 bg-white ${
                    isLogout
                      ? "border-[#FECACA] hover:border-[#EF4444] hover:bg-[#FEF2F2]"
                      : "border-[#E2E8F0] hover:border-[#FD5302] hover:shadow-md"
                  }`}
                >
                  <span
                    className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                      isLogout ? "bg-[#FEF2F2] text-[#DC2626]" : "bg-[#FFF6F0] text-[#C2410C]"
                    }`}
                  >
                    <Icon />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[15px] font-extrabold ${isLogout ? "text-[#DC2626]" : "text-[#0F172A]"}`}>
                      {item.title}
                      {shortcuts.includes(item.id) && (
                        <span className="ml-2 align-middle px-1.5 py-0.5 rounded-md bg-[#FFF1E8] text-[#C2410C] text-[10.5px] font-extrabold">Shortcut</span>
                      )}
                    </p>
                    <p className="text-[12px] text-[#94A3B8] truncate mt-0.5">
                      {locked ? lockedNote(item) : lockedByPlan(item) ? item.lockedDesc : item.desc}
                    </p>
                  </div>
                  <span className="text-[#94A3B8] shrink-0">{locked ? <I.lock /> : <I.chevron />}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {pinFor && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center p-4" onClick={() => setPinFor(null)}>
          <div className="w-full max-w-[360px] bg-white rounded-2xl shadow-xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-extrabold text-[#0F172A]">{shortLabel(pinFor)}</p>
            <button
              type="button"
              onClick={() => {
                toggleShortcut(pinFor.id);
                setPinFor(null);
              }}
              className="w-full h-11 rounded-xl bg-[#FD5302] text-white text-[14px] font-bold hover:bg-[#D64502]"
            >
              {shortcuts.includes(pinFor.id) ? "Remove from Quick Shortcuts" : "Add as Quick Shortcut"}
            </button>
            <button
              type="button"
              onClick={() => setPinFor(null)}
              className="w-full h-11 rounded-xl border border-[#E2E8F0] text-[#334155] text-[14px] font-bold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
