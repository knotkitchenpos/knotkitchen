import React, { useState, useEffect } from "react";
import Login from "../components/auth/Login";
import Register from "../components/auth/Register";
import { motion, AnimatePresence } from "framer-motion";
import { FiUser } from "react-icons/fi";
import { Navigate } from "react-router-dom";
import { useSelector } from "react-redux";

const Auth = () => {
  const [tab, setTab] = useState("login");
  // The user slice stores fields directly (no nested userInfo object)
  const userData = useSelector((state) => state.user);
  const isAuthenticated = userData?.isAuth;
  useEffect(() => {
    document.title = "KnotKitchen | Auth";
  }, []);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return (
    <div className="flex-1 min-h-0 bg-surface overflow-y-auto no-scrollbar">
      <div className="min-h-full flex flex-col">
        <div className="w-full max-w-md mx-auto p-4 m-auto">
          {/* Brand */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-brand flex items-center justify-center text-white mb-4 shadow-lg shadow-accent/25">
              <FiUser size={32} />
            </div>
            <h1 className="font-display text-3xl font-bold">KnotKitchen</h1>
            <p className="text-content-muted text-sm mt-2">
              Restaurant POS System - Manage your restaurant efficiently
            </p>
          </div>

          {/* Card */}
          <div className="card p-6 sm:p-8">
            {/* Tabs */}
            <div className="grid grid-cols-2 gap-2 bg-surface-tertiary rounded-xl p-1.5 mb-6">
              <button
                onClick={() => setTab("login")}
                className={`py-2.5 rounded-lg font-semibold text-sm transition-all ${
                  tab === "login"
                    ? "bg-surface-secondary text-accent shadow-card"
                    : "text-content-muted hover:text-content"
                }`}
              >
                Login
              </button>
              <button
                onClick={() => setTab("register")}
                className={`py-2.5 rounded-lg font-semibold text-sm transition-all ${
                  tab === "register"
                    ? "bg-surface-secondary text-accent shadow-card"
                    : "text-content-muted hover:text-content"
                }`}
              >
                Register
              </button>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {tab === "login" ? <Login /> : <Register />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;