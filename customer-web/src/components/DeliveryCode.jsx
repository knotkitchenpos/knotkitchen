import React from "react";

/**
 * A delivery's 4-digit handover code: the customer tells it to the rider
 * when the food arrives, and the rider needs it to mark the order delivered.
 * Shown on the order confirmation, Knot Eats' order page and the website's
 * tracking page, while the delivery is still on its way.
 */
export default function DeliveryCode({ code, className = "" }) {
  if (!code) return null;
  return (
    <section className={`rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50 px-4 py-3 text-center ${className}`} aria-label="Delivery code">
      <p className="text-[12px] font-bold uppercase tracking-wider text-orange-800">Delivery code</p>
      <p className="mt-0.5 font-mono text-[32px] font-black tracking-[0.35em] text-slate-900" translate="no">
        {code}
      </p>
      <p className="text-[13px] text-slate-600">Give this to the rider only when you have your food.</p>
    </section>
  );
}
