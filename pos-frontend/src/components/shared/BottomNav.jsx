import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FiHome, FiClipboard, FiGrid, FiCoffee } from "react-icons/fi";

const navItems = [
  { path: "/", label: "Home", icon: <FiHome size={22} /> },
  { path: "/orders", label: "Orders", icon: <FiClipboard size={22} /> },
  { path: "/tables", label: "Tables", icon: <FiGrid size={22} /> },
  { path: "/menu", label: "Menu", icon: <FiCoffee size={22} /> },
];

const BottomNav = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 glass border-t border-border pb-safe">
      <div className="grid grid-cols-4">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="relative flex flex-col items-center justify-center py-3"
            >
              {isActive && (
                <motion.div
                  layoutId="bottom-nav-active"
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 bg-accent rounded-full"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span
                className={`transition-colors ${
                  isActive ? "text-accent" : "text-content-muted"
                }`}
              >
                {item.icon}
              </span>
              <span
                className={`text-[10px] font-medium mt-1 transition-colors ${
                  isActive ? "text-accent" : "text-content-muted"
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;