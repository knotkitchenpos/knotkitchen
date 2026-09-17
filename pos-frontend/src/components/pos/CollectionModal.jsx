import React, { useState } from "react";
import { ModalShell, Field, inputCls } from "./ModalShell";

/**
 * Loose phone validator — checked ONLY when phone is supplied.
 * Collection orders permit optional customer details (Module 2 §5).
 * Indian +91 format supported.
 */
const PHONE = /^(\+91[\s-]?)?[6-9]\d{9}$|^[+]?[\d\s()-]{7,20}$/;

const CollectionModal = ({ initialName = "", initialPhone = "", total = 0, busy, onClose, onConfirm }) => {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [err, setErr] = useState({});

  const submit = (e) => {
    e.preventDefault();
    const n = {};
    if (phone.trim() && !PHONE.test(phone.trim())) {
      n.phone = "Enter a valid phone number (e.g. +91 9876543210) or leave blank.";
    }
    setErr(n);
    if (Object.keys(n).length) return;
    onConfirm({
      name: name.trim(),
      phone: phone.trim(),
    });
  };

  return (
    <ModalShell
      title="Collection Order"
      subtitle="Enter customer details below (optional — leave blank for walk-in)."
      onClose={onClose}
      width={460}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Customer Name" error={err.name}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customer Name"
            maxLength={120}
            className={inputCls(err.name)}
          />
        </Field>

        <Field label="Phone Number" error={err.phone}>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 9876543210"
            maxLength={20}
            className={inputCls(err.phone)}
          />
        </Field>

        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
          <span className="text-[13.5px] font-bold text-[#475569]">Order Total</span>
          <span className="text-[19px] font-extrabold text-[#C2410C]">₹{Number(total).toFixed(2)}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-[46px] rounded-xl border border-[#E2E8F0] text-[#334155] text-[14px] font-bold hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="h-[46px] rounded-xl bg-[#FD5302] text-white text-[14px] font-bold hover:bg-[#D64502] disabled:opacity-50"
          >
            {busy ? "Completing…" : "Complete Order"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

export default CollectionModal;
