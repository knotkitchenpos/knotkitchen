import React, { useEffect } from "react";
import Login from "../components/auth/Login";
import KnotLogo from "../components/shared/KnotLogo";
import { Navigate } from "react-router-dom";
import { useSelector } from "react-redux";

const Auth = () => {
  const userData = useSelector((state) => state.user);
  const isAuthenticated = userData?.isAuth;

  useEffect(() => {
    document.title = "KnotKitchen | Sign In";
  }, []);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#080F1F] selection:bg-accent selection:text-white">
      {/* Background Graphic Elements (Matching Reference Image) */}
      {/* 1. Large Orange Diagonal Ribbon / Curve */}
      <div 
        className="absolute inset-0 pointer-events-none z-0 opacity-40 overflow-hidden"
        aria-hidden="true"
      >
        {/* Curved Diagonal Gradient Ribbon */}
        <div 
          className="absolute -bottom-[20%] -right-[15%] w-[120%] h-[90%] transform -rotate-12"
          style={{
            background: "linear-gradient(105deg, transparent 40%, rgba(233, 77, 0, 0.25) 50%, rgba(255, 90, 0, 0.55) 60%, rgba(13, 21, 38, 0.95) 75%)",
            filter: "blur(2px)",
          }}
        />
        {/* Soft Radial Ambient Glow */}
        <div 
          className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(255, 90, 0, 0.12) 0%, rgba(8, 15, 31, 0) 70%)",
          }}
        />
      </div>

      {/* 2. Orange Dot Pattern Grids in Corners */}
      <div className="absolute top-6 left-6 sm:top-10 sm:left-10 z-0 pointer-events-none opacity-30">
        <svg width="120" height="120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <pattern id="dotPatternTop" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.5" fill="#FF5A00" />
          </pattern>
          <rect width="120" height="120" fill="url(#dotPatternTop)" />
        </svg>
      </div>

      <div className="absolute bottom-6 right-6 sm:bottom-10 sm:right-10 z-0 pointer-events-none opacity-30">
        <svg width="140" height="140" fill="none" xmlns="http://www.w3.org/2000/svg">
          <pattern id="dotPatternBottom" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.5" fill="#FF5A00" />
          </pattern>
          <rect width="140" height="140" fill="url(#dotPatternBottom)" />
        </svg>
      </div>

      {/* Main Container */}
      <div className="relative z-10 w-full max-w-md px-4 py-8 sm:py-12 flex flex-col items-center">
        {/* Brand Header */}
        <div className="mb-8 text-center">
          <KnotLogo size="xl" showSubtitle={true} />
        </div>

        {/* Centered Premium Dark Login Card */}
        <div className="w-full bg-[#111B2E]/90 border border-[#26344B] rounded-2xl p-6 sm:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-all duration-300">
          <Login />
        </div>

        {/* Footer info */}
        <div className="mt-8 text-center text-xs text-content-muted">
          &copy; {new Date().getFullYear()} KnotKitchen Inc. All rights reserved.
        </div>
      </div>
    </div>
  );
};

export default Auth;
