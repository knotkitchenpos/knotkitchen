import React, { useState, useRef, useEffect, useMemo } from "react";
import { FiCheck } from "react-icons/fi";
import { useQuery } from "@tanstack/react-query";
import { getOrders, getMenus } from "../../https";
import { isPreparing } from "../../constants/orderStatus";

const dateRanges = [
  { label: "Today", days: 1 },
  { label: "Last 7 Days", days: 7 },
  { label: "Last 1 Month", days: 30 },
  { label: "Last 3 Months", days: 90 },
  { label: "Last 6 Months", days: 180 },
  { label: "Last 1 Year", days: 365 },
];

const Metrics = () => {
  const [selectedRange, setSelectedRange] = useState("Last 1 Month");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const { data: ordersRes } = useQuery({
    queryKey: ["orders"],
    queryFn: getOrders,
  });
  const { data: menusRes } = useQuery({
    queryKey: ["menus"],
    queryFn: getMenus,
  });

  const orders = ordersRes?.data?.data || [];
  const menus = menusRes?.data?.data || [];

  useEffect(() => {
    const close = (e) =>
      dropdownRef.current &&
      !dropdownRef.current.contains(e.target) &&
      setIsDropdownOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const selectedDays = dateRanges.find((r) => r.label === selectedRange)?.days || 30;

  const metricsData = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - selectedDays);

    const rangedOrders = orders.filter((o) => new Date(o.createdAt || o.orderDate) >= cutoff);

    const totalOrders = rangedOrders.length;
    const totalRevenue = rangedOrders.reduce(
      (sum, o) => sum + (o.bills?.totalWithTax || 0),
      0
    );
    const activeOrders = rangedOrders.filter(
      (o) => isPreparing(o.orderStatus)
    ).length;
    const totalItems = menus.reduce((sum, m) => sum + (m.items?.length || 0), 0);

    return [
      {
        title: "Total Orders",
        value: totalOrders,
        percentage: "Real",
        isIncrease: true,
        color: "#3b82f6",
      },
      {
        title: "Total Revenue",
        value: `₹${totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
        percentage: "Real",
        isIncrease: totalRevenue >= 0,
        color: "#10b981",
      },
      {
        title: "Active Orders",
        value: activeOrders,
        percentage: "Real",
        isIncrease: true,
        color: "#f59e0b",
      },
      {
        title: "Menu Items",
        value: totalItems,
        percentage: "Real",
        isIncrease: true,
        color: "#8b5cf6",
      },
    ];
  }, [orders, menus, selectedDays]);

  const itemsData = useMemo(() => {
    const totalDishes = menus.reduce((sum, m) => sum + (m.items?.length || 0), 0);

    return [
      {
        title: "Categories",
        value: menus.length,
        percentage: "Real",
        color: "#ec4899",
      },
      {
        title: "Dishes",
        value: totalDishes,
        percentage: "Real",
        color: "#14b8a6",
      },
      {
        title: "Tables",
        value: "—",
        percentage: "—",
        color: "#6366f1",
      },
      {
        title: "Total Revenue",
        value: `₹${orders.reduce((s, o) => s + (o.bills?.totalWithTax || 0), 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
        percentage: "Real",
        color: "#f43f5e",
      },
    ];
  }, [menus, orders]);

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white px-1">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="font-semibold text-content text-xl font-display">
            Overall Performance
          </h2>
          <p className="text-sm text-content-muted">
            Real-time metrics from your orders and menu.
          </p>
        </div>
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-1 px-4 py-2 rounded-xl text-[#0F172A] bg-white border border-[#E2E8F0] hover:border-[#5B42F3] transition-colors"
          >
            {selectedRange}
            <svg
              className={`w-3 h-3 transition-transform ${
                isDropdownOpen ? "rotate-180" : ""
              }`}
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="4"
            >
              <path d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {isDropdownOpen && (
            <div className="absolute right-0 mt-2 w-48 rounded-xl bg-white border border-[#CBD5E1] shadow-[0_12px_30px_rgba(15,23,42,0.16)] overflow-hidden z-[120]">
              {dateRanges.map((range) => (
                <button
                  key={range.days}
                  onClick={() => {
                    setSelectedRange(range.label);
                    setIsDropdownOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium bg-white hover:bg-[#F8FAFC] transition-colors ${
                    selectedRange === range.label
                      ? "text-[#5B42F3]"
                      : "text-[#334155]"
                  }`}
                >
                  {range.label}
                  {selectedRange === range.label && <FiCheck size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {metricsData.map((metric, index) => {
          return (
            <div
              key={index}
              className="shadow-sm rounded-lg p-4"
              style={{ backgroundColor: metric.color }}
            >
              <div className="flex justify-between items-center">
                <p className="font-medium text-xs text-white">
                  {metric.title}
                </p>
                <div className="flex items-center gap-1">
                  <svg
                    className="w-3 h-3"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                    style={{ color: metric.isIncrease ? "#f5f5f5" : "red" }}
                  >
                    <path
                      d={metric.isIncrease ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"}
                    />
                  </svg>
                  <p
                    className="font-medium text-xs"
                    style={{ color: metric.isIncrease ? "#f5f5f5" : "red" }}
                  >
                    {metric.percentage}
                  </p>
                </div>
              </div>
              <p className="mt-1 font-semibold text-2xl text-white">
                {metric.value}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col justify-between mt-12">
        <div>
          <h2 className="font-semibold text-content text-xl font-display">
            Item Details
          </h2>
          <p className="text-sm text-content-muted">
            Your menu categories, dishes and overall performance.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {itemsData.map((item, index) => {
            return (
              <div
                key={index}
                className="shadow-sm rounded-lg p-4"
                style={{ backgroundColor: item.color }}
              >
                <div className="flex justify-between items-center">
                  <p className="font-medium text-xs text-white">{item.title}</p>
                  <div className="flex items-center gap-1">
                    <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4" fill="none">
                      <path d="M5 15l7-7 7 7" />
                    </svg>
                    <p className="font-medium text-xs text-white">{item.percentage}</p>
                  </div>
                </div>
                <p className="mt-1 font-semibold text-2xl text-white">{item.value}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Metrics;