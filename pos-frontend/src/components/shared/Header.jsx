import React, { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiSearch, FiBell, FiLogOut, FiSun, FiMoon, FiMonitor,
  FiMenu, FiX, FiClock, FiInfo, FiClipboard, FiGrid, FiCoffee,
  FiCheckCircle, FiUser, FiPhone
} from "react-icons/fi";
import logo from "../../assets/images/logo.png";
import { useDispatch, useSelector } from "react-redux";
import { useMutation, useQuery } from "@tanstack/react-query";
import { logout, getOrders, getTables, getMenus } from "../../https";
import { removeUser } from "../../redux/slices/userSlice";
import { useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "../../hooks/useTheme";

const themeOptions = [
  { value: "light", label: "Light", icon: <FiSun size={16} /> },
  { value: "dark", label: "Dark", icon: <FiMoon size={16} /> },
  { value: "system", label: "System", icon: <FiMonitor size={16} /> },
];

const Header = ({ onOpenMobile }) => {
  const userData = useSelector((s) => s.user);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, setTheme } = useTheme();
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const themeRef = useRef(null);
  const notificationRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    const close = (e) => themeRef.current && !themeRef.current.contains(e.target) && setIsThemeOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    const close = (e) => notificationRef.current && !notificationRef.current.contains(e.target) && setIsNotificationOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    const close = (e) => searchRef.current && !searchRef.current.contains(e.target) && setIsSearchOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const { data: ordersRes } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => await getOrders(),
  });

  const { data: tablesRes } = useQuery({
    queryKey: ["tables"],
    queryFn: async () => await getTables(),
  });

  const { data: menusRes } = useQuery({
    queryKey: ["menus"],
    queryFn: async () => await getMenus(),
  });

  const menus = menusRes?.data?.data || [];

  useEffect(() => {
    const orders = ordersRes?.data?.data || [];
    const tables = tablesRes?.data?.data || [];
    const built = [];

    orders.slice(0, 5).forEach((o) => {
      const name = o.customerDetails?.name || "Customer";
      const tableNo = o.table?.tableNo ? `Table ${o.table.tableNo} ` : "";
      built.push({
        id: `order-${o._id}`,
        title: "New Order Placed",
        message: tableNo
          ? `${tableNo}placed an order worth ₹${o.bills?.totalWithTax || 0}`
          : `${name} placed an order worth ₹${o.bills?.totalWithTax || 0}`,
        time: new Date(o.createdAt).toLocaleString(),
        type: "order",
        read: false,
      });
      if (o.orderStatus === "Ready") {
        built.push({
          id: `ready-${o._id}`,
          title: "Order Ready",
          message: `${name}'s order is ready`,
          time: new Date(o.createdAt).toLocaleString(),
          type: "ready",
          read: false,
        });
      }
    });

    tables
      .filter((t) => t.status === "Booked")
      .slice(0, 3)
      .forEach((t) => {
        built.push({
          id: `table-${t._id}`,
          title: "Table Booked",
          message: `Table ${t.tableNo} has been booked`,
          time: "Recently",
          type: "table",
          read: false,
        });
      });

    setNotifications(built);
  }, [ordersRes, tablesRes]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case "order":
        return <FiClock className="text-accent" />;
      case "ready":
        return <FiCheckCircle className="text-accent-green" />;
      default:
        return <FiInfo className="text-content-muted" />;
    }
  };

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: () => { dispatch(removeUser()); navigate("/auth"); },
  });

  const currentThemeLabel = themeOptions.find((t) => t.value === mode)?.label || "System";

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return { orders: [], tables: [], dishes: [] };

    const orders = (ordersRes?.data?.data || [])
      .filter((o) =>
        o.customerDetails?.name?.toLowerCase().includes(q) ||
        o.customerDetails?.phone?.toLowerCase().includes(q) ||
        String(o.table?.tableNo || "").includes(q) ||
        o.orderStatus?.toLowerCase().includes(q)
      )
      .slice(0, 5);

    const tables = (tablesRes?.data?.data || [])
      .filter((t) =>
        String(t.tableNo || "").toLowerCase() === q ||
        `table ${String(t.tableNo || "")}`.includes(q) ||
        t.status?.toLowerCase().includes(q) ||
        t.currentOrder?.customerDetails?.name?.toLowerCase().includes(q)
      )
      .slice(0, 5);

    const dishes = [];
    menus.forEach((menu) => {
      (menu.items || []).forEach((item) => {
        if (item.name.toLowerCase().includes(q)) {
          dishes.push({ ...item, category: menu.name, categoryId: menu._id });
        }
      });
    });

    return { orders: orders.slice(0, 3), tables: tables.slice(0, 3), dishes: dishes.slice(0, 5) };
  }, [search, ordersRes, tablesRes, menus]);

  const hasResults =
    searchResults.orders.length > 0 ||
    searchResults.tables.length > 0 ||
    searchResults.dishes.length > 0;

  const handleSearchSelect = (type, data) => {
    setSearch("");
    setIsSearchOpen(false);
    if (type === "order") {
      navigate("/orders");
    } else if (type === "table") {
      navigate("/tables");
    } else if (type === "dish") {
      navigate("/menu", { state: { selectedCategoryId: data.categoryId } });
    }
  };

  const isActive = (path) => {
    // "/" and "/menu" both render the Menu page
    if (path === "/menu") return location.pathname === "/menu" || location.pathname === "/";
    return location.pathname === path;
  };

  const SearchDropdown = () => (
    <AnimatePresence>
      {isSearchOpen && search.trim() && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="absolute left-0 right-0 mt-2 glass rounded-xl shadow-lg border border-border overflow-hidden z-[100]"
        >
          {hasResults ? (
            <div className="max-h-96 overflow-y-auto scrollbar-hide">
              {searchResults.orders.length > 0 && (
                <div className="py-2">
                  <p className="px-4 py-1 text-[11px] font-bold text-content-muted uppercase tracking-wider flex items-center gap-1.5">
                    <FiClipboard size={12} /> Orders ({searchResults.orders.length})
                  </p>
                  {searchResults.orders.map((o) => (
                    <button
                      key={o._id}
                      onClick={() => handleSearchSelect("order", o)}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-tertiary transition-colors text-left"
                    >
                      <span className="text-sm font-semibold">{o.customerDetails?.name}</span>
                      <span className="text-xs text-content-muted">
                        Table {o.table?.tableNo || "—"} • {o.orderStatus}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {searchResults.tables.length > 0 && (
                <div className="py-2 border-t border-border">
                  <p className="px-4 py-1 text-[11px] font-bold text-content-muted uppercase tracking-wider flex items-center gap-1.5">
                    <FiGrid size={12} /> Tables ({searchResults.tables.length})
                  </p>
                  {searchResults.tables.map((t) => (
                    <button
                      key={t._id}
                      onClick={() => handleSearchSelect("table", t)}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-tertiary transition-colors text-left"
                    >
                      <span className="text-sm font-semibold">Table {t.tableNo}</span>
                      <span className="text-xs text-content-muted">
                        {t.status} • {t.seats} seats
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {searchResults.dishes.length > 0 && (
                <div className="py-2 border-t border-border">
                  <p className="px-4 py-1 text-[11px] font-bold text-content-muted uppercase tracking-wider flex items-center gap-1.5">
                    <FiCoffee size={12} /> Dishes ({searchResults.dishes.length})
                  </p>
                  {searchResults.dishes.map((d) => (
                    <button
                      key={`${d.categoryId}-${d._id}`}
                      onClick={() => handleSearchSelect("dish", d)}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-tertiary transition-colors text-left"
                    >
                      <span className="text-sm font-semibold">{d.name}</span>
                      <span className="text-xs text-content-muted">
                        {d.category} • ₹{d.price}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-content-muted">
              <p className="text-3xl mb-2">No results found</p>
              No results for "{search}"
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <header className="flex-shrink-0 z-50 glass border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={() => navigate("/")}
            className="flex items-center gap-3 cursor-pointer"
          >
            <img src={logo} className="h-9 w-9 rounded-xl" alt="KnotKitchen logo" />
            <span className="font-display text-xl font-bold tracking-tight hidden sm:block">Knot<span className="text-accent">Kitchen</span></span>
            {/* Mobile toggle */}
            <button
              onClick={onOpenMobile}
              className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-surface-tertiary text-content-muted"
            >
              <FiMenu size={20} />
            </button>
          </motion.div>

          {/* Search - Desktop */}
          <div className="hidden md:block relative w-64 xl:w-80" ref={searchRef}>
            <div className="flex items-center gap-3 bg-surface-input rounded-xl px-4 py-2.5 border border-border focus-within:border-accent transition-all">
              <FiSearch className="text-content-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setIsSearchOpen(true); }}
                onFocus={() => setIsSearchOpen(true)}
                placeholder="Search..."
                className="bg-transparent outline-none text-sm w-full"
              />
              {search && (
                <button
                  onClick={() => { setSearch(""); setIsSearchOpen(false); }}
                  className="text-content-muted hover:text-accent-red transition-colors"
                >
                  <FiX size={16} />
                </button>
              )}
            </div>
            <SearchDropdown />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Theme */}
            <div className="relative hidden sm:block" ref={themeRef}>
              <button
                onClick={() => setIsThemeOpen((p) => !p)}
                className="p-2.5 rounded-xl bg-surface-input border border-border hover:border-accent transition-colors text-content-secondary"
              >
                {mode === "light" ? <FiSun size={18} /> : mode === "dark" ? <FiMoon size={18} /> : <FiMonitor size={18} />}
              </button>
              <AnimatePresence>
                {isThemeOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -10 }}
                    className="absolute right-0 mt-2 w-44 glass rounded-xl shadow-lg border border-border overflow-hidden z-50"
                  >
                    {themeOptions.map((o) => (
                      <button
                        key={o.value}
                        onClick={() => { setTheme(o.value); setIsThemeOpen(false); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                          mode === o.value ? "bg-accent text-white" : "hover:bg-surface-tertiary"
                        }`}
                      >
                        {o.icon} {o.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Notifications */}
            <div className="relative hidden sm:block" ref={notificationRef}>
              <button
                onClick={() => setIsNotificationOpen((p) => !p)}
                className="p-2.5 rounded-xl bg-surface-input border border-border relative hover:border-accent transition-colors text-content-secondary"
              >
                <FiBell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-accent-red rounded-full text-[8px] text-white flex items-center justify-center font-bold">
                    {unreadCount}
                  </span>
                )}
              </button>
              <AnimatePresence>
                {isNotificationOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -10 }}
                    className="absolute right-0 mt-2 w-80 glass rounded-xl shadow-lg border border-border overflow-hidden z-50"
                  >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <h3 className="font-semibold text-sm">Notifications</h3>
                      <button
                        onClick={markAllAsRead}
                        className="text-xs text-accent hover:underline font-semibold"
                      >
                        Mark all as read
                      </button>
                    </div>
                    <div className="max-h-72 overflow-y-auto scrollbar-hide">
                      {notifications.map((n) => (
                        <div
                          key={n.id}
                          className={`flex items-start gap-3 px-4 py-3 hover:bg-surface-tertiary transition-colors ${
                            !n.read ? "bg-accent/5" : ""
                          }`}
                        >
                          <div className="mt-0.5">{getNotificationIcon(n.type)}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-semibold">{n.title}</p>
                              {!n.read && (
                                <span className="w-2 h-2 bg-accent-blue rounded-full flex-shrink-0" />
                              )}
                            </div>
                            <p className="text-xs text-content-muted truncate">{n.message}</p>
                            <p className="text-[10px] text-content-muted mt-0.5">{n.time}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* User - Desktop */}
            <div className="hidden md:flex items-center gap-3 pl-3 border-l border-border">
              <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white font-bold text-sm">
                {userData.name?.[0]?.toUpperCase() || "U"}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold leading-tight">{userData.name || "User"}</span>
                <span className="text-[11px] text-content-muted">{userData.role || "Role"}</span>
              </div>
              <button
                onClick={() => logoutMutation.mutate()}
                className="p-2 rounded-lg text-content-muted hover:text-accent-red transition-colors ml-1"
                title="Logout"
              >
                <FiLogOut size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>

    </header>
  );
};

export default Header;