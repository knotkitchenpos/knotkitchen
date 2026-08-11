import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiFilter, FiSearch, FiClipboard } from "react-icons/fi";
import OrderCard from "../components/orders/OrderCard";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getOrders } from "../https/index";
import { enqueueSnackbar } from "notistack";

const tabs = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "progress", label: "In Progress" },
  { key: "ready", label: "Ready" },
  { key: "completed", label: "Completed" },
];

const Orders = () => {
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterPayment, setFilterPayment] = useState("all");
  const [filterTable, setFilterTable] = useState("all");

  useEffect(() => {
    document.title = "KnotKitchen | Orders";
  }, []);

  const { data: resData, isError } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => await getOrders(),
    placeholderData: keepPreviousData,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  if (isError) {
    enqueueSnackbar("Something went wrong!", { variant: "error" });
  }

  const filtered = (resData?.data?.data || []).filter((order) => {
    const matchesStatus =
      status === "all" ||
      (status === "pending" && order.orderStatus === "Pending") ||
      (status === "progress" && order.orderStatus === "In Progress") ||
      (status === "ready" && order.orderStatus === "Ready") ||
      (status === "completed" && order.orderStatus === "Completed");
    const matchesSearch = (order.customerDetails?.name || 'Guest')
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesPayment =
      filterPayment === "all" || order.paymentMethod === filterPayment;
    const matchesTable =
      filterTable === "all" || String(order.table?.tableNo) === filterTable;
    return matchesStatus && matchesSearch && matchesPayment && matchesTable;
  });

  const toggleFilter = () => setIsFilterOpen(!isFilterOpen);

  const clearFilters = () => {
    setFilterPayment("all");
    setFilterTable("all");
    setStatus("all");
    setSearch("");
  };

  const tableNumbers = resData?.data?.data
    ? [...new Set(resData.data.data.map((o) => String(o.table?.tableNo)))]
    : [];

  return (
    <div className="flex-1 min-h-0 bg-surface overflow-y-auto no-scrollbar">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col min-h-full">
        {/* Header */}
        <div className="mt-6">
          <h1 className="font-display text-2xl font-bold">Orders</h1>
          <p className="text-content-muted text-sm">Manage and track all orders</p>
        </div>

        {/* Search + Filter */}
        <div className="flex flex-col sm:flex-row gap-4 mt-6">
          <div className="flex-1 flex items-center gap-3 bg-surface-input rounded-xl px-4 py-3 border border-border focus-within:border-accent transition-all">
            <FiSearch className="text-content-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer name..."
              className="bg-transparent outline-none text-sm w-full text-content placeholder:text-content-muted"
            />
          </div>
          <button
            onClick={toggleFilter}
            className={`btn-secondary flex items-center justify-center gap-2 !py-3 ${
              isFilterOpen ? "!bg-accent !text-white border-accent" : ""
            }`}
          >
            <FiFilter /> Filters
          </button>
        </div>

        {/* Filter Panel */}
        <AnimatePresence>
          {isFilterOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -10 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="mb-6 mt-4 bg-surface-secondary rounded-xl border border-border p-4 overflow-hidden"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Filter Orders</h3>
                <button
                  onClick={clearFilters}
                  className="text-xs text-accent hover:underline font-semibold"
                >
                  Clear All
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-content-muted mb-1">
                    Payment Method
                  </label>
                  <select
                    value={filterPayment}
                    onChange={(e) => setFilterPayment(e.target.value)}
                    className="w-full bg-surface-input border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
                  >
                    <option value="all">All Payment Methods</option>
                    <option value="Cash">Cash</option>
                    <option value="Online">Online</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-content-muted mb-1">
                    Table Number
                  </label>
                  <select
                    value={filterTable}
                    onChange={(e) => setFilterTable(e.target.value)}
                    className="w-full bg-surface-input border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
                  >
                    <option value="all">All Tables</option>
                    {tableNumbers.map((t) => (
                      <option key={t} value={t}>
                        Table {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide mt-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatus(tab.key)}
              className={`menu-category-pill ${
                status === tab.key ? "active" : ""
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Orders Grid */}
        <div className="mt-6">
          {filtered?.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <AnimatePresence>
                {filtered.map((order) => (
                  <motion.div
                    key={order._id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                  >
                    <OrderCard order={order} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="w-16 h-16 mx-auto bg-surface-tertiary rounded-2xl flex items-center justify-center mb-4">
                <FiClipboard size={28} className="text-content-muted" />
              </div>
              <p className="text-content-muted font-semibold">No orders found</p>
              <p className="text-content-muted text-sm mt-1">Try adjusting your search or filters</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Orders;