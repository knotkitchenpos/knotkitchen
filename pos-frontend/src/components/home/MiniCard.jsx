import React from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { FiTrendingUp } from "react-icons/fi";

const MiniCard = ({ title, icon, number, footerNum }) => {
  const isEarnings = title === "Total Earnings";
  const navigate = useNavigate();

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.3 }}
      className="card p-5 sm:p-6 relative overflow-hidden"
    >
      <div className={`absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl ${isEarnings ? "bg-accent-green/20" : "bg-accent/20"}`} />
      <div className="flex items-start justify-between relative">
        <h1 className="text-content-muted text-sm font-semibold tracking-wide">{title}</h1>
        <motion.button
          whileHover={{ scale: 1.1, rotate: 5 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => navigate("/orders")}
          title={`View ${title}`}
          className={`${isEarnings ? "bg-accent-green" : "bg-gradient-brand"} p-3 rounded-xl text-white text-xl shadow-lg`}
        >
          {icon}
        </motion.button>
      </div>
      <div className="mt-4">
        <h1 className="font-display text-3xl sm:text-4xl font-bold count-up">
          {isEarnings ? `₹${number}` : number}
        </h1>
        <p className="text-sm mt-2">
          <span className="text-accent-green font-semibold">{footerNum}%</span>
          <span className="text-content-muted ml-1">than yesterday</span>
        </p>
      </div>
    </motion.div>
  );
};

export default MiniCard;