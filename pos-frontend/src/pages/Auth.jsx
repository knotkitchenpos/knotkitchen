import React, { useEffect } from "react";
import Login from "../components/auth/Login";
import KnotLogo from "../components/shared/KnotLogo";
import authBg from "../assets/images/brand/auth-bg.webp";
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
      {/* Brand background artwork (navy → orange sweep). */}
      <div
        className="absolute inset-0 z-0 pointer-events-none bg-cover bg-center"
        style={{ backgroundImage: `url(${authBg})` }}
        aria-hidden="true"
      />

      {/* Scrim: the artwork's orange half is far too bright to read a form
          against, so darken it toward the brand navy. Heavier on the right,
          where the orange is most intense. */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(100deg, rgba(8,15,31,0.88) 0%, rgba(8,15,31,0.80) 45%, rgba(8,15,31,0.86) 100%)",
        }}
        aria-hidden="true"
      />

      {/* Main Container */}
      <div className="relative z-10 w-full max-w-md px-4 py-8 sm:py-12 flex flex-col items-center">
        {/* Brand Header */}
        <div className="mb-8 text-center">
          <KnotLogo size="xl" showSubtitle={true} dark={true} />
        </div>

        {/* Centered Premium Dark Login Card */}
        <div className="w-full bg-[#111B2E]/90 border border-[#26344B] rounded-2xl p-6 sm:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-all duration-300">
          <Login />
        </div>

        {/* Footer info */}
        <div className="mt-8 text-center text-xs text-white/55">
          &copy; {new Date().getFullYear()} KnotKitchen Inc. All rights reserved.
        </div>
      </div>
    </div>
  );
};

export default Auth;
