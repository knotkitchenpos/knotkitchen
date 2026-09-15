import React from "react";

/** Shared modal chrome so every POS modal looks identical to the reference. */
export const ModalShell = ({ title, subtitle, onClose, children, width = 460 }) => (
  <div className="fixed inset-0 z-[95] bg-[#0F172A]/40 flex items-center justify-center p-4">
    {/* Capped to the screen: a long form (product options) scrolls inside
        the body instead of running off a phone with its buttons unreachable. */}
    <div
      className="w-full max-h-[calc(100dvh-2rem)] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden"
      style={{ maxWidth: width }}
    >
      <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-start justify-between gap-3 shrink-0">
        <div>
          <h3 className="text-[18px] font-extrabold text-[#0F172A] leading-tight">{title}</h3>
          {subtitle && <p className="text-[12.5px] text-[#94A3B8] mt-1">{subtitle}</p>}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="w-10 h-10 -m-1 rounded-lg text-[#94A3B8] hover:text-[#EF4444] hover:bg-[#FEF2F2] text-[20px] leading-none flex items-center justify-center shrink-0"
        >
          ×
        </button>
      </div>
      <div className="p-5 min-h-0 overflow-y-auto">{children}</div>
    </div>
  </div>
);

export const Field = ({ label, error, children }) => (
  <div>
    <label className="block text-[12px] font-bold text-[#475569] mb-1.5 uppercase tracking-wide">
      {label}
    </label>
    {children}
    {error && <p className="text-[11.5px] font-semibold text-[#EF4444] mt-1">{error}</p>}
  </div>
);

export const inputCls = (bad) =>
  `w-full h-[46px] px-3.5 rounded-xl border text-[14px] text-[#0F172A] placeholder:text-[#94A3B8] transition-colors ${
    bad ? "border-[#EF4444] bg-[#FEF2F2]" : "border-[#E2E8F0] focus:border-[#FD5302]"
  }`;

export default ModalShell;
