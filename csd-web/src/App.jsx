import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import MfaSetup from "./pages/MfaSetup";
import Profile from "./pages/Profile";
import StoreSearch from "./pages/StoreSearch";
import RestaurantDetail from "./pages/RestaurantDetail";
import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import Agreements from "./pages/Agreements";
import SearchConsole from "./pages/SearchConsole";
import Jobs from "./pages/Jobs";
import JobDetail from "./pages/JobDetail";
import Chat from "./pages/Chat";
import StaffManagement from "./pages/StaffManagement";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Billing from "./pages/Billing";
import HardwareRequests from "./pages/HardwareRequests";
import HardwareRequestDetail from "./pages/HardwareRequestDetail";
import KnotEats from "./pages/KnotEats";
import KkmdmShell from "./kkmdm/KkmdmShell";
import StoreHealth from "./pages/StoreHealth";
import Knowledge from "./pages/Knowledge";

const Splash = () => (
  <div className="flex min-h-screen items-center justify-center bg-navy-950 text-navy-300">
    Loading…
  </div>
);

/** Any signed-in staff member. */
const RequireAuth = ({ children }) => {
  const { staff, loading } = useAuth();
  if (loading) return <Splash />;
  if (!staff) return <Login />;
  // Two-factor sign-in first (security audit, 2026-11-03); the server enforces it too.
  return staff.mfaEnabled ? children : <MfaSetup />;
};

/**
 * Admin-only route guard.
 *
 * This stops a staff member from *rendering* an admin page by typing its URL.
 * It is the second of two layers and the weaker one — the server's
 * requireCsdAdmin is what actually protects the data, since anyone can edit
 * client-side state. Both exist so the user gets a clean redirect rather than
 * a page that renders and then fails every API call.
 */
const RequireAdmin = ({ children }) => {
  const { staff, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!staff) return <Login />;
  if (!staff.mfaEnabled) return <MfaSetup />;
  if (!isAdmin) return <Navigate to="/" replace state={{ deniedFrom: location.pathname }} />;
  return children;
};

/** A section this staff member may have been limited away from. */
const RequireSection = ({ section, children }) => {
  const { can } = useAuth();
  return can(section) ? children : <Navigate to="/" replace />;
};

const App = () => (
  <AuthProvider>
    <BrowserRouter>
      <Routes>
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          {/* Shared — staff and admin */}
          <Route path="/profile" element={<Profile />} />
          <Route path="/stores" element={<RequireSection section="stores"><StoreSearch /></RequireSection>} />
          <Route path="/stores/:storeId" element={<RequireSection section="stores"><RestaurantDetail /></RequireSection>} />
          <Route path="/health" element={<RequireSection section="health"><StoreHealth /></RequireSection>} />
          <Route path="/knowledge" element={<RequireSection section="knowledge"><Knowledge /></RequireSection>} />
          {/* KKMDM, tablet management, inside CSD (owner, 2026-11-03). */}
          <Route path="/mdm/*" element={<RequireSection section="devices"><KkmdmShell /></RequireSection>} />
          <Route path="/search" element={<RequireSection section="search"><SearchConsole /></RequireSection>} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/jobs" element={<RequireSection section="jobs"><Jobs /></RequireSection>} />
          <Route path="/jobs/:jobId" element={<RequireSection section="jobs"><JobDetail /></RequireSection>} />
          <Route path="/hardware" element={<RequireSection section="hardware"><HardwareRequests /></RequireSection>} />
          <Route path="/hardware/:requestId" element={<RequireSection section="hardware"><HardwareRequestDetail /></RequireSection>} />
          {/* Staff moderate reviews; delist/relist is admin-only on the server. */}
          <Route path="/eats" element={<RequireSection section="eats"><KnotEats /></RequireSection>} />

          {/* Admin only */}
          <Route
            path="/dashboard"
            element={<RequireAdmin><Dashboard /></RequireAdmin>}
          />
          <Route
            path="/onboarding"
            element={<RequireAdmin><Onboarding /></RequireAdmin>}
          />
          <Route
            path="/agreements"
            element={<RequireAdmin><Agreements /></RequireAdmin>}
          />
          <Route
            path="/staff"
            element={<RequireAdmin><StaffManagement /></RequireAdmin>}
          />
          <Route
            path="/reports"
            element={<RequireAdmin><Reports /></RequireAdmin>}
          />
          <Route
            path="/settings"
            element={<RequireAdmin><Settings /></RequireAdmin>}
          />
          <Route
            path="/billing"
            element={<RequireAdmin><Billing /></RequireAdmin>}
          />

          {/* Everyone lands on the WhatsApp inbox (owner, 2026-11-11): customers are waiting there. */}
          <Route path="/" element={<LandingRedirect />} />
          <Route path="*" element={<LandingRedirect />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </AuthProvider>
);

/** The WhatsApp inbox, or the first section this person has. */
const LANDING = [["whatsapp", "/chat?tab=whatsapp"], ["chat", "/chat"], ["stores", "/stores"], ["health", "/health"], ["jobs", "/jobs"], ["search", "/search"], ["hardware", "/hardware"], ["eats", "/eats"], ["knowledge", "/knowledge"], ["devices", "/mdm"]];
const LandingRedirect = () => {
  const { can } = useAuth();
  const first = LANDING.find(([section]) => can(section));
  return <Navigate to={first ? first[1] : "/profile"} replace />;
};

export default App;
