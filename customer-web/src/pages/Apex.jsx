import React from "react";

/**
 * Landing shown when the customer-web receives a bare-apex request
 * (`knotkitchen.com`) with no fallback slug configured. Deliberately minimal —
 * marketing / discovery is a separate concern and out of scope for this app.
 */
export default function Apex() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
        <div className="text-6xl mb-4" aria-hidden="true">🍽️</div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Knot Kitchen</h1>
        <p className="text-slate-500 text-sm">
          Each Knot Kitchen restaurant has its own address — for example{" "}
          <span className="font-mono">burger-house.knotkitchen.com</span>. Please use the link
          your restaurant shared with you.
        </p>
      </div>
    </div>
  );
}
