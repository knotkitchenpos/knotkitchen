import React, { useState } from "react";
import { ModalShell, Field, inputCls } from "./ModalShell";

const PHONE = /^[+]?[\d\s\-()]{7,20}$/;
const PIN = /^[A-Za-z0-9\s-]{3,12}$/;

/** Finish Order → Delivery: Name + Phone + Address + Pincode (all required). */
const DeliveryModal = ({ initialName = "", initialPhone = "", total = 0, busy, onClose, onConfirm }) => {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [pin, setPin] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState({});

  const submit = (e) => {
    e.preventDefault();
    const n = {};
    if (!name.trim()) n.name = "Customer name is required";
    if (!phone.trim()) n.phone = "Phone number is required";
    else if (!PHONE.test(phone.trim())) n.phone = "Enter a valid phone number";
    if (!line1.trim()) n.line1 = "Delivery address is required";
    if (!pin.trim()) n.pin = "Pincode is required";
    else if (!PIN.test(pin.trim())) n.pin = "Enter a valid pincode";
    setErr(n);
    if (Object.keys(n).length) return;
    onConfirm({
      name: name.trim(),
      phone: phone.trim(),
      deliveryAddress: {
        line1: line1.trim(),
        line2: "",
        city: city.trim(),
        postalCode: pin.trim(),
        instructions: note.trim(),
      },
    });
  };

  return (
    <ModalShell
      title="Delivery Order"
      subtitle="Capture the delivery details before completing this order."
      onClose={onClose}
      width={500}
    >
      <form onSubmit={submit} className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
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
        </div>

        <Field label="Delivery Address" error={err.line1}>
          <input
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            placeholder="e.g. 16 Ffordd Y Glowr, Pontarddulais"
            maxLength={200}
            className={inputCls(err.line1)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="City">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Swansea"
              maxLength={120}
              className={inputCls(false)}
            />
          </Field>
          <Field label="Pincode" error={err.pin}>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="e.g. SA4 8DE"
              maxLength={12}
              className={inputCls(err.pin)}
            />
          </Field>
        </div>

        <Field label="Delivery Note (optional)">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Ring the bell twice"
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

export default DeliveryModal;
