import React, { useState } from "react";
import { ModalShell, Field, inputCls } from "./ModalShell";
import { mobileDigits } from "../../redux/slices/customerSlice";

const PHONE = /^[6-9]\d{9}$/;
const PIN = /^[1-9]\d{5}$/;

/**
 * Finish Order → Delivery, step 1: Name + Phone + Address + Pincode (all
 * required), and the distance when the store prices delivery by km. Payment is
 * chosen next, once the charge for this address is known.
 *
 * `initial` is what was entered last time, so Cancel on the payment step and
 * Finish again does not retype the address. `maxKm` > 0 asks for the distance.
 */
const DeliveryModal = ({ initial = null, initialName = "", initialPhone = "", maxKm = 0, onClose, onConfirm }) => {
  const [name, setName] = useState(initial?.name || initialName || "");
  const [phone, setPhone] = useState(mobileDigits(initial?.phone || initialPhone));
  const [line1, setLine1] = useState(initial?.address || "");
  const [city, setCity] = useState(initial?.city || "");
  const [pin, setPin] = useState(initial?.pinCode || "");
  const [km, setKm] = useState(initial?.deliveryAddress?.distanceKm ?? "");
  const [note, setNote] = useState(initial?.deliveryNote || "");
  const [err, setErr] = useState({});

  const submit = (e) => {
    e.preventDefault();
    const n = {};
    if (!name.trim()) n.name = "Customer name is required";
    if (!phone) n.phone = "Phone number is required";
    else if (!PHONE.test(phone)) n.phone = "Enter a valid 10-digit mobile number";
    if (!line1.trim()) n.line1 = "Delivery address is required";
    if (!pin) n.pin = "Pincode is required";
    else if (!PIN.test(pin)) n.pin = "Enter a 6-digit pincode";
    if (maxKm > 0) {
      if (km === "" || !(Number(km) >= 0)) n.km = "Enter the distance from the store";
      else if (Number(km) > maxKm) n.km = `We deliver up to ${maxKm} km`;
    }
    setErr(n);
    if (Object.keys(n).length) return;
    onConfirm({
      name: name.trim(),
      phone,
      // Module 4 §5 — also mirror the structured address into
      // customerDetails so the Orders → Order Details view has a single
      // source of truth for name / phone / address / city / PIN / note.
      address: line1.trim(),
      city: city.trim() || undefined,
      pinCode: pin,
      deliveryNote: note.trim() || undefined,
      deliveryAddress: {
        line1: line1.trim(),
        line2: "",
        city: city.trim(),
        postalCode: pin,
        instructions: note.trim(),
        // Staff-entered; the server prices the delivery from it.
        ...(maxKm > 0 ? { distanceKm: Number(km) } : {}),
      },
    });

  };

  return (
    <ModalShell
      title="Delivery Order"
      subtitle="Delivery details first, then the payment."
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
              placeholder="e.g. Rahul Sharma"
              maxLength={120}
              className={inputCls(err.name)}
            />
          </Field>
          <Field label="Phone Number" error={err.phone}>
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(mobileDigits(e.target.value))}
              placeholder="e.g. 98765 43210"
              className={inputCls(err.phone)}
            />
          </Field>
        </div>

        <Field label="Delivery Address" error={err.line1}>
          <input
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            placeholder="e.g. Flat 2B, 14 Park Street"
            maxLength={200}
            className={inputCls(err.line1)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="City">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Kolkata"
              maxLength={120}
              className={inputCls(false)}
            />
          </Field>
          <Field label="Pincode" error={err.pin}>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="e.g. 700016"
              inputMode="numeric"
              maxLength={6}
              className={inputCls(err.pin)}
            />
          </Field>
        </div>

        {maxKm > 0 && (
          <Field label="Distance from store (km)" error={err.km}>
            <input
              type="number"
              min={0}
              max={maxKm}
              step="0.1"
              inputMode="decimal"
              value={km}
              onChange={(e) => setKm(e.target.value)}
              placeholder={`0 to ${maxKm}`}
              className={inputCls(err.km)}
            />
          </Field>
        )}

        <Field label="Delivery Note (optional)">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Ring the bell twice"
            maxLength={400}
            className={inputCls(false)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="h-[48px] rounded-xl border border-[#E2E8F0] text-[#334155] text-[14px] font-bold hover:bg-[#F8FAFC]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="h-[48px] rounded-xl bg-[#FD5302] text-white text-[14px] font-bold hover:bg-[#D64502]"
          >
            Continue to payment
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

export default DeliveryModal;
