import React from "react";

const KnotLogo = ({ size = "md", showSubtitle = false, className = "" }) => {
  const iconSizes = {
    sm: "w-8 h-8",
    md: "w-10 h-10",
    lg: "w-20 h-20",
    xl: "w-28 h-28",
  };

  const textSizes = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-3xl sm:text-4xl",
    xl: "text-4xl sm:text-5xl",
  };

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      {/* SVG Icon matching reference logo */}
      <div className={`relative ${iconSizes[size]} mb-3`}>
        <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full drop-shadow-[0_8px_20px_rgba(255,90,0,0.25)]">
          <defs>
            <linearGradient id="orangeGrad" x1="20" y1="100" x2="100" y2="20" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FF4D00" />
              <stop offset="50%" stopColor="#FF5A00" />
              <stop offset="100%" stopColor="#FF7A1A" />
            </linearGradient>
            <linearGradient id="navyGrad" x1="0" y1="0" x2="60" y2="100" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#1E2A40" />
              <stop offset="100%" stopColor="#0B1324" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          
          {/* Left Navy Loop */}
          <path
            d="M45 40 C 25 40, 15 55, 15 70 C 15 85, 30 95, 45 95 C 65 95, 75 75, 85 60 L 55 25"
            stroke="url(#navyGrad)"
            strokeWidth="14"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Right Knot / Diagonal Orange Loop Forming 'K' */}
          <path
            d="M35 80 C 45 65, 55 45, 75 25 C 85 15, 100 25, 95 40 C 90 55, 75 70, 50 85 C 35 94, 25 75, 45 50 L 95 95"
            stroke="url(#orangeGrad)"
            strokeWidth="14"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#glow)"
          />
        </svg>
      </div>

      {/* Brand Text */}
      <div className={`font-display font-bold tracking-tight ${textSizes[size]}`}>
        <span className="text-white">Knot</span>
        <span className="text-accent">Kitchen</span>
      </div>

      {/* Subtitles */}
      {showSubtitle && (
        <div className="text-center mt-2 space-y-1">
          <p className="text-content-secondary font-medium text-sm sm:text-base tracking-wide">
            Restaurant POS System
          </p>
          <p className="text-content-muted text-xs sm:text-sm">
            Manage your restaurant efficiently
          </p>
        </div>
      )}
    </div>
  );
};

export default KnotLogo;
