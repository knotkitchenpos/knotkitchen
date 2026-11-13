import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MdAdd, MdLock, MdCheckCircle, MdWarning, MdOpenInNew, MdLinkOff } from "react-icons/md";
import { enqueueSnackbar } from "../../utils/notify";
import { dateGB, time12 } from "../../utils";
import { partnersApi, errorMessage } from "../api";
import { StoreCredentialsFields, credentialsReady, btnPrimary } from "./Login";

const POS_URL = import.meta.env.VITE_POS_URL || "https://business.knotkitchen.com";

const ago = (d) => {
  if (!d) return "No orders yet";
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return "Last order just now";
  if (mins < 60) return `Last order ${mins} min ago`;
  if (mins < 24 * 60) return `Last order ${Math.round(mins / 60)} h ago`;
  return `Last order ${dateGB(d)}, ${time12(d)}`;
};

const LinkForm = ({ prefill, onDone, onCancel, title, note }) => {
  const [v, setV] = useState({ storeId: prefill || "", phone: "", password: "" });
  const qc = useQueryClient();
  const link = useMutation({
    mutationFn: () => partnersApi.linkStore(v),
    onSuccess: (res) => {
      qc.setQueryData(["partner-me"], (old) => (old ? { ...old, stores: res.data.data.stores } : old));
      qc.invalidateQueries({ queryKey: ["partner-dashboard"] });
      enqueueSnackbar(res.data.data.relinked ? "Store link confirmed." : "Store linked.", { variant: "success", important: true });
      onDone();
    },
    onError: (err) => enqueueSnackbar(errorMessage(err, "Could not link the store."), { variant: "error" }),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (credentialsReady(v)) link.mutate();
      }}
      className="bg-white border-2 border-[#FDBA8C] rounded-2xl p-4 sm:p-5 space-y-4"
    >
      <div>
        <h2 className="text-[16px] font-extrabold">{title}</h2>
        <p className="text-[12.5px] text-[#64748B] mt-0.5">{note}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <StoreCredentialsFields value={v} onChange={setV} autoFocus />
      </div>
      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" onClick={onCancel} className="h-12 px-5 rounded-xl border border-[#E2E8F0] text-[14px] font-bold text-[#334155] hover:bg-[#F8FAFC]">
          Cancel
        </button>
        <button type="submit" className={btnPrimary} disabled={!credentialsReady(v) || link.isPending}>
          {link.isPending ? "Checking…" : title}
        </button>
      </div>
    </form>
  );
};

const Stores = ({ me }) => {
  const [adding, setAdding] = useState(false);
  const [relink, setRelink] = useState(null);
  const qc = useQueryClient();
  const stores = me?.stores || [];

  const unlink = useMutation({
    mutationFn: (storeId) => partnersApi.unlinkStore(storeId),
    onSuccess: (res) => {
      qc.setQueryData(["partner-me"], (old) => (old ? { ...old, stores: res.data.data } : old));
      qc.invalidateQueries({ queryKey: ["partner-dashboard"] });
      enqueueSnackbar("Store unlinked.", { variant: "success", important: true });
    },
    onError: (err) => enqueueSnackbar(errorMessage(err, "Could not unlink the store."), { variant: "error" }),
  });
  const askUnlink = (s) => {
    if (window.confirm(`Unlink ${s.name} (${s.storeId})? It leaves this dashboard. The store and its POS are not changed, and you can link it again with its Owner login.`)) unlink.mutate(s.storeId);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">Stores</h1>
          <p className="text-[13px] text-[#64748B] mt-0.5">Every store you own, each linked with its own Owner login.</p>
        </div>
        {!adding && (
          <button type="button" onClick={() => { setAdding(true); setRelink(null); }} className={`${btnPrimary} inline-flex items-center gap-2`}>
            <MdAdd size={20} /> Link a store
          </button>
        )}
      </div>

      {adding && (
        <LinkForm
          title="Link a store"
          note="Enter that store's Store ID, its Owner phone and its POS password. Staff logins cannot link a store."
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      )}
      {relink && (
        <LinkForm
          prefill={relink}
          title="Confirm link"
          note={`Store ${relink}'s password was changed. Enter the new one to keep it on this dashboard.`}
          onDone={() => setRelink(null)}
          onCancel={() => setRelink(null)}
        />
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {stores.map((s) => (
          <div key={s.storeId} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 flex flex-col">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#FFF1E8] text-[#C2410C] font-extrabold flex items-center justify-center shrink-0 overflow-hidden">
                {s.logo ? <img src={s.logo} alt="" className="w-full h-full object-cover" /> : s.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-extrabold truncate">{s.name}</p>
                <p className="text-[12px] text-[#64748B]">Store {s.storeId}{s.city ? ` · ${s.city}` : ""}</p>
              </div>
              {s.linkStatus !== "ok" ? (
                <span className="inline-flex items-center gap-1 text-[11.5px] font-extrabold px-2 py-1 rounded-full bg-[#FEF3C7] text-[#92400E] shrink-0">
                  <MdWarning size={14} /> {s.linkStatus === "relink" ? "Confirm link" : "Link broken"}
                </span>
              ) : s.locked ? (
                <span className="inline-flex items-center gap-1 text-[11.5px] font-extrabold px-2 py-1 rounded-full bg-[#FEE2E2] text-[#991B1B] shrink-0">
                  <MdLock size={14} /> Locked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11.5px] font-extrabold px-2 py-1 rounded-full bg-[#DCFCE7] text-[#15803D] shrink-0">
                  <MdCheckCircle size={14} /> Live
                </span>
              )}
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2.5 text-[12.5px]">
              <div>
                <dt className="text-[#94A3B8] font-bold">Wallet</dt>
                <dd className="font-extrabold text-[14px]">{s.wallet?.label || "₹0.00"}</dd>
              </div>
              <div>
                <dt className="text-[#94A3B8] font-bold">Plan</dt>
                <dd className="font-bold truncate">{s.plan?.status === "ACTIVE" ? s.plan.name || "Active" : { EXPIRED: "Expired", CANCELLED: "Cancelled" }[s.plan?.status] || "No plan"}</dd>
              </div>
              <div>
                <dt className="text-[#94A3B8] font-bold">Renews</dt>
                <dd className="font-bold">{s.plan?.renewsOn ? dateGB(s.plan.renewsOn) : "—"}</dd>
              </div>
              <div>
                <dt className="text-[#94A3B8] font-bold">Activity</dt>
                <dd className="font-bold truncate">{ago(s.lastOrderAt)}</dd>
              </div>
            </dl>
            {s.locked && s.lockedReason && <p className="mt-3 text-[12px] text-[#991B1B] bg-[#FEF2F2] rounded-lg px-2.5 py-2">{s.lockedReason}</p>}

            <div className="mt-4 pt-3 border-t border-[#F1F5F9] flex flex-wrap gap-2 mt-auto">
              {s.linkStatus !== "ok" && (
                <button type="button" onClick={() => { setRelink(s.storeId); setAdding(false); }} className="h-9 px-3 rounded-lg bg-[#FD5302] text-white text-[12.5px] font-bold">
                  Enter new password
                </button>
              )}
              <a href={POS_URL} target="_blank" rel="noreferrer" className="h-9 px-3 rounded-lg border border-[#E2E8F0] text-[12.5px] font-bold text-[#334155] inline-flex items-center gap-1.5 hover:bg-[#F8FAFC]">
                Open POS <MdOpenInNew size={14} />
              </a>
              <button
                type="button"
                onClick={() => askUnlink(s)}
                disabled={stores.length <= 1 || unlink.isPending}
                title={stores.length <= 1 ? "Your only store cannot be unlinked" : ""}
                className="h-9 px-3 rounded-lg text-[12.5px] font-bold text-[#B91C1C] inline-flex items-center gap-1.5 hover:bg-[#FEF2F2] disabled:opacity-40 ml-auto"
              >
                <MdLinkOff size={15} /> Unlink
              </button>
            </div>
            <p className="mt-2 text-[11px] text-[#94A3B8]">Linked {dateGB(s.linkedAt)}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Stores;
