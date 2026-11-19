// The Settings list, also read by the side panel for pinned shortcuts. Kept
// out of pages/Settings.jsx so the shell does not pull that page into the
// first download.
import { I } from "../components/settings/icons";

const SHOW_LATER_FEATURES = false;

export const MENU_ITEMS = [
  { id: "cache", title: "1. Manage Cache", Icon: I.database, mode: "view" },
  { id: "device", title: "2. Device Configuration", Icon: I.printer, mode: "view" },
  { id: "properties", title: "3. Store Properties", Icon: I.store, mode: "view" },
  { id: "menu", title: "4. Manage Menu", Icon: I.utensils, path: "/manage-menu" },
  // Sales use up each product's recipe (set in Manage Menu); the POS alerts when an item needs restocking.
  { id: "inventory", title: "5. Inventory Management", Icon: I.boxes, mode: "view", feature: "pos" },
  // Moved here from the side panel; pin it back with a long-press (Quick Shortcuts).
  { id: "tables", title: "6. Manage Tables", Icon: I.tables, path: "/tables", feature: "tableQr" },
  { id: "staff", title: "7. Manage Staff", Icon: I.users, mode: "view" },
  { id: "toggles", title: "8. Order Toggles & Auto-Ready", Icon: I.toggle, mode: "view", feature: "pos" },
  // Also the table QR's and Knot Eats' hours. Open on the POS plan; on the Billing plan the Website add-on opens it.
  { id: "timings", title: "9. Website Timing & Holidays", Icon: I.calendar, mode: "view", feature: "websiteHours" },
  // Open on every plan: a billing-only store sets its own GST and charges here.
  { id: "rules", title: "10. Rules, Charges & Promotions", Icon: I.fileText, mode: "view" },
  { id: "reports", title: "11. Reports", Icon: I.chart, path: "/reports" },
  // Shift & Day End is built (ShiftView) but hidden until the user wants it
  // on. Flip SHOW_LATER_FEATURES to list it.
  ...(SHOW_LATER_FEATURES
    ? [
        { id: "shift", title: "Shift & Day End", Icon: I.cash, mode: "view", feature: "pos" },
      ]
    : []),
  // Reachable even when the account is locked -- it is the only screen that
  // can clear a lock, so it must never be gated. See middlewares/accountLock.js.
  // Moved to the owner's Partners dashboard (knotkitchen.com/partners); this opens the page that says so.
  { id: "billing", title: "12. Billing & Subscription", Icon: I.fileText, path: "/settings/billing" },

  { id: "website", title: "13. Manage Website", Icon: I.globe, path: "/website", feature: "website" },
  { id: "eats", title: "14. Knot Eats", Icon: I.store, mode: "view", feature: "pos" },
  // The store's own riders, in the KnotKitchen Rider app (knotkitchen.com/rider).
  { id: "riders", title: "15. Delivery Riders", Icon: I.bike, mode: "view", feature: "pos" },

  // Activity Log stays CSD-only: it is the audit trail of who did what,
  // including support's own actions, and has no POS route at all (CSD reads
  // it through /api/csd).
  // Also in the side panel; listed here so it is one tap away on a phone.
  { id: "support", title: "16. Help & Support", Icon: I.headset, path: "/support" },
  { id: "logout", title: "17. Logout", Icon: I.logout, action: "logout" },
];

/** "5. Manage Tables" -> "Manage Tables". */
export const shortLabel = (item) => String(item?.title || "").replace(/^\d+\.\s*/, "");

/** Where a pinned option goes when tapped in the side panel. */
export const shortcutPath = (item) => (item.path ? item.path : `/settings?view=${item.id}`);
