import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { enqueueSnackbar } from "notistack";
import { useQueryClient } from "@tanstack/react-query";
import {
  getTableBookings,
  getBookingTables,
  acceptTableBooking,
  cancelTableBooking,
} from "../../https";
import useAlertBeep from "../../hooks/useAlertBeep";
import { acquireSocket, releaseSocket } from "../../socket";
import { localDay, timeIN } from "../../utils";


const dayLabel = (ymd) => {
  const today = new Date();
  const fmt = localDay;
  if (ymd === fmt(today)) return "Today";
  if (ymd === fmt(new Date(today.getTime() + 86400000))) return "Tomorrow";
  const [y, m, d] = String(ymd).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
};

/**
 * Table booking requests from the restaurant website.
 *
 * A request pops up and rings until someone accepts or cancels it. Accepting
 * asks which table: the list is every table, marked free or not for THAT time,
 * so staff pre-book a table that is actually free at 5:00 PM rather than one
 * that merely looks free now.
 *
 * Pending requests are restored from the server on every (re)connect, so a
 * reload or a dropped socket cannot lose one.
 */
const TableBookingPopup = () => {
  const restaurantId = useSelector((s) => s.user?.restaurantId);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState([]);
  const [picking, setPicking] = useState(null); // { booking, tables, blockFrom }
  const [selectedTable, setSelectedTable] = useState("");
  const [busy, setBusy] = useState(false);

  useAlertBeep(pending.length > 0 && !picking);

  useEffect(() => {
    if (!restaurantId) return undefined;

    const socket = acquireSocket(restaurantId);

    const restore = async () => {
      try {
        const { data } = await getTableBookings();
        setPending((data?.data || []).filter((b) => b.status === "PENDING"));
      } catch {
        /* the live event still works without this */
      }
    };

    const onConnect = () => restore();

    const onCreated = ({ booking } = {}) => {
      if (!booking?._id) return;
      setPending((prev) => (prev.some((b) => b._id === booking._id) ? prev : [...prev, booking]));
      queryClient.invalidateQueries({ queryKey: ["table-bookings"] });
    };

    // Accepted or cancelled on another till: drop it here too.
    const onUpdated = ({ booking } = {}) => {
      if (!booking?._id) return;
      if (booking.status !== "PENDING") setPending((prev) => prev.filter((b) => b._id !== booking._id));
      queryClient.invalidateQueries({ queryKey: ["tables"] });
      queryClient.invalidateQueries({ queryKey: ["table-bookings"] });
    };

    socket.on("connect", onConnect);
    socket.on("tableBooking:created", onCreated);
    socket.on("tableBooking:updated", onUpdated);
    if (socket.connected) onConnect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("tableBooking:created", onCreated);
      socket.off("tableBooking:updated", onUpdated);
      releaseSocket();
    };
  }, [restaurantId, queryClient]);

  const done = (id) => {
    setPending((prev) => prev.filter((b) => b._id !== id));
    setPicking(null);
    setSelectedTable("");
    queryClient.invalidateQueries({ queryKey: ["tables"] });
    queryClient.invalidateQueries({ queryKey: ["table-bookings"] });
  };

  const fail = (e, fallback) =>
    enqueueSnackbar(e?.response?.data?.message || fallback, { variant: "error" });

  const startAccept = async (booking) => {
    setBusy(true);
    try {
      const { data } = await getBookingTables(booking._id);
      setPicking({ booking, ...data.data });
      setSelectedTable("");
    } catch (e) {
      fail(e, "Could not load tables for this booking.");
    } finally {
      setBusy(false);
    }
  };

  const confirmAccept = async () => {
    if (!picking || !selectedTable) return;
    setBusy(true);
    try {
      const { data } = await acceptTableBooking(picking.booking._id, selectedTable);
      enqueueSnackbar(data?.message || "Table pre-booked.", { variant: "success" });
      done(picking.booking._id);
    } catch (e) {
      fail(e, "Could not pre-book this table.");
      startAccept(picking.booking);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (booking) => {
    if (!window.confirm(`Cancel the booking for ${booking.name} at ${booking.timeLabel}?`)) return;
    setBusy(true);
    try {
      await cancelTableBooking(booking._id);
      enqueueSnackbar("Booking cancelled.", { variant: "info" });
      done(booking._id);
    } catch (e) {
      fail(e, "Could not cancel this booking.");
    } finally {
      setBusy(false);
    }
  };

  if (!pending.length && !picking) return null;

  if (picking) {
    const { booking, tables = [], blockFrom } = picking;
    const blockLabel = timeIN(blockFrom);
    return (
      <div className="fixed inset-0 z-[75] bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E2E8F0]">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#C2410C]">Pre-book a table</p>
            <p className="text-lg font-extrabold text-[#0F172A]">
              {booking.name} · {booking.guestCount} guest{booking.guestCount === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-[#64748B]">
              {dayLabel(booking.bookingDate)} at {booking.timeLabel}
              {blockLabel ? ` · table held from ${blockLabel}` : ""}
            </p>
          </div>
          <div className="p-5 max-h-[55vh] overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {tables.map((t) => {
              const on = selectedTable === t._id;
              return (
                <button
                  key={t._id}
                  type="button"
                  disabled={!t.available}
                  onClick={() => setSelectedTable(t._id)}
                  className={`p-3 rounded-xl border text-left transition ${
                    !t.available
                      ? "bg-[#F8FAFC] border-[#E2E8F0] opacity-60 cursor-not-allowed"
                      : on
                      ? "bg-[#FD5302] border-[#FD5302] text-white"
                      : "bg-white border-[#E2E8F0] hover:border-[#FD5302]"
                  }`}
                >
                  <p className="text-sm font-bold truncate">{t.name}</p>
                  <p className={`text-[11px] truncate ${on ? "text-white/80" : "text-[#64748B]"}`}>
                    Seats {t.capacity}
                    {t.area ? ` · ${t.area}` : ""}
                  </p>
                  <span
                    className={`inline-block mt-1.5 px-1.5 py-[2px] rounded text-[10px] font-bold ${
                      !t.available ? "bg-[#FEE2E2] text-[#DC2626]" : on ? "bg-white/20 text-white" : "bg-[#DCFCE7] text-[#15803D]"
                    }`}
                  >
                    {t.available ? "Available" : t.reason}
                  </span>
                </button>
              );
            })}
            {!tables.length ? <p className="col-span-full text-sm text-[#64748B]">No tables set up in this store.</p> : null}
          </div>
          <div className="px-5 py-4 border-t border-[#E2E8F0] flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setPicking(null)}
              className="px-4 py-2 rounded-xl border border-[#E2E8F0] text-sm font-semibold text-[#0F172A]"
            >
              Back
            </button>
            <button
              type="button"
              onClick={confirmAccept}
              disabled={!selectedTable || busy}
              className="px-4 py-2 rounded-xl bg-[#FD5302] text-white text-sm font-bold disabled:opacity-50"
            >
              {busy
                ? "Saving…"
                : selectedTable
                ? `Pre-book ${tables.find((t) => t._id === selectedTable)?.name || "table"}`
                : "Choose a table"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] lg:bottom-4 right-4 z-[70] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2rem)]">
      {pending.map((b) => (
        <div key={b._id} role="alert" className="rounded-2xl border-2 border-[#FD5302] bg-white shadow-2xl p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#C2410C]">Table booking request</p>
          <p className="text-[20px] leading-tight font-black text-[#0F172A] truncate">
            {dayLabel(b.bookingDate)} · {b.timeLabel}
          </p>
          <p className="text-sm font-semibold text-[#0F172A] mt-1 truncate">
            {b.name} · {b.guestCount} guest{b.guestCount === 1 ? "" : "s"}
          </p>
          <a href={`tel:${b.phone}`} className="text-xs text-[#64748B] underline">
            {b.phone}
          </a>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => cancel(b)}
              disabled={busy}
              className="flex-1 py-2 rounded-xl border border-[#FECACA] text-[#DC2626] text-sm font-bold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => startAccept(b)}
              disabled={busy}
              className="flex-1 py-2 rounded-xl bg-[#22C55E] text-white text-sm font-bold hover:bg-[#16A34A] disabled:opacity-50"
            >
              Accept
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default TableBookingPopup;
