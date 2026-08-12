import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
  Navigate,
} from "react-router-dom";
import { Home, Auth, Orders, Tables, Menu, Dashboard, KDS, OrderOnline, PaymentLink, TakeawayWebsite } from "./pages";
import Header from "./components/shared/Header";
import Sidebar from "./components/shared/Sidebar";
import { useState } from "react";
import { useSelector } from "react-redux";
import useLoadData from "./hooks/useLoadData";
import FullScreenLoader from "./components/shared/FullScreenLoader"
import MarketplaceOrderPopup from "./components/dashboard/MarketplaceOrderPopup"

function Layout() {
  const isLoading = useLoadData();
  const location = useLocation();
  const isTakeawayWebsite = location.pathname.startsWith("/store/");
  const hideHeaderRoutes = ["/auth", "/order", "/pay"];
  const shouldHideHeader = hideHeaderRoutes.includes(location.pathname) || isTakeawayWebsite;
  const { isAuth } = useSelector(state => state.user);
  const [mobileOpen, setMobileOpen] = useState(false);

  if(isLoading) return <FullScreenLoader />

  const routes = (
    <Routes>
      <Route
        path="/"
        element={
          <ProtectedRoutes>
            <Menu />
          </ProtectedRoutes>
        }
      />
      <Route path="/auth" element={isAuth ? <Navigate to="/" /> : <Auth />} />
      <Route
        path="/home"
        element={
          <ProtectedRoutes>
            <Home />
          </ProtectedRoutes>
        }
      />
      <Route
        path="/orders"
        element={
          <ProtectedRoutes>
            <Orders />
          </ProtectedRoutes>
        }
      />
      <Route
        path="/tables"
        element={
          <ProtectedRoutes>
            <Tables />
          </ProtectedRoutes>
        }
      />
      <Route
        path="/menu"
        element={
          <ProtectedRoutes>
            <Menu />
          </ProtectedRoutes>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoutes>
            <Dashboard />
          </ProtectedRoutes>
        }
      />
      <Route path="/kds" element={<ProtectedRoutes><KDS /></ProtectedRoutes>} />
      <Route path="/order" element={<OrderOnline />} />
      <Route path="/pay/:token" element={<PaymentLink />} />
      <Route path="/store/:storeId" element={<TakeawayWebsite />} />
      <Route path="*" element={<div>Not Found</div>} />
    </Routes>
  );

  return (
    <div className={`app-shell ${shouldHideHeader ? "" : "with-sidebar"}`}>
      {!shouldHideHeader ? (
        <>
          <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
          <div className="app-main">
            <Header onOpenMobile={() => setMobileOpen(true)} />
            <main>{routes}</main>
          </div>
        </>
      ) : (
        <main>{routes}</main>
      )}
      {isAuth && <MarketplaceOrderPopup />}
    </div>
  );
}

function ProtectedRoutes({ children }) {
  const { isAuth } = useSelector((state) => state.user);
  if (!isAuth) {
    return <Navigate to="/auth" />;
  }

  return children;
}

function App() {
  return (
    <Router>
      <Layout />
    </Router>
  );
}

export default App;
