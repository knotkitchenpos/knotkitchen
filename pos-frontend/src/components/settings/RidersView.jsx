import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSelector } from "react-redux";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "../../utils/notify";
import { isManager } from "../../utils/security";
import { getRider, getRiderDeliveries, getRiders, inviteRider, riderAction } from "../../https";
import { RIDER_STAGE } from "../orders/RiderAssign";

/**
 * Settings > Delivery Riders: the store's own riders (KnotKitchen Rider app,
 * knotkitchen.com/rider). Add (invite) a rider, approve the ones who signed
 * up with this Store ID, suspend, reactivate, remove, reset a PIN, and see
 * each rider's deliveries. Owner and managers only; the server checks too.
 */

const RIDER_APP = "knotkitchen.com/rider";
const STATUS = {
  active: ["Active", "#15803D", "#F0FDF4"],
  pending: ["Pending Approval", "#B45309", "#FFFBEB"],
  suspended: ["Suspended", "#B91C1C", "#FEF2F2"],
  deactivated: ["Deactivated", "#64748B", "#F1F5F9"],
};
const errText = (e, fallback) => e?.response?.data?.message || fallback;
const maskPhone = (p) => (p && p.length === 10 ? `${p.slice(0, 2)}XXXXXX${p.slice(-2)}` : p || "");
const dateOf = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const timeOf = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");

function StatusChip({ status }) {
  const [label, fg, bg] = STATUS[status] || [status, "#334155", "#F1F5F9"];
  return <span className="inline-flex px-2 py-[3px] rounded-md text-[11px] font-extrabold whitespace-nowrap" style={{ color: fg, background: bg }}>{label}</span>;
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // On document.body: a page that makes its own layer can't put a dialog under its notices.
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative w-full sm:max-w-[520px] max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 className="text-[19px] font-extrabold text-[#0F172A]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full hover:bg-[#F1F5F9] text-[20px] text-[#64748B]">×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A one-time code to hand to the rider, with how to use it. */
function CodeCard({ code, purpose, name, storeId, expiresAt }) {
  const invite = purpose === "invite";
  const text = invite
    ? `Hi ${name}, join us as a delivery rider on KnotKitchen Rider: open https://${RIDER_APP}/signup, enter Store ID ${storeId}, your mobile number and invite code ${code}.`
    : `Your KnotKitchen Rider PIN reset code is ${code}. Open https://${RIDER_APP}/forgot and set a new PIN. It works for 30 minutes.`;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        enqueueSnackbar("Copied. Paste it into WhatsApp or SMS.", { variant: "success" });
      }
    } catch {
      /* the sheet was closed */
    }
  };
  return (
    <div className="rounded-2xl border-2 border-dashed border-[#FDBA8C] bg-[#FFF7ED] p-4">
      <p className="text-[12px] font-extrabold uppercase tracking-wider text-[#C2410C]">{invite ? "Invite code" : "PIN reset code"}</p>
      <p className="text-[34px] font-black tracking-[0.25em] text-[#0F172A] mt-1">{code}</p>
      <p className="text-[12.5px] text-[#7C2D12] mt-1 leading-snug">
        {invite ? (
          <>Sign up at <b>{RIDER_APP}/signup</b> with Store ID <b>{storeId}</b> and this code.</>
        ) : (
          <>Use it in <b>{RIDER_APP}</b> &gt; Forgot PIN.</>
        )}
        {expiresAt ? ` Valid until ${timeOf(expiresAt)}.` : ""}
      </p>
      <button type="button" onClick={share} className="mt-3 h-[40px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-extrabold hover:bg-[#D64502]">
        Share with {name}
      </button>
    </div>
  );
}

function AddRider({ onClose, storeId }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState(null);
  const m = useMutation({
    mutationFn: () => inviteRider({ name: name.trim(), phone }),
    onSuccess: (res) => {
      setResult(res.data.data);
      qc.invalidateQueries({ queryKey: ["riders"] });
    },
    onError: (e) => enqueueSnackbar(errText(e, "Couldn't add the rider."), { variant: "error" }),
  });
  return (
    <Modal title={result ? "Rider invited" : "Add Rider"} onClose={onClose}>
      {result ? (
        <>
          <CodeCard code={result.code} purpose="invite" name={result.rider.name} storeId={storeId} expiresAt={result.expiresAt} />
          <button type="button" onClick={onClose} className="mt-4 w-full h-[46px] rounded-xl border border-[#E2E8F0] text-[14px] font-extrabold text-[#334155]">Done</button>
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <label className="block">
            <span className="text-[12.5px] font-bold text-[#334155]">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="mt-1 w-full h-[46px] px-3 rounded-xl border border-[#E2E8F0] text-[14px] focus:outline-none focus:border-[#FD5302]" placeholder="e.g. Rahul" />
          </label>
          <label className="block">
            <span className="text-[12.5px] font-bold text-[#334155]">Phone Number</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" className="mt-1 w-full h-[46px] px-3 rounded-xl border border-[#E2E8F0] text-[14px] focus:outline-none focus:border-[#FD5302]" placeholder="10-digit mobile" />
          </label>
          <button type="submit" disabled={m.isPending || name.trim().length < 2 || phone.length !== 10} className="w-full h-[48px] rounded-xl bg-[#FD5302] text-white text-[14px] font-extrabold hover:bg-[#D64502] disabled:opacity-40">
            {m.isPending ? "Adding…" : "Add Rider & get code"}
          </button>
        </form>
      )}
    </Modal>
  );
}

function RiderProfile({ id, onClose, storeId }) {
  const qc = useQueryClient();
  const [days, setDays] = useState(7);
  const [code, setCode] = useState(null);
  const [suspending, setSuspending] = useState(false);
  const [note, setNote] = useState("");
  const profile = useQuery({ queryKey: ["riders", "one", id], queryFn: () => getRider(id), select: (r) => r.data.data });
  const history = useQuery({ queryKey: ["riders", "history", id, days], queryFn: () => getRiderDeliveries(id, days), select: (r) => r.data.data.deliveries });
  const act = useMutation({
    mutationFn: ({ action, body }) => riderAction(id, action, body),
    onSuccess: (res, { action }) => {
      qc.invalidateQueries({ queryKey: ["riders"] });
      if (action === "reset-pin") return setCode(res.data.data);
      setSuspending(false);
      const released = res.data.data?.released;
      const msg = { approve: "Rider approved. They've been notified.", reactivate: "Rider reactivated.", suspend: "Rider suspended.", deactivate: "Rider removed and signed out." }[action];
      enqueueSnackbar(`${msg}${released ? ` ${released} unstarted delivery(s) are back with you to reassign.` : ""}`, { variant: "success" });
      if (action === "deactivate") onClose();
    },
    onError: (e) => enqueueSnackbar(errText(e, "Couldn't update the rider."), { variant: "error" }),
  });
  const r = profile.data?.rider;
  const stats = profile.data?.stats;
  const btn = "h-[40px] px-3.5 rounded-xl text-[13px] font-extrabold disabled:opacity-40";

  return (
    <Modal title={r ? r.name : "Rider"} onClose={onClose}>
      {profile.isLoading ? (
        <div className="h-40 rounded-2xl bg-[#F1F5F9] animate-pulse" />
      ) : profile.isError ? (
        <p className="text-[#B91C1C] font-bold">{errText(profile.error, "Couldn't load this rider.")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={r.status} />
            {r.status === "active" ? <span className="text-[12.5px] font-bold text-[#64748B]">{r.online ? "🟢 Online" : "⚪ Offline"}</span> : null}
          </div>
          {r.status === "suspended" && r.statusNote ? <p className="mt-2 text-[13px] text-[#B91C1C]">“{r.statusNote}”</p> : null}
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
            {[
              ["Phone", r.phone],
              ["Joined", dateOf(r.joinedAt)],
              ["Last seen", timeOf(r.lastSeenAt)],
              ["Delivered (30 days)", stats.delivered30],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-2.5">
                <dt className="text-[11.5px] font-bold text-[#94A3B8]">{k}</dt>
                <dd className="font-extrabold text-[#0F172A] truncate">{v}</dd>
              </div>
            ))}
          </dl>
          {stats.open.length ? (
            <p className="mt-2 text-[12.5px] font-bold text-[#C2410C]">
              On now: {stats.open.map((o) => `#${o.orderNumber} (${RIDER_STAGE[o.status]?.label})`).join(", ")}
            </p>
          ) : null}

          {code ? (
            <div className="mt-4">
              <CodeCard code={code.code} purpose={code.purpose} name={r.name} storeId={storeId} expiresAt={code.expiresAt} />
            </div>
          ) : null}

          {suspending ? (
            <div className="mt-4 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-3">
              <label className="block text-[12.5px] font-bold text-[#7F1D1D]">
                Reason (the rider sees this)
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className="mt-1 w-full h-[42px] px-3 rounded-xl border border-[#FECACA] bg-white text-[14px]" placeholder="e.g. Late deliveries this week" />
              </label>
              <div className="mt-2 flex gap-2">
                <button type="button" className={`${btn} border border-[#E2E8F0] bg-white text-[#334155]`} onClick={() => setSuspending(false)}>Cancel</button>
                <button type="button" disabled={act.isPending} className={`${btn} bg-[#DC2626] text-white`} onClick={() => act.mutate({ action: "suspend", body: { note } })}>Suspend</button>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              {r.status === "pending" ? (
                <button type="button" disabled={act.isPending || !r.hasPin} className={`${btn} bg-[#16A34A] text-white`} onClick={() => act.mutate({ action: "approve" })}>
                  Approve Rider
                </button>
              ) : null}
              {r.status === "active" ? <button type="button" className={`${btn} border border-[#FECACA] text-[#B91C1C]`} onClick={() => setSuspending(true)}>Suspend</button> : null}
              {["suspended", "deactivated"].includes(r.status) && r.hasPin ? (
                <button type="button" disabled={act.isPending} className={`${btn} bg-[#16A34A] text-white`} onClick={() => act.mutate({ action: "reactivate" })}>Reactivate</button>
              ) : null}
              {r.status !== "deactivated" ? (
                <button type="button" disabled={act.isPending} className={`${btn} border border-[#E2E8F0] text-[#334155]`} onClick={() => act.mutate({ action: "reset-pin" })}>
                  {r.hasPin ? "Reset PIN" : "New invite code"}
                </button>
              ) : null}
              {r.status !== "deactivated" ? (
                <button
                  type="button"
                  disabled={act.isPending}
                  className={`${btn} border border-[#E2E8F0] text-[#B91C1C]`}
                  onClick={() => window.confirm(`Remove ${r.name}? They'll be signed out and can't sign in until you reactivate them.`) && act.mutate({ action: "deactivate" })}
                >
                  {r.status === "pending" ? "Decline" : "Remove"}
                </button>
              ) : null}
            </div>
          )}
          {r.status === "pending" && !r.hasPin ? <p className="mt-2 text-[12px] text-[#64748B]">Invited: waiting for {r.name} to sign up with the code.</p> : null}

          <div className="mt-5 flex items-center justify-between">
            <h3 className="text-[14px] font-extrabold text-[#0F172A]">Delivery History</h3>
            <div className="flex gap-1" role="radiogroup" aria-label="Period">
              {[1, 7, 30, 90].map((d) => (
                <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={`h-[30px] px-2.5 rounded-lg text-[12px] font-bold ${days === d ? "bg-[#0F172A] text-white" : "bg-[#F1F5F9] text-[#475569]"}`}>
                  {d === 1 ? "Today" : `${d}d`}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            {history.isLoading ? (
              <div className="h-16 rounded-xl bg-[#F1F5F9] animate-pulse" />
            ) : (history.data || []).length ? (
              history.data.map((h) => (
                <div key={h.orderId} className="flex items-center gap-3 rounded-xl border border-[#E2E8F0] px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-extrabold text-[#0F172A]">#{h.orderNumber} · {h.customer || "Customer"}</p>
                    <p className="text-[11.5px] text-[#64748B] truncate">{timeOf(h.assignedAt)}{h.area ? ` · ${h.area}` : ""}{h.minutes ? ` · ${h.minutes} min ride` : ""}</p>
                  </div>
                  <span className="text-[12px] font-extrabold" style={{ color: RIDER_STAGE[h.status]?.fg || "#64748B" }}>{RIDER_STAGE[h.status]?.label || "Unassigned"}</span>
                  <span className="text-[13px] font-extrabold text-[#0F172A] w-[70px] text-right">₹{h.total}</span>
                </div>
              ))
            ) : (
              <p className="text-[13px] text-[#94A3B8] py-3 text-center">No deliveries in this period.</p>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

const RidersView = () => {
  const user = useSelector((s) => s.user);
  const manager = isManager(user);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);
  const q = useQuery({ queryKey: ["riders", "all"], queryFn: () => getRiders({ all: true }), select: (r) => r.data.data.riders, enabled: manager, refetchInterval: 30_000 });
  const all = q.data || [];
  const pending = all.filter((r) => r.status === "pending");
  const rest = all.filter((r) => r.status !== "pending");

  if (!manager) {
    return <p className="bg-white border border-[#E2E8F0] rounded-2xl p-5 text-[13.5px] font-bold text-[#334155]">Only the store owner or a manager can manage delivery riders.</p>;
  }

  const row = (r) => {
    const active = r.activeOrders?.[0];
    return (
      <button key={r.id} type="button" onClick={() => setOpen(r.id)} className="w-full text-left grid grid-cols-[1fr_auto] md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr] items-center gap-2 px-4 py-3 hover:bg-[#F8FAFC] border-t border-[#F1F5F9] first:border-t-0">
        <span className="min-w-0">
          <span className="block text-[14px] font-extrabold text-[#0F172A] truncate">{r.name}</span>
          <span className="block md:hidden text-[12px] text-[#64748B]">{maskPhone(r.phone)} · {r.status === "active" ? (r.online ? "🟢 Online" : "⚪ Offline") : ""} {active ? `· #${active.orderNumber}` : ""}</span>
        </span>
        <span className="hidden md:block text-[13px] text-[#334155]">{maskPhone(r.phone)}</span>
        <span className="md:block"><StatusChip status={r.status} /></span>
        <span className="hidden md:block text-[13px] font-bold text-[#334155]">{r.status === "active" ? (r.online ? "🟢 Online" : "⚪ Offline") : "—"}</span>
        <span className="hidden md:block text-[13px] font-bold text-[#334155]">{active ? `#${active.orderNumber}${r.activeCount > 1 ? ` +${r.activeCount - 1}` : ""}` : "—"}</span>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <p className="text-[13.5px] text-[#334155]">
            Riders sign up at <b>{RIDER_APP}</b> with Store ID <b>{user.storeId}</b>.
          </p>
        </div>
        <button type="button" onClick={() => setAdding(true)} className="h-[44px] px-4 rounded-xl bg-[#FD5302] text-white text-[13.5px] font-extrabold hover:bg-[#D64502] shrink-0">
          + Add Rider
        </button>
      </div>

      {q.isLoading ? (
        <div className="h-40 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      ) : q.isError ? (
        <p className="bg-white border border-[#E2E8F0] rounded-2xl p-5 text-[13.5px] font-bold text-[#B91C1C]">{errText(q.error, "Couldn't load riders.")}</p>
      ) : (
        <>
          {pending.length ? (
            <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-2xl overflow-hidden">
              <p className="px-4 pt-3 text-[12px] font-extrabold uppercase tracking-wider text-[#B45309]">Waiting for approval ({pending.length})</p>
              <div className="mt-1">{pending.map(row)}</div>
            </div>
          ) : null}
          <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
            <div className="hidden md:grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 bg-[#F8FAFC] text-[11.5px] font-extrabold uppercase tracking-wider text-[#94A3B8]">
              <span>Rider</span>
              <span>Phone</span>
              <span>Status</span>
              <span>Availability</span>
              <span>Active Delivery</span>
            </div>
            {rest.length ? (
              rest.map(row)
            ) : (
              <div className="p-8 text-center">
                <p className="text-[28px]" aria-hidden="true">🛵</p>
                <p className="text-[14.5px] font-extrabold text-[#0F172A] mt-1">No riders yet</p>
              </div>
            )}
          </div>
        </>
      )}

      {adding ? <AddRider onClose={() => setAdding(false)} storeId={user.storeId} /> : null}
      {open ? <RiderProfile id={open} onClose={() => setOpen(null)} storeId={user.storeId} /> : null}
    </div>
  );
};

export default RidersView;
