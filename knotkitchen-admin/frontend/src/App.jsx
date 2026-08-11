import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Restaurants from "./pages/Restaurants";
import RestaurantDetail from "./pages/RestaurantDetail";
import Orders from "./pages/Orders";
import Users from "./pages/Users";
import Menus from "./pages/Menus";
import Tables from "./pages/Tables";

function Protected({ children }) {
  const { admin, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }
  if (!admin) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="restaurants" element={<Restaurants />} />
        <Route path="restaurants/:id" element={<RestaurantDetail />} />
        <Route path="orders" element={<Orders />} />
        <Route path="users" element={<Users />} />
        <Route path="menus" element={<Menus />} />
        <Route path="tables" element={<Tables />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}