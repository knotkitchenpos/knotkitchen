import React, { useEffect, useState } from "react";
import { getBookingSlots, requestTableBooking } from "../lib/api";

const dayLabel = (ymd, i) => {
  if (i === 0) return "Today";
  if (i === 1) return "Tomorrow";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
};

const timeLabel = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/**
 * Request a table. The restaurant confirms it on their POS.
 *
 * Hours and bookable times come from the server, which knows the store's
 * timezone and settings; this form only offers what the server will accept.
 */
export default function TableBookingModal({ slug, initial, onClose }) {
  const [info, setInfo] = useState(initial || null);
  const [date, setDate] = useState(initial?.date || "");
  const [time, setTime] = useState("");
  const [guests, setGuests] = useState(2);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let live = true;
    getBookingSlots(slug, date || undefined)
      .then(({ data }) => {
        if (!live) return;
        setInfo(data.data);
        if (!date) setDate(data.data.date);
        setTime((t) => (data.data.slots.includes(t) ? t : ""));
      })
      .catch(() => live && setErr("Could not load booking times. Please try again."));
    return () => {
      live = false;
    };
  }, [slug, date]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!time) return setErr("Please choose a booking time.");
    if (!(guests >= 1)) return setErr("Please enter the number of guests.");
    if (!name.trim()) return setErr("Please enter your name.");
    if (!/^[6-9]\d{9}$/.test(phone)) return setErr("Please enter a valid 10-digit phone number.");
    setBusy(true);
    try {
      const { data } = await requestTableBooking(slug, { date, time, guestCount: guests, name: name.trim(), phone });
      setDone(data.data);
    } catch (e2) {
      setErr(e2?.response?.data?.message || "Could not send your booking. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 outline-none focus:border-slate-900";
  const chip = (on) =>
    `rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
      on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-800 hover:border-slate-900"
    }`;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="book-title" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white font-['Manrope',system-ui,sans-serif] text-slate-900 shadow-2xl sm:max-w-md sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 id="book-title" className="text-lg font-extrabold">Book a Table</h2>
            {info ? (
              <p className="text-sm text-slate-500">Booking hours: {info.hoursLabel}</p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-2xl leading-none text-slate-500 hover:bg-slate-100">
            ×
          </button>
        </div>

        {done ? (
          <div className="px-5 py-8 text-center">
            <p className="text-4xl" aria-hidden="true">✓</p>
            <p className="mt-3 text-lg font-extrabold">Request sent</p>
            <p className="mt-1 text-sm text-slate-600">
              {done.guestCount} guest{done.guestCount === 1 ? "" : "s"} at {done.timeLabel}. The restaurant will confirm your table shortly.
            </p>
            <button type="button" onClick={onClose} className="mt-6 w-full rounded-xl bg-slate-900 py-3 font-bold text-white">
              Done
            </button>
          </div>
        ) : info && !info.enabled ? (
          <p className="px-5 py-8 text-center text-sm text-slate-600">Table booking is not available right now.</p>
        ) : (
          <form onSubmit={submit} className="space-y-5 px-5 py-5">
            {info?.dates?.length ? (
              <div>
                <p className="mb-2 text-sm font-bold">Date</p>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                  {info.dates.map((d, i) => (
                    <button key={d} type="button" className={`${chip(d === date)} shrink-0`} onClick={() => setDate(d)}>
                      {dayLabel(d, i)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-sm font-bold">
                Booking time <span className="text-red-600">*</span>
              </p>
              {!info ? (
                <p className="text-sm text-slate-500">Loading times…</p>
              ) : info.slots.length ? (
                <div className="grid grid-cols-3 gap-2">
                  {info.slots.map((s) => (
                    <button key={s} type="button" className={chip(s === time)} onClick={() => setTime(s)}>
                      {timeLabel(s)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No times left on this day. Please choose another date.</p>
              )}
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-bold">
                Number of guests <span className="text-red-600">*</span>
              </span>
              <input type="number" min="1" max="100" inputMode="numeric" required className={field}
                value={guests} onChange={(e) => setGuests(Math.max(0, Math.floor(Number(e.target.value))))} />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold">
                Name <span className="text-red-600">*</span>
              </span>
              <input type="text" required autoComplete="name" maxLength={120} className={field}
                value={name} onChange={(e) => setName(e.target.value)} />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold">
                Phone number <span className="text-red-600">*</span>
              </span>
              <input type="tel" required autoComplete="tel" inputMode="numeric" maxLength={10} placeholder="10-digit mobile number" className={field}
                value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} />
            </label>

            {err ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="alert">{err}</p> : null}

            <button type="submit" disabled={busy} className="w-full rounded-xl bg-slate-900 py-3.5 font-bold text-white disabled:opacity-60">
              {busy ? "Sending…" : "Request Booking"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
