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
    <div className="flex-1 min-h-0 bg-surface overflow-y-auto no-scrollbar">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Greetings />

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
          <MiniCard title="Total Earnings" icon={<BsCashCoin />} number={metrics.totalRevenue} footerNum={1.6} />
          <MiniCard title="In Progress" icon={<GrInProgress />} number={metrics.inProgressCount} footerNum={3.6} />
        </div>

        {/* Active orders & Booked tables highlight */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div className="card p-5 sm:p-6 flex items-center justify-between">
            <div>
              <p className="text-content-muted text-sm font-semibold">Active Orders</p>
              <p className="font-display text-3xl font-bold mt-1">{metrics.activeOrders}</p>
            </div>
            <div className="bg-accent/10 p-3 rounded-xl text-accent">
              <FiClipboard size={24} />
            </div>
          </div>
          <div className="card p-5 sm:p-6 flex items-center justify-between">
            <div>
              <p className="text-content-muted text-sm font-semibold">Booked Tables</p>
              <p className="font-display text-3xl font-bold mt-1">{metrics.bookedTables}</p>
            </div>
            <div className="bg-accent-green/10 p-3 rounded-xl text-accent-green">
              <FiUsers size={24} />
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-6">
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