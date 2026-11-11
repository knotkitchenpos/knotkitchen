import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FiBriefcase, FiLink2, FiShoppingBag, FiStar, FiTablet, FiX } from "react-icons/fi";
import { stores as storesApi, whatsapp, errorMessage } from "../api";
import { useAuth } from "../context/AuthContext";

/** Beside a WhatsApp chat: who this is, their plan, wallet, tablets and open jobs. */
const inr = (paise) => `₹${Math.floor((paise || 0) / 100).toLocaleString("en-IN")}`;
const day = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "None yet");
const seen = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : "never");

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-3 py-1 text-sm">
    <span className="text-navy-500">{label}</span>
    <span className="text-right font-medium text-navy-900">{children}</span>
  </div>
);

const JobLine = ({ j }) => (
  <li>
    <Link to={`/jobs/${j.id}`} className="block rounded-lg bg-navy-50 px-2.5 py-1.5 hover:bg-navy-100">
      <span className="block truncate text-sm font-medium text-navy-900">{j.title}</span>
      <span className="text-[11px] capitalize text-navy-500">{j.jobId} · {j.priority} · {j.status.replace("_", " ")}</span>
    </Link>
  </li>
);

const LinkStore = ({ conversationId, onLinked }) => {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return undefined; }
    const t = setTimeout(() => storesApi.search({ q: term, limit: 5 }).then((d) => setHits(d.results)).catch(() => setHits([])), 300);
    return () => clearTimeout(t);
  }, [q]);
  const link = async (storeId) => {
    try {
      await whatsapp.update(conversationId, { linkedStoreId: storeId });
      setQ("");
      setHits([]);
      onLinked();
    } catch (err) {
      setError(errorMessage(err, "Could not link the store."));
    }
  };
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Link a restaurant…" aria-label="Search a restaurant to link"
        className="w-full rounded-lg border border-navy-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500" />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {hits.length > 0 && (
        <ul className="mt-1 overflow-hidden rounded-lg border border-navy-200">
          {hits.map((s) => (
            <li key={s.storeId}>
              <button type="button" onClick={() => link(s.storeId)} className="flex w-full justify-between gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-navy-50">
                <span className="truncate">{s.restaurantName}</span>
                <span className="font-mono text-xs text-navy-500">{s.storeId}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const CustomerPanel = ({ conversationId, refreshKey, onCreateJob, onClose }) => {
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setError("");
    whatsapp.context(conversationId)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(errorMessage(err, "Could not load customer details.")));
    return () => { alive = false; };
  }, [conversationId, refreshKey, tick]);

  const unlink = async () => {
    try {
      await whatsapp.update(conversationId, { linkedStoreId: "" });
      setTick((t) => t + 1);
    } catch (err) {
      setError(errorMessage(err, "Could not remove the link."));
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-navy-700">Customer</h3>
        {onClose && <button type="button" onClick={onClose} aria-label="Close details" className="text-navy-400 hover:text-navy-700"><FiX size={18} /></button>}
      </div>
      {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      {!data && !error && <p className="text-sm text-navy-500">Loading…</p>}

      {data && (
        <>
          {data.stores.length === 0 && <p className="text-sm text-navy-500">This number is not a store owner’s.</p>}
          {data.stores.map((s) => (
            <section key={s.storeId} className="space-y-2 border-b border-navy-100 pb-3 last:border-b-0">
              <div>
                <Link to={`/stores/${s.storeId}`} className="inline-flex items-center gap-1.5 font-semibold text-navy-900 hover:text-brand-600">
                  <FiShoppingBag size={13} aria-hidden="true" /> {s.storeName}
                </Link>
                <p className="text-xs text-navy-500">{s.ownerName} · <span className="font-mono">{s.storeId}</span> · <span className="capitalize">{s.status.replace("_", " ")}</span></p>
                {s.linked && <button type="button" onClick={unlink} className="text-xs font-semibold text-navy-500 hover:text-navy-800">Remove link</button>}
              </div>
              <div>
                {s.billing && (
                  <>
                    <Row label="Plan">{s.billing.plan || "None"}{s.billing.planStatus && s.billing.planStatus !== "ACTIVE" ? ` (${s.billing.planStatus.toLowerCase()})` : ""}</Row>
                    {s.billing.periodEnd && <Row label="Renews">{day(s.billing.periodEnd)}</Row>}
                    <Row label="Wallet"><span className={s.billing.balancePaise < 20000 ? "text-red-600" : ""}>{inr(s.billing.balancePaise)}</span></Row>
                  </>
                )}
                <Row label="Last order">{day(s.lastOrderAt)}</Row>
              </div>
              {s.devices && s.devices.length > 0 && (
                <ul className="space-y-1">
                  {s.devices.map((d, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5 text-navy-800"><FiTablet size={13} className="shrink-0" aria-hidden="true" /><span className="truncate">{d.name}</span></span>
                      <span className={`shrink-0 text-xs font-semibold ${d.online ? "text-emerald-700" : "text-red-600"}`}>{d.online ? "Online" : `Offline, seen ${seen(d.lastSeenAt)}`}</span>
                    </li>
                  ))}
                </ul>
              )}
              {s.jobs.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-navy-600">Open jobs</p>
                  <ul className="space-y-1">{s.jobs.map((j) => <JobLine key={j.id} j={j} />)}</ul>
                </div>
              )}
            </section>
          ))}

          {can("stores") && !data.stores.some((s) => s.linked) && (
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-navy-600"><FiLink2 aria-hidden="true" /> Link to a restaurant</p>
              <LinkStore conversationId={conversationId} onLinked={() => setTick((t) => t + 1)} />
            </div>
          )}

          {data.chatJobs.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-navy-600">Jobs from this chat</p>
              <ul className="space-y-1">{data.chatJobs.map((j) => <JobLine key={j.id} j={j} />)}</ul>
            </div>
          )}

          {data.ratings.count > 0 && (
            <p className="flex items-center gap-1.5 text-sm text-navy-700">
              <FiStar className="text-amber-500" aria-hidden="true" /> Rated {data.ratings.average} / 5 ({data.ratings.count})
            </p>
          )}

          {data.canJobs && (
            <button type="button" onClick={() => onCreateJob(data.stores[0]?.storeId || "")}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-navy-900 px-3 py-2 text-sm font-semibold text-white hover:bg-navy-700">
              <FiBriefcase aria-hidden="true" /> Create job from this chat
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default CustomerPanel;
