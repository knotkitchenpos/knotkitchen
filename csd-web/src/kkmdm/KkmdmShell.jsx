import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FiAlertCircle } from "react-icons/fi";
import { api } from "./api.js";
import { AuthContext, can } from "./auth.jsx";
import { setNavigate } from "./nav.js";
import { MDM_MENU } from "./menu.js";
import "./kkmdm.css";
import Home from "./pages/Home.jsx";
import Devices from "./pages/Devices.jsx";
import DeviceDetail from "./pages/DeviceDetail.jsx";
import Stores from "./pages/Stores.jsx";
import Groups from "./pages/Groups.jsx";
import Apps from "./pages/Apps.jsx";
import Policies from "./pages/Policies.jsx";
import Enrollment from "./pages/Enrollment.jsx";
import Commands from "./pages/Commands.jsx";
import Alerts from "./pages/Alerts.jsx";
import Audit from "./pages/Audit.jsx";
import Settings from "./pages/Settings.jsx";
import Admins from "./pages/Admins.jsx";

const PAGES = { "": Home, devices: Devices, stores: Stores, groups: Groups, apps: Apps, policies: Policies, enrollment: Enrollment, commands: Commands, alerts: Alerts, audit: Audit, settings: Settings, admins: Admins };

/**
 * KKMDM (tablet management) inside CSD (owner, 2026-11-03), at /mdm/*.
 * Signs in to KKMDM through CSD on first use (./api.js), then shows the page
 * the address names, in CSD's theme (./kkmdm.css). Links inside the pages
 * stay in CSD (no full reload).
 */
const KkmdmShell = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [admin, setAdmin] = useState(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    setNavigate(navigate);
    return () => setNavigate(null);
  }, [navigate]);

  useEffect(() => {
    let alive = true;
    api.get("/auth/me")
      .then((r) => alive && setAdmin(r.admin))
      .catch((e) => alive && setError(
        e?.status === 401 || e?.code === "sso_invalid"
          ? "Could not sign in to KKMDM through CSD. Sign out of CSD and back in, then try again."
          : `KKMDM could not be reached (${e?.message || "network error"}).`,
      ));
    return () => { alive = false; };
  }, []);

  // A link to another KKMDM page goes through CSD's router.
  const keepInside = (e) => {
    const a = e.target.closest?.("a[href^='/mdm']");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
    e.preventDefault();
    navigate(a.getAttribute("href"));
  };

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{error}</span>
      </div>
    );
  }
  if (admin === undefined) return <p className="p-6 text-center text-sm text-navy-400">Opening device management…</p>;

  const [section = "", ...rest] = pathname.replace(/^\/mdm\/?/, "").split("/");
  const entry = MDM_MENU.find((m) => m.key === section) || MDM_MENU[0];
  const Page = section === "devices" && rest[0] ? DeviceDetail : PAGES[entry.key];
  const allowed = can(admin, entry.perm);

  return (
    <AuthContext.Provider value={{ admin, setAdmin }}>
      <div className="kkmdm" onClick={keepInside}>
        {allowed ? <Page params={rest} /> : <div className="card">You don&apos;t have access to this page.</div>}
      </div>
    </AuthContext.Provider>
  );
};

export default KkmdmShell;
