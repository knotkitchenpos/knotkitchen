import React, { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
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
import { MENU_ITEMS, shortLabel } from "../constants/settingsMenu";
import ManageCacheView from "../components/settings/ManageCacheView";
import StorePropertiesView from "../components/settings/StorePropertiesView";
import OrderTypesAutoReadyView from "../components/settings/OrderTypesAutoReadyView";
import TimingsHolidaysView from "../components/settings/TimingsHolidaysView";
import ManageStaffView from "../components/settings/ManageStaffView";
import RulesChargesView from "../components/settings/RulesChargesView";
import KnotEatsView from "../components/settings/KnotEatsView";

/** Which add-on unlocks a locked option (services/planFeatures on the server). */
const ADDON_FOR = { website: "Website", websiteHours: "Website" };

/** Anything that opens a screen can be pinned; Logout cannot. Help & Support is always in the side panel. */
const canPin = (item) => Boolean(item && (item.path || item.mode === "view") && item.id !== "support");

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

  // Plan and add-on features (services/planFeatures on the server, which also
  // enforces them): Manage Website needs the Website add-on, on any plan. On
  // the Billing plan, Manage Tables, Order Toggles and Knot Eats need the POS
  // plan, and Website Timing & Holidays the POS plan or the Website add-on.
  // Rules & Charges is open on every plan.
  const { data: subRes, isLoading: planLoading } = useQuery({ queryKey: ["subscription"], queryFn: getSubscriptionStatus });
  const features = subRes?.data?.data?.features;
  const lockedByPlan = (item) => Boolean(item.feature && features && features[item.feature] === false);
  // Locked tiles open Billing.
  const blockedByPlan = lockedByPlan;
  // On the Billing plan only an add-on's own screens open by buying it; the rest needs the POS plan.
  const lockedNote = (item) =>
    features?.pos === false && item.feature !== "website" && item.feature !== "websiteHours"
      ? "Not on the Billing plan. Tap to upgrade in Billing & Subscription."
      : `Needs the ${ADDON_FOR[item.feature] || "Website"} add-on. Tap to add it in Billing.`;

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

  // ?view= draws a sub-view here, or the lock of a locked option. An option with a
  // page of its own (?view=tables) opens that page; an unknown or hidden id
  // (shift/inventory while SHOW_LATER_FEATURES is off) is the plain list.
  const linked = MENU_ITEMS.find((m) => m.id === activeSubView);
  const activeMeta = linked && (linked.mode === "view" || blockedByPlan(linked)) ? linked : null;
  const view = activeMeta?.id;
  if (linked?.path && !activeMeta) return <Navigate to={linked.path} replace />;

  return (
    <div className="h-full w-full overflow-y-auto bg-[#F8FAFC]">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-7 py-4 sm:py-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-5 sm:mb-6">
          {activeMeta && (
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
            {activeMeta && <p className="text-[13.5px] text-[#94A3B8] mt-0.5">{activeMeta.desc}</p>}
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
        ) : activeMeta?.feature && planLoading ? (
          // A gated view waits for the plan, so a locked one never draws (or calls its APIs) first.
          <p className="text-[13.5px] text-[#94A3B8]">Loading…</p>
        ) : view === "cache" ? (
          <ManageCacheView />
        ) : view === "device" ? (
          <DeviceConfiguration />
        ) : view === "properties" ? (
          <StorePropertiesView />
        ) : view === "toggles" ? (
          <OrderTypesAutoReadyView />
        ) : view === "timings" ? (
          <TimingsHolidaysView />
        ) : view === "staff" ? (
          <ManageStaffView />
        ) : view === "rules" ? (
          <RulesChargesView />
        ) : view === "eats" ? (
          <KnotEatsView />
        ) : view === "shift" ? (
          <ShiftView />
        ) : view === "inventory" ? (
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
                      {locked ? lockedNote(item) : item.desc}
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
