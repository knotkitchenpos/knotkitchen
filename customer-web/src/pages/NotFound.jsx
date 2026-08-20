import React from "react";

export default function NotFound({ reason }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
        <div className="text-6xl mb-4" aria-hidden="true">🔍</div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Restaurant not found</h1>
        <p className="text-slate-500 text-sm">
          {reason ||
            "This restaurant is not available right now. If you followed a link, please double-check the address."}
        </p>
      </div>
    </div>
  );
}
