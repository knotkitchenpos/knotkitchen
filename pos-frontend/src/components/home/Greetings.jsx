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
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-6"
    >
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
          {greeting}, <span className="text-accent">{userData.name || "Guest"}</span>
        </h1>
        <p className="text-content-muted text-sm mt-1">
          Here's what's happening at your restaurant today.
        </p>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            <FiClock className="text-content-muted" size={16} />
            <p className="font-display text-2xl font-bold tabular-nums">{formatTime(dateTime)}</p>
          </div>
          <div className="flex items-center justify-end gap-1.5 mt-1 text-content-muted text-xs">
            <FiCalendar size={12} />
            <p>{formatDate(dateTime)}</p>
          </div>
        </div>
        <div className="hidden sm:block w-12 h-12 rounded-2xl bg-gradient-brand flex items-center justify-center text-2xl">
          <FiClock className="text-white" size={24} />
        </div>
      </div>
    </motion.div>
  );
};

export default Greetings;