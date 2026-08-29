import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import StoreSearch from "./pages/StoreSearch";
import StoreDetail from "./pages/StoreDetail";
import Placeholder from "./pages/Placeholder";
import Dashboard from "./pages/Dashboard";
import Onboarding from "./pages/Onboarding";
import SearchConsole from "./pages/SearchConsole";
import Jobs from "./pages/Jobs";
import JobDetail from "./pages/JobDetail";

const Splash = () => (
  <div className="flex min-h-screen items-center justify-center bg-navy-950 text-navy-300">
    Loading…
  </div>
);

/** Any signed-in staff member. */
const RequireAuth = ({ children }) => {
  const { staff, loading } = useAuth();
  if (loading) return <Splash />;
  return staff ? children : <Login />;
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
          <Route path="/stores/:storeId" element={<StoreDetail />} />
          <Route path="/search" element={<SearchConsole />} />
          <Route path="/chat" element={<Placeholder title="Chat" phase={4} />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/:jobId" element={<JobDetail />} />

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
            path="/staff"
            element={<RequireAdmin><Placeholder title="Staff Management" phase={4} /></RequireAdmin>}
          />
          <Route
            path="/reports"
            element={<RequireAdmin><Placeholder title="Reports" phase={4} /></RequireAdmin>}
          />
          <Route
            path="/settings"
            element={<RequireAdmin><Placeholder title="Settings" phase={4} /></RequireAdmin>}
          />

          {/* Admins land on the dashboard, staff on store search. */}
          <Route path="/" element={<LandingRedirect />} />
          <Route path="*" element={<LandingRedirect />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </AuthProvider>
);

const LandingRedirect = () => {
  const { isAdmin } = useAuth();
  return <Navigate to={isAdmin ? "/dashboard" : "/stores"} replace />;
};

export default App;
