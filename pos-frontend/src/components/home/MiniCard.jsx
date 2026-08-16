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
      className="card relative overflow-hidden border border-[#E2E8F0] bg-white p-5 shadow-card transition-shadow hover:shadow-pop sm:p-6"
    >
      <div className={`absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl ${isEarnings ? "bg-accent-green/20" : "bg-accent/20"}`} />
      <div className="flex items-start justify-between relative">
        <h1 className="text-sm font-semibold tracking-wide text-[#64748B]">{title}</h1>
        <motion.button
          whileHover={{ scale: 1.1, rotate: 5 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => navigate("/orders")}
          title={`View ${title}`}
          className={`${isEarnings ? "bg-[#16A34A]" : "bg-gradient-to-br from-[#5B42F3] to-[#7C3AED]"} rounded-xl p-3 text-xl text-white shadow-purple`}
        >
          {icon}
        </motion.button>
      </div>
      <div className="mt-4">
        <h1 className="count-up font-display text-3xl font-bold text-[#0F172A] sm:text-4xl">
          {isEarnings ? `₹${number}` : number}
        </h1>
        <p className="text-sm mt-2">
          <span className="font-semibold text-[#16A34A]">{footerNum}%</span>
          <span className="ml-1 text-[#94A3B8]">than yesterday</span>
        </p>
      </div>
    </motion.div>
  );
};

export default MiniCard;