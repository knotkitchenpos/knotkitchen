import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useSelector } from "react-redux";
import { FiClock, FiCalendar } from "react-icons/fi";

const Greetings = () => {
  const userData = useSelector((state) => state.user);
  const [dateTime, setDateTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setDateTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDate = (date) => {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return `${months[date.getMonth()]} ${String(date.getDate()).padStart(2, "0")}, ${date.getFullYear()}`;
  };

  const formatTime = (date) =>
    `${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes()
    ).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;

  const hour = dateTime.getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative mt-0 flex flex-col justify-between gap-5 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white px-5 py-5 shadow-card sm:flex-row sm:items-center sm:px-6"
    >
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[#0F172A] sm:text-3xl">
          {greeting}, <span className="text-accent">{userData.name || "Guest"}</span>
        </h1>
        <p className="mt-1 text-sm text-[#64748B]">
          Here's what's happening at your restaurant today.
        </p>
      </div>
      <div className="flex items-center gap-4 rounded-2xl bg-[#F8FAFC] px-3 py-2.5 sm:px-4">
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            <FiClock className="text-content-muted" size={16} />
            <p className="font-display text-2xl font-bold tabular-nums text-[#0F172A]">{formatTime(dateTime)}</p>
          </div>
          <div className="flex items-center justify-end gap-1.5 mt-1 text-content-muted text-xs">
            <FiCalendar size={12} />
            <p>{formatDate(dateTime)}</p>
          </div>
        </div>
        <div className="hidden h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#5B42F3] to-[#7C3AED] text-2xl shadow-purple sm:flex">
          <FiClock className="text-white" size={24} />
        </div>
      </div>
    </motion.div>
  );
};

export default Greetings;