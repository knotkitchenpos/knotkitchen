import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "../../utils/notify";
import { assignRider, getRiders, skipRiderAssign, unassignRider } from "../../https";
import { isFinished, isReady } from "../../constants/orderStatus";

/**
 * The store's own delivery riders on a delivery order (KnotKitchen Rider app).
 *
 *   AssignRiderModal  "Assign Rider for Delivery?" when a delivery order is
 *                     Ready: pick an online rider, or Skip / Assign Later.
 *   RiderPanel        the rider and where they are, on the order's details,
 *                     with Assign / Change / Remove.
 *
 * The server decides who is eligible and that two tills can't both win;
 * this only shows it.
 */

export const RIDER_STAGE = {
  assigned: { label: "Assigned", sub: "Waiting for the rider to accept", fg: "#B45309", bg: "#FFFBEB", dot: "🟡" },
  accepted: { label: "Accepted", sub: "Rider is on the way to pick up", fg: "#15803D", bg: "#F0FDF4", dot: "🟢" },
  on_the_way: { label: "On the Way", sub: "Out with the customer's order", fg: "#C2410C", bg: "#FFF7ED", dot: "🟠" },
  arrived: { label: "Arrived", sub: "At the customer", fg: "#1D4ED8", bg: "#EFF6FF", dot: "🔵" },
  delivered: { label: "Delivered", sub: "Handed over", fg: "#15803D", bg: "#F0FDF4", dot: "🟢" },
  cancelled: { label: "Cancelled", sub: "The order was cancelled", fg: "#B91C1C", bg: "#FEF2F2", dot: "🔴" },
};

const OPEN = ["assigned", "accepted", "on_the_way", "arrived"];
export const riderOn = (order) => (order?.delivery?.riderId && OPEN.includes(order.delivery.status) ? order.delivery : null);

const errText = (e, fallback) => e?.response?.data?.message || fallback;

function Overlay({ onClose, children, labelledBy }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // On document.body: a page that makes its own layer can't put a dialog under its notices.
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby={labelledBy} className="relative w-full sm:max-w-[460px] max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl">
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Assign Rider for Delivery? */
export function AssignRiderModal({ order, onClose, title = "Assign Rider for Delivery?" }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState("");
  const riders = useQuery({ queryKey: ["riders", "active"], queryFn: () => getRiders(), select: (r) => r.data?.data?.riders || [], refetchInterval: 20_000 });
  const current = riderOn(order);

  const done = () => {
    qc.invalidateQueries({ queryKey: ["orders"] });
    qc.invalidateQueries({ queryKey: ["riders"] });
    onClose();
  };
  const assign = useMutation({
    mutationFn: () => assignRider({ orderId: order._id, riderId: picked }),
    onSuccess: () => {
      const name = riders.data?.find((r) => r.id === picked)?.name || "the rider";
      enqueueSnackbar(`Order #${order.orderNumber} sent to ${name}. They've been notified.`, { variant: "success" });
      done();
    },
    onError: (e) => {
      enqueueSnackbar(errText(e, "Couldn't assign the rider."), { variant: "error" });
      riders.refetch();
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
  const skip = useMutation({
    mutationFn: () => skipRiderAssign(order._id),
    onSuccess: () => {
      enqueueSnackbar("Ready: rider not assigned. Assign one from the order any time.", { variant: "info" });
      done();
    },
    onError: () => onClose(),
  });

  const list = riders.data || [];
  // Online and free first, then online and busy, then offline.
  const rank = (r) => (r.eligible ? (r.activeCount ? 1 : 0) : 2);
  const sorted = [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const a = order?.deliveryAddress || {};

  return (
    <Overlay onClose={onClose} labelledBy="assign-rider-title">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 shrink-0 rounded-2xl bg-[#FFF1EA] flex items-center justify-center text-[22px]" aria-hidden="true">🚴</span>
          <div className="min-w-0">
            <p className="text-[12px] font-extrabold uppercase tracking-wider text-[#C2410C]">Delivery Ready</p>
            <h2 id="assign-rider-title" className="text-[19px] font-extrabold text-[#0F172A] leading-tight">{title}</h2>
          </div>
        </div>

        <div className="mt-3 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] p-3 text-[13.5px] text-[#334155] space-y-0.5">
          <p className="font-extrabold text-[#0F172A]">Order #{order.orderNumber}</p>
          <p><span className="text-[#94A3B8]">Customer:</span> {order.customerDetails?.name || "—"}</p>
          <p className="leading-snug"><span className="text-[#94A3B8]">Address:</span> {[a.line2, a.line1 || order.customerDetails?.address, a.city].filter(Boolean).join(", ") || "—"}</p>
        </div>

        {current ? (
          <p className="mt-3 text-[13px] font-bold text-[#B45309]">
            Now with {current.riderName} ({RIDER_STAGE[current.status]?.label}). Pick someone else to reassign before they accept.
          </p>
        ) : null}

        <p className="mt-4 mb-2 text-[13px] font-extrabold text-[#0F172A]">Choose a rider</p>
        {riders.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => <div key={i} className="h-[60px] rounded-2xl bg-[#F1F5F9] animate-pulse" />)}
          </div>
        ) : riders.isError ? (
          <p className="text-[13.5px] text-[#B91C1C] font-bold">{errText(riders.error, "Couldn't load riders.")}</p>
        ) : sorted.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#CBD5E1] p-4 text-center">
            <p className="text-[14px] font-extrabold text-[#0F172A]">No riders yet</p>
            <p className="text-[12.5px] text-[#64748B] mt-1">Add riders in Settings &gt; Delivery Riders.</p>
          </div>
        ) : (
          <ul className="space-y-2" role="radiogroup" aria-label="Riders">
            {sorted.map((r) => {
              const mine = current?.riderId === r.id;
              const can = r.eligible && !mine;
              const on = picked === r.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={!can}
                    onClick={() => setPicked(r.id)}
                    className={`w-full min-h-[60px] flex items-center gap-3 px-3.5 py-2.5 rounded-2xl border-2 text-left transition-colors ${
                      on ? "border-[#FD5302] bg-[#FFF6F0]" : "border-[#E2E8F0] bg-white"
                    } ${can ? "hover:border-[#FDBA8C]" : "opacity-55 cursor-not-allowed"}`}
                  >
                    <span className={`w-5 h-5 rounded-full border-2 shrink-0 ${on ? "border-[#FD5302] bg-[#FD5302] shadow-[inset_0_0_0_3px_#fff]" : "border-[#CBD5E1]"}`} aria-hidden="true" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14.5px] font-extrabold text-[#0F172A] truncate">{r.name}</span>
                      <span className="block text-[12.5px] font-semibold text-[#64748B]">
                        {r.online ? "🟢 Online" : "⚪ Offline"}
                        {" · "}
                        {mine ? "Has this order" : r.activeCount ? `On Delivery (${r.activeCount})` : r.online ? "Available" : "Not taking orders"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => (current ? onClose() : skip.mutate())}
            disabled={skip.isPending}
            className="h-[50px] rounded-2xl border border-[#E2E8F0] bg-white text-[#334155] text-[14px] font-extrabold hover:bg-[#F8FAFC]"
          >
            {current ? "Close" : "Skip / Assign Later"}
          </button>
          <button
            type="button"
            onClick={() => assign.mutate()}
            disabled={!picked || assign.isPending}
            className="h-[50px] rounded-2xl bg-[#FD5302] text-white text-[14px] font-extrabold hover:bg-[#D64502] disabled:opacity-40"
          >
            {assign.isPending ? "Assigning…" : "Assign Rider"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** The rider on this delivery order, in the order's details. */
export function RiderPanel({ order, onAssign }) {
  const qc = useQueryClient();
  const d = order?.delivery;
  const live = riderOn(order);
  const unassign = useMutation({
    mutationFn: () => unassignRider(order._id),
    onSuccess: () => {
      enqueueSnackbar("Rider removed from this order.", { variant: "info" });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["riders"] });
    },
    onError: (e) => enqueueSnackbar(errText(e, "Couldn't remove the rider."), { variant: "error" }),
  });
  const s = d?.status ? RIDER_STAGE[d.status] : null;
  const rejected = !live && d?.rejections?.length ? d.rejections[d.rejections.length - 1] : null;
  const finished = isFinished(order.orderStatus);

  return (
    <div className="mt-3 rounded-2xl border border-[#E2E8F0] p-3">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 shrink-0 rounded-xl bg-[#FFF1EA] flex items-center justify-center text-[18px]" aria-hidden="true">🚴</span>
        <div className="flex-1 min-w-0">
          <p className="text-[11.5px] font-extrabold uppercase tracking-wider text-[#94A3B8]">Rider</p>
          {d?.riderName && s ? (
            <>
              <p className="text-[14.5px] font-extrabold text-[#0F172A] truncate">{d.riderName}</p>
              <span className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-full text-[11.5px] font-extrabold" style={{ color: s.fg, background: s.bg }}>
                {s.dot} {s.label}
              </span>
            </>
          ) : (
            <p className="text-[13.5px] font-bold text-[#64748B]">{finished ? "No rider" : isReady(order.orderStatus) ? "Ready — Rider Not Assigned" : "No rider yet"}</p>
          )}
        </div>
        {!finished ? (
          <div className="flex flex-col gap-1.5 shrink-0">
            {!live || live.status === "assigned" ? (
              <button type="button" onClick={onAssign} className="h-[36px] px-3 rounded-xl bg-[#FD5302] text-white text-[12.5px] font-extrabold hover:bg-[#D64502]">
                {live ? "Change" : "Assign Rider"}
              </button>
            ) : null}
            {live && live.status !== "delivered" ? (
              <button
                type="button"
                disabled={unassign.isPending}
                onClick={() => window.confirm(`Take this order off ${live.riderName}? They'll be told.`) && unassign.mutate()}
                className="h-[32px] px-3 rounded-xl border border-[#E2E8F0] text-[#B91C1C] text-[12px] font-bold hover:bg-[#FEF2F2]"
              >
                Remove
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {s && live ? <p className="text-[12px] text-[#64748B] mt-1.5">{s.sub}</p> : null}
      {rejected ? (
        <p className="text-[12px] font-bold text-[#B91C1C] mt-1.5">
          {rejected.riderName} declined: {rejected.reason}
          {rejected.note ? ` (“${rejected.note}”)` : ""}
        </p>
      ) : null}
    </div>
  );
}
