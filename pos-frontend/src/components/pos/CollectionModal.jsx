import React, { useState } from "react";
import { ModalShell, Field, inputCls } from "./ModalShell";

const PHONE = /^[+]?[\d\s\-()]{7,20}$/;

/** Finish Order → Collection: Customer Name + Phone (both required). */
const CollectionModal = ({ initialName = "", initialPhone = "", total = 0, busy, onClose, onConfirm }) => {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [err, setErr] = useState({});

  const submit = (e) => {
    e.preventDefault();
    const n = {};
    if (!name.trim()) n.name = "Customer name is required";
    if (!phone.trim()) n.phone = "Phone number is required";
    else if (!PHONE.test(phone.trim())) n.phone = "Enter a valid phone number";
    setErr(n);
    if (Object.keys(n).length) return;
    onConfirm({ name: name.trim(), phone: phone.trim() });
  };

  return (
    <ModalShell
      title="Collection Order"
      subtitle="Enter the customer's details to complete this collection order."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Customer Name" error={err.name}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ray Castle"
            maxLength={120}
            className={inputCls(err.name)}
          />
        </Field>

        <Field label="Phone Number" error={err.phone}>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. +44 7700 900123"
            maxLength={20}
            className={inputCls(err.phone)}
          />
        </Field>

        <div className="flex items-center justify-between px-3.5 py-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
          <span className="text-[13.5px] font-bold text-[#475569]">Order Total</span>
          <span className="text-[19px] font-extrabold text-[#5B42F3]">₹{Number(total).toFixed(2)}</span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-[48px] rounded-xl border border-[#E2E8F0] text-[#334155] text-[14px] font-bold hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="h-[48px] rounded-xl bg-[#5B42F3] text-white text-[14px] font-bold hover:bg-[#4A32E0] disabled:opacity-50"
          >
            {busy ? "Completing…" : "Complete Order"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

export default CollectionModal;
