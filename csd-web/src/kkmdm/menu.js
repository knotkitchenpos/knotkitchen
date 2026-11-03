// KKMDM's screens in CSD's sidebar sub-menu (owner, 2026-11-03), at /mdm/<key>.
// Each names the KKMDM permission it needs; KKMDM checks it again on every call.
import {
  FiGrid, FiTablet, FiShoppingBag, FiLayers, FiPackage, FiShield, FiCamera,
  FiZap, FiBell, FiActivity, FiSettings, FiUsers,
} from "react-icons/fi";

export const MDM_MENU = [
  { key: "", label: "Overview", perm: "devices.view", icon: FiGrid },
  { key: "devices", label: "Devices", perm: "devices.view", icon: FiTablet },
  { key: "stores", label: "Stores", perm: "devices.view", icon: FiShoppingBag },
  { key: "groups", label: "Groups", perm: "devices.view", icon: FiLayers },
  { key: "apps", label: "Applications", perm: "apps.view", icon: FiPackage },
  { key: "policies", label: "Policies", perm: "policies.view", icon: FiShield },
  { key: "enrollment", label: "Enrollment", perm: "enrollment.manage", icon: FiCamera },
  { key: "commands", label: "Remote actions", perm: "commands.view", icon: FiZap },
  { key: "alerts", label: "Alerts", perm: "alerts.view", icon: FiBell },
  { key: "audit", label: "Activity / audit", perm: "audit.view", icon: FiActivity },
  { key: "settings", label: "Settings", perm: "devices.view", icon: FiSettings },
  { key: "admins", label: "KKMDM admins", perm: "admins.manage", icon: FiUsers },
];

// What a CSD account becomes in KKMDM (kkmdm/server/src/lib/csdSso.js): admins
// are Super Admins, staff are Support. Only for showing the menu; KKMDM decides.
const SUPPORT = ["devices.view", "stores.view", "policies.view", "apps.view", "alerts.view", "commands.view"];
export const menuFor = (isAdmin) => MDM_MENU.filter((m) => isAdmin || SUPPORT.includes(m.perm));
