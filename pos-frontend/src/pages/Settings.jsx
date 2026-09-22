import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearActiveStoreId } from "../utils/storeSession";
import { useDispatch } from "react-redux";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getSubscriptionStatus, logout } from "../https";
import { removeUser } from "../redux/slices/userSlice";
import ActivityLogView from "../components/dashboard/ActivityLogView";
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

const MENU_ITEMS = [
  { id: "cache", title: "1. Manage Cache", desc: "Publish menu changes to the POS tills.", Icon: I.database, mode: "view" },
  { id: "device", title: "2. Device Configuration", desc: "Printer paper sizes, auto-print & e-bill settings.", Icon: I.printer, mode: "view" },
  { id: "properties", title: "3. Store Properties", desc: "Store details & protection PIN.", Icon: I.store, mode: "view" },
  { id: "menu", title: "4. Manage Menu", desc: "Categories, dishes, variants and add-ons.", Icon: I.utensils, path: "/manage-menu" },
  { id: "staff", title: "5. Manage Staff", desc: "Add/delete staff and PIN privileges.", Icon: I.users, mode: "view" },
  { id: "toggles", title: "6. Order Toggles & Auto-Ready", desc: "Channel ON/OFF & auto-ready durations.", Icon: I.toggle, mode: "view" },
  { id: "timings", title: "7. Website Timing & Holidays", desc: "Collection, delivery and table booking hours, Close for Today and holidays for the website.", Icon: I.calendar, mode: "view", feature: "website" },
  { id: "rules", title: "8. Rules, Charges & Promotions", desc: "Min orders, delivery slabs, GST, coupons, free items.", Icon: I.fileText, mode: "view" },
  { id: "reports", title: "9. Reports", desc: "Sales, revenue and order breakdowns.", Icon: I.chart, path: "/reports" },
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
  { id: "billing", title: "10. Billing & Subscription", desc: "Business Balance, plan, invoices and transactions.", Icon: I.fileText, path: "/settings/billing" },

  { id: "website", title: "11. Manage Website", desc: "Landing page, branding, colours, domain and payments.", Icon: I.globe, path: "/website", feature: "website" },

  // Activity Log stays CSD-only: it is the audit trail of who did what,
  // including support's own actions, and is locked server-side in
  // middlewares/csdOnly.js rather than merely hidden here.
  // Also in the side panel; listed here so it is one tap away on a phone.
  { id: "support", title: "12. Help & Support", desc: "Call or message KnotKitchen support.", Icon: I.headset, path: "/support" },
  { id: "logout", title: "13. Logout", desc: "Securely sign out of the POS system.", Icon: I.logout, action: "logout" },
];

const Settings = () => {
  useEffect(() => {
    document.title = "KnotKitchen | Settings";
  }, []);

  const [activeSubView, setActiveSubView] = useState(null);
  const navigate = useNavigate();
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

  // Plan features (services/planFeatures on the server, which also enforces
  // them): the website tiles are Growth and Scale only.
  const { data: subRes } = useQuery({ queryKey: ["subscription"], queryFn: getSubscriptionStatus });
  const features = subRes?.data?.data?.features;
  const lockedByPlan = (item) => Boolean(item.feature && features && features[item.feature] === false);

  const handleClick = (item) => {
    if (lockedByPlan(item)) {
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
          </div>
        </div>

        {/* Active sub-view or item list */}
        {activeSubView === "cache" ? (
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
        ) : activeSubView === "activity" ? (
          <ActivityLogView />
        ) : (

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {MENU_ITEMS.map((item) => {
              const Icon = item.Icon;
              const isLogout = item.action === "logout";
              const locked = lockedByPlan(item);
              return (
                <button
                  key={item.id}
                  onClick={() => handleClick(item)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center gap-4 bg-white ${
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
                    </p>
                    <p className="text-[12px] text-[#94A3B8] truncate mt-0.5">
                      {locked ? "Included in Growth and Scale. Tap to upgrade." : item.desc}
                    </p>
                  </div>
                  <span className="text-[#94A3B8] shrink-0">{locked ? <I.lock /> : <I.chevron />}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
