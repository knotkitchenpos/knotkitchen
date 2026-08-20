import React, { useState } from "react";
import { ModalShell, Field, inputCls } from "./ModalShell";

/**
 * Loose phone validator — only checked when the operator *has* typed
 * something. Empty is valid because Collection orders don't require
 * customer details (Module 2 §3 + Module 4 §5).
 */
const PHONE = /^[+]?[\d\s\-()]{7,20}$/;

/**
 * Finish Order → Collection (Module 2 §3, §4 + Module 4 §5).
 *
 * Design contract:
 *   - Customer name is OPTIONAL. Empty is fine — no auto-Guest.
 *   - Customer phone is OPTIONAL. Empty is fine.
 *   - Address / City / PIN Code / Delivery Note are all OPTIONAL but,
 *     when supplied, the fields flow into `customerDetails` on the
 *     order so Orders → Order Details renders the full picture.
 *   - If either name/phone IS filled, we still validate the format so
 *     a phone accidentally typed as "abc" is caught before submit.
 *   - Placeholders show +91 examples per Module 2 §3.
 */
const CollectionModal = ({ initialName = "", initialPhone = "", total = 0, busy, onClose, onConfirm }) => {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [pin, setPin] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState({});

  const submit = (e) => {
    e.preventDefault();
    const n = {};
    // Only format-check phone if the operator actually typed one.
    if (phone.trim() && !PHONE.test(phone.trim())) {
      n.phone = "Enter a valid phone number or leave it blank.";
    }
    setErr(n);
    if (Object.keys(n).length) return;
    onConfirm({
      name: name.trim(),
      phone: phone.trim(),
      // Extra customer fields (Module 4 §5) — undefined when empty so
      // downstream schema doesn't record noisy empty strings.
      address: address.trim() || undefined,
      city: city.trim() || undefined,
      pinCode: pin.trim() || undefined,
      deliveryNote: note.trim() || undefined,
    });
  };

  return (
    <ModalShell
      title="Collection Order"
      subtitle="Customer details are optional — leave them blank for a walk-in."
      onClose={onClose}
      width={500}
    >
      <form onSubmit={submit} className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer Name (optional)" error={err.name}>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ame"
              maxLength={120}
              className={inputCls(err.name)}
            />
          </Field>

          <Field label="Phone Number (optional)" error={err.phone}>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. +91 0000000000"
              maxLength={20}
              className={inputCls(err.phone)}
            />
          </Field>
        </div>

        <Field label="Address (optional)">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. Address"
            maxLength={300}
            className={inputCls(false)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="City (optional)">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. City"
              maxLength={120}
              className={inputCls(false)}
            />
          </Field>

          <Field label="PIN Code (optional)">
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="e.g. PIN code"
              maxLength={20}
              className={inputCls(false)}
            />
          </Field>
        </div>

        <Field label="Delivery Note (optional)">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Ring The Bell Twice"
            maxLength={400}
            className={inputCls(false)}
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
