import React from "react";

/** Full-page card for the screens with no store to show: error, not found, bare apex. */
export default function Message({ icon, iconSize = "text-6xl", title, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
        <div className={`${iconSize} mb-4`} aria-hidden="true">{icon}</div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">{title}</h1>
        <p className="text-slate-500 text-sm">{children}</p>
      </div>
    </div>
  );
}
