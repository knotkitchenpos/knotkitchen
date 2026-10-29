import { useEffect, useState } from "react";
import { api, setUnauthorizedHandler } from "./api.js";
import { AuthContext, Login, can } from "./auth.jsx";
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

// Hash routes: #/devices/:id etc. Each nav entry names the permission it needs.
const NAV = [
  ["", "Dashboard", "devices.view", Home],
  ["devices", "Devices", "devices.view", Devices],
  ["stores", "Stores", "devices.view", Stores],
  ["groups", "Groups", "devices.view", Groups],
  ["apps", "Applications", "apps.view", Apps],
  ["policies", "Policies", "policies.view", Policies],
  ["enrollment", "Enrollment", "enrollment.manage", Enrollment],
  ["commands", "Remote Actions", "commands.view", Commands],
  ["alerts", "Alerts", "alerts.view", Alerts],
  ["audit", "Activity / Audit", "audit.view", Audit],
  ["settings", "Settings", "devices.view", Settings],
  ["admins", "Admin Users", "admins.manage", Admins],
];

function useHash() {
  const [hash, setHash] = useState(window.location.hash.slice(2));
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(2));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function go(path) {
  window.location.hash = `#/${path}`;
}

export default function App() {
  const [admin, setAdmin] = useState(undefined);
  const hash = useHash();

  useEffect(() => {
    setUnauthorizedHandler(() => setAdmin(null));
    api.get("/auth/me").then((r) => setAdmin(r.admin)).catch(() => setAdmin(null));
  }, []);

  if (admin === undefined) return null;
  if (!admin) return <Login onLogin={setAdmin} />;

  const [section, ...rest] = hash.split("?")[0].split("/");
  const entry = NAV.find(([k]) => k === section) || NAV[0];
  let Page = entry[3];
  if (section === "devices" && rest[0]) Page = DeviceDetail;
  const allowed = can(admin, entry[2]);

  const logout = async () => {
    await api.post("/auth/logout").catch(() => {});
    setAdmin(null);
  };

  return (
    <AuthContext.Provider value={{ admin, setAdmin }}>
      <div className="shell">
        <nav className="side">
          <div className="logo">KK<span>MDM</span></div>
          {NAV.filter(([, , perm]) => can(admin, perm)).map(([k, label]) => (
            <a key={k} href={`#/${k}`} className={entry[0] === k ? "on" : ""}>{label}</a>
          ))}
          <div className="who">
            {admin.email}
            <br />
            {admin.roleName}
            <br />
            <a href="#/" onClick={(e) => { e.preventDefault(); logout(); }} style={{ padding: "6px 0" }}>Sign out</a>
          </div>
        </nav>
        <main className="main">
          {allowed ? <Page params={rest} /> : <div className="card">You don&apos;t have access to this page.</div>}
        </main>
      </div>
    </AuthContext.Provider>
  );
}
