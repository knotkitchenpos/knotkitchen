// The Settings list, also read by the side panel for pinned shortcuts. Kept
// out of pages/Settings.jsx so the shell does not pull that page into the
// first download.
import { I } from "../components/settings/icons";

const SHOW_LATER_FEATURES = false;

export const MENU_ITEMS = [
  { id: "cache", title: "1. Manage Cache", desc: "Publish menu changes to the POS tills, website and Knot Eats.", Icon: I.database, mode: "view" },
  { id: "device", title: "2. Device Configuration", desc: "Printer paper sizes, auto-print & e-bill settings.", Icon: I.printer, mode: "view" },
  { id: "properties", title: "3. Store Properties", desc: "Store details, payment gateway & protection PIN.", Icon: I.store, mode: "view" },
  { id: "menu", title: "4. Manage Menu", desc: "Categories, dishes, variants and add-ons.", Icon: I.utensils, path: "/manage-menu" },
  // Moved here from the side panel; pin it back with a long-press (Quick Shortcuts).
  { id: "tables", title: "5. Manage Tables", desc: "Tables, areas and table QR codes.", Icon: I.tables, path: "/tables", feature: "tableQr" },
  { id: "staff", title: "6. Manage Staff", desc: "Add/delete staff and PIN privileges.", Icon: I.users, mode: "view" },
  { id: "toggles", title: "7. Order Toggles & Auto-Ready", desc: "Channel ON/OFF & auto-ready durations.", Icon: I.toggle, mode: "view", feature: "onlineOrdering" },
  // Also the table QR's hours (Restaurant Time), so QR Table Ordering opens it too.
  { id: "timings", title: "8. Website Timing & Holidays", desc: "Collection, delivery and table hours, Close for Today and holidays for the website and table QR.", Icon: I.calendar, mode: "view", feature: "onlineOrdering" },
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
  { id: "billing", title: "11. Billing & Subscription", desc: "Wallet, POS plan, add-ons, tablets, printers, their delivery and invoices.", Icon: I.fileText, path: "/settings/billing" },

  { id: "website", title: "12. Manage Website", desc: "Landing page, branding, colours and domain.", Icon: I.globe, path: "/website", feature: "website" },
  { id: "eats", title: "13. Knot Eats", desc: "List your restaurant on eats.knotkitchen.com.", Icon: I.store, mode: "view" },

  // Activity Log stays CSD-only: it is the audit trail of who did what,
  // including support's own actions, and has no POS route at all (CSD reads
  // it through /api/csd).
  // Also in the side panel; listed here so it is one tap away on a phone.
  { id: "support", title: "14. Help & Support", desc: "Call or message KnotKitchen support.", Icon: I.headset, path: "/support" },
  { id: "logout", title: "15. Logout", desc: "Securely sign out of the POS system.", Icon: I.logout, action: "logout" },
];

/** "5. Manage Tables" -> "Manage Tables". */
export const shortLabel = (item) => String(item?.title || "").replace(/^\d+\.\s*/, "");

/** Where a pinned option goes when tapped in the side panel. */
export const shortcutPath = (item) => (item.path ? item.path : `/settings?view=${item.id}`);
