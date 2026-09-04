import React, { useState } from "react";
import { verifyStaffPin } from "../../utils/security";

/**
 * Reusable Centralized Security PIN Modal.
 * Prompts Staff members for the Security PIN.
 *
 * The default PIN is deliberately NOT shown anywhere here. Printing it beside
 * the field told every member of staff the value that gates the POS's
 * protected actions, which defeats the point of having the prompt.
 * On successful verification, stores a short-lived PIN session token and triggers callback.
 */
const SecurityPinModal = ({ isOpen, onClose, onSuccess, title = "Security Authorization Required", actionLabel = "Proceed" }) => {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pin || pin.trim().length < 4) {
      setError("Please enter a valid PIN.");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await verifyStaffPin(pin.trim());
      setPin("");
      onSuccess?.();
      onClose?.();
    } catch (err) {
      setError(err.response?.data?.message || "Invalid Security PIN.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <h3 className="text-base font-extrabold text-[#0F172A]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#475569] text-xl font-bold"
          >
            ×
          </button>
        </div>

        <p className="text-xs text-[#64748B] leading-relaxed">
          This protected action requires Staff Security PIN authorization.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#475569] mb-1">Enter Security PIN</label>
            <input
              type="password"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter PIN"
              autoFocus
              className="w-full h-11 px-3 rounded-xl border border-[#E2E8F0] font-bold text-center text-lg tracking-widest text-[#0F172A] focus:outline-none focus:border-[#FD5302]"
            />
          </div>

          {error && (
            <p className="text-xs font-bold text-[#DC2626] bg-[#FEF2F2] p-2.5 rounded-xl border border-[#FECACA]">
              {error}
            </p>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-[#E2E8F0] text-xs font-bold text-[#475569] hover:bg-[#F8FAFC]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-[#FD5302] text-white text-xs font-bold hover:bg-[#D64502] disabled:opacity-50"
            >
              {loading ? "Verifying…" : actionLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SecurityPinModal;
