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
  if (!isAdmin) return <Navigate to="/stores" replace state={{ deniedFrom: location.pathname }} />;
  return children;
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
          <Route path="/stores" element={<StoreSearch />} />
          <Route path="/stores/:storeId" element={<RestaurantDetail />} />
          {/* KKMDM, tablet management, inside CSD (owner, 2026-11-03). */}
          <Route path="/mdm/*" element={<KkmdmShell />} />
          <Route path="/search" element={<SearchConsole />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/:jobId" element={<JobDetail />} />
          <Route path="/hardware" element={<HardwareRequests />} />
          <Route path="/hardware/:requestId" element={<HardwareRequestDetail />} />
          {/* Staff moderate reviews; delist/relist is admin-only on the server. */}
          <Route path="/eats" element={<KnotEats />} />

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

const LandingRedirect = () => <Navigate to="/chat?tab=whatsapp" replace />;

export default App;
