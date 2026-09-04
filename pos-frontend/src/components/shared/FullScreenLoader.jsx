import React from "react";
import { motion } from "framer-motion";

const FullScreenLoader = () => {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#080F1F] text-white">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col items-center gap-6"
      >
        {/* Animated Rings */}
        <div className="relative w-16 h-16 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border-4 border-t-[#FF6A1F] border-r-transparent border-b-transparent border-l-transparent animate-spin" />
          <div className="absolute inset-2 rounded-full border-4 border-t-transparent border-r-[#FD5302] border-b-transparent border-l-transparent animate-spin [animation-duration:1.5s]" />
          <div className="w-4 h-4 rounded-full bg-[#FF6A1F]" />
        </div>

        <motion.p
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="font-sans font-bold text-xl tracking-wide text-white"
        >
          Loading <span className="bg-gradient-to-r from-[#FF6A1F] to-[#FF9E00] bg-clip-text text-transparent">KnotKitchen</span>...
        </motion.p>
      </motion.div>
    </div>
  );
};

export default FullScreenLoader;
