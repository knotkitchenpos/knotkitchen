import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FiClock, FiX } from "react-icons/fi";
import { enqueueSnackbar } from "../../utils/notify";
import { addToWaitlist, getWaitlist, waitlistAction } from "../../https";
import { acquireSocket, releaseSocket } from "../../socket";

/**
 * Waitlist for busy hours (owner, 2026-11-17): the button on Manage Tables
 * and its panel. Every till in the store sees the same list (socket
 * "waitlist:changed"). "Table ready" sends WhatsApp once the kk_table_ready
 * message is approved; until then staff call or tell the guest.
 */

const minutesSince = (d) => Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
const EMPTY = { name: "", phone: "", partySize: "2", note: "" };

const WaitlistButton = () => {
  const restaurantId = useSelector((s) => s.user?.restaurantId);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [, tick] = useState(0);

  const { data } = useQuery({
    queryKey: ["waitlist"],
    queryFn: () => getWaitlist().then((r) => r.data.data),
    enabled: Boolean(restaurantId),
  });
  const entries = data?.entries || [];

  useEffect(() => {
    if (!restaurantId) return undefined;
    const socket = acquireSocket(restaurantId);
    const onChanged = () => qc.invalidateQueries({ queryKey: ["waitlist"] });
    socket.on("waitlist:changed", onChanged);
    return () => {
      socket.off("waitlist:changed", onChanged);
      releaseSocket();
    };
  }, [restaurantId, qc]);

  // Waiting times move on while the panel is open.
  useEffect(() => {
    if (!open) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [open]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["waitlist"] });
  const fail = (err) => enqueueSnackbar(err?.response?.data?.message || "Could not save.", { variant: "error" });
  const add = useMutation({
    mutationFn: () => addToWaitlist({ ...form, partySize: Number(form.partySize) }),
    onSuccess: () => {
      setForm(EMPTY);
      refresh();
    },
    onError: fail,
  });
  const act = useMutation({
    mutationFn: ({ id, action }) => waitlistAction(id, action),
    onSuccess: (res, { action }) => {
      refresh();
      if (action === "notify") {
        const wa = res.data?.data?.whatsapp;
        enqueueSnackbar(wa?.sent ? "Told them on WhatsApp." : `Marked as told. ${wa?.reason || ""} Call or tell the guest.`, { variant: wa?.sent ? "success" : "info" });
      }
    },
    onError: fail,
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3.5 py-2 rounded-xl border border-[#E2E8F0] bg-white text-[#334155] text-xs font-bold hover:bg-[#F8FAFC] flex items-center gap-1.5 whitespace-nowrap"
      >
        <FiClock size={14} /> Waitlist{entries.length ? ` (${entries.length})` : ""}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setOpen(false)}>
          <div role="dialog" aria-label="Waitlist" className="h-full w-full max-w-md bg-white shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
              <h2 className="text-[17px] font-extrabold text-[#0F172A]">Waitlist</h2>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-[#F1F5F9]">
                <FiX size={18} />
              </button>
            </div>

            <form
              className="px-5 py-4 border-b border-[#E2E8F0] grid grid-cols-6 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              <input className="col-span-4 h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px]" placeholder="Guest name" value={form.name} onChange={set("name")} maxLength={60} required />
              <input className="col-span-2 h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px]" placeholder="People" inputMode="numeric" value={form.partySize} onChange={set("partySize")} required />
              <input className="col-span-3 h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px]" placeholder="Phone (for WhatsApp)" inputMode="numeric" maxLength={10} value={form.phone} onChange={set("phone")} />
              <input className="col-span-3 h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px]" placeholder="Note (e.g. window seat)" value={form.note} onChange={set("note")} maxLength={120} />
              <button type="submit" disabled={add.isPending} className="col-span-6 h-10 rounded-lg bg-[#FD5302] text-white text-[13px] font-bold disabled:opacity-50">
                {add.isPending ? "Adding…" : "Add to waitlist"}
              </button>
              {data?.whatsapp && !data.whatsapp.ready && (
                <p className="col-span-6 text-[11.5px] text-[#92400E]">WhatsApp &quot;table ready&quot; messages start once KnotKitchen has them approved. Until then, call or tell the guest.</p>
              )}
            </form>

            <ul className="flex-1 overflow-y-auto divide-y divide-[#F1F5F9]">
              {entries.length === 0 ? (
                <li className="px-5 py-8 text-center text-[13px] text-[#94A3B8]">Nobody is waiting.</li>
              ) : (
                entries.map((w, i) => (
                  <li key={w.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[14px] font-bold text-[#0F172A]">
                          {i + 1}. {w.name} <span className="font-semibold text-[#64748B]">· {w.partySize} {w.partySize === 1 ? "person" : "people"}</span>
                        </p>
                        <p className="text-[12px] text-[#64748B]">
                          Waiting {minutesSince(w.addedAt)} min{w.phone ? ` · ${w.phone}` : ""}
                          {w.note ? ` · ${w.note}` : ""}
                        </p>
                        {w.status === "notified" && (
                          <p className="text-[12px] font-bold text-[#15803D]">
                            Told {minutesSince(w.notifiedAt)} min ago{w.notifiedByWhatsApp ? " on WhatsApp" : ""}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: w.id, action: "notify" })} className="h-8 px-3 rounded-lg bg-[#0F172A] text-white text-[12px] font-bold disabled:opacity-50">
                        {w.status === "notified" ? "Tell again" : "Table ready"}
                      </button>
                      <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: w.id, action: "seat" })} className="h-8 px-3 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] text-[#166534] text-[12px] font-bold disabled:opacity-50">
                        Seated
                      </button>
                      <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: w.id, action: "leave" })} className="h-8 px-3 rounded-lg border border-[#E2E8F0] text-[#64748B] text-[12px] font-bold disabled:opacity-50">
                        Left
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
};

export default WaitlistButton;
