import React, { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import Greetings from "../components/home/Greetings";
import { BsCashCoin } from "react-icons/bs";
import { GrInProgress } from "react-icons/gr";
import { FiClipboard, FiUsers } from "react-icons/fi";
import MiniCard from "../components/home/MiniCard";
import RecentOrders from "../components/home/RecentOrders";
import PopularDishes from "../components/home/PopularDishes";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getOrders, getTables } from "../https/index";

const Home = () => {
  useEffect(() => {
    document.title = "KnotKitchen | Home";
  }, []);

  const { data: ordersRes } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => await getOrders(),
    placeholderData: keepPreviousData,
  });

  const { data: tablesRes } = useQuery({
    queryKey: ["tables"],
    queryFn: async () => await getTables(),
    placeholderData: keepPreviousData,
  });

  const metrics = useMemo(() => {
    const orders = ordersRes?.data?.data || [];
    const tables = tablesRes?.data?.data || [];
    const totalRevenue = orders.reduce(
      (sum, order) => sum + (order.bills?.totalWithTax || 0),
      0
    );
    const inProgressCount = orders.filter(
      (order) => order.orderStatus === "In Progress"
    ).length;
    const activeOrders = orders.filter(
      (order) =>
        order.orderStatus === "In Progress" || order.orderStatus === "Ready"
    ).length;
    const bookedTables = tables.filter(
      (table) => table.status === "Booked"
    ).length;
    return {
      totalRevenue: totalRevenue.toFixed(2),
      inProgressCount,
      activeOrders,
      bookedTables,
    };
  }, [ordersRes, tablesRes]);

  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto bg-[#F8FAFC] no-scrollbar">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_top_right,rgba(91,66,243,0.10),transparent_42%),radial-gradient(circle_at_top_left,rgba(255,106,31,0.07),transparent_36%)]" />
      <div className="relative mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <Greetings />

        {/* Stats Cards */}
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MiniCard title="Total Earnings" icon={<BsCashCoin />} number={metrics.totalRevenue} footerNum={1.6} />
          <MiniCard title="In Progress" icon={<GrInProgress />} number={metrics.inProgressCount} footerNum={3.6} />
        </div>

        {/* Active orders & Booked tables highlight */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="card flex items-center justify-between border border-[#E2E8F0] bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-[#C7C2FF] hover:shadow-pop sm:p-6">
            <div>
              <p className="text-content-muted text-sm font-semibold">Active Orders</p>
              <p className="font-display text-3xl font-bold mt-1">{metrics.activeOrders}</p>
            </div>
            <div className="rounded-2xl bg-[#EEF0FE] p-3.5 text-[#5B42F3] shadow-soft">
              <FiClipboard size={24} />
            </div>
          </div>
          <div className="card flex items-center justify-between border border-[#E2E8F0] bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-[#BBF7D0] hover:shadow-pop sm:p-6">
            <div>
              <p className="text-content-muted text-sm font-semibold">Booked Tables</p>
              <p className="font-display text-3xl font-bold mt-1">{metrics.bookedTables}</p>
            </div>
            <div className="rounded-2xl bg-[#ECFDF5] p-3.5 text-[#16A34A] shadow-soft">
              <FiUsers size={24} />
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-3"
          >
            <RecentOrders />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="lg:col-span-2"
          >
            <PopularDishes />
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default Home;