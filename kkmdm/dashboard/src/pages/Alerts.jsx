import { useState } from "react";
import { api, qs } from "../api.js";
import { useApi, Badge, ago, Err, useAction } from "../ui.jsx";
import { useAuth, can } from "../auth.jsx";

const UNITS = { offline: "minutes offline", low_storage: "MB free", low_battery: "% battery", crash_loop: "crashes in window", not_charging: "minutes" };

export default function Alerts() {
  const { admin } = useAuth();
  const [status, setStatus] = useState("open");
  const { data, error, reload } = useApi(`/alerts${qs({ status })}`, { interval: 15000 });
  const rules = useApi("/alert-rules");
  const stores = useApi("/stores");
  const act = useAction();
  const [nr, setNr] = useState({ type: "offline", storeId: "", threshold: "", businessHoursOnly: false, webhook: "", email: "" });
  const manage = can(admin, "alerts.manage");

  const ack = async (a) => {
    await api.post(`/alerts/${a._id}/ack`);
    reload();
  };
  const patchRule = async (r, body) => {
    await act.run(() => api.patch(`/alert-rules/${r._id}`, body));
    rules.reload();
  };
  const addRule = async (e) => {
    e.preventDefault();
    await act.run(() => api.post("/alert-rules", {
      type: nr.type, storeId: nr.storeId || undefined, threshold: nr.threshold ? Number(nr.threshold) : undefined,
      businessHoursOnly: nr.businessHoursOnly, channels: { webhook: nr.webhook || undefined, email: nr.email ? nr.email.split(",").map((s) => s.trim()) : [] },
    }));
    rules.reload();
  };

  return (
    <>
      <div className="top">
        <h1>Alerts</h1>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option><option value="">All</option></select>
      </div>
      <Err error={error || act.error} />
      <div className="card scroll">
        <table><thead><tr><th>Opened</th><th>Severity</th><th>Type</th><th>Device</th><th>Store</th><th>Message</th><th>Status</th><th /></tr></thead>
          <tbody>{(data?.items || []).map((a) => (
            <tr key={a._id}>
              <td>{ago(a.openedAt)}</td><td><Badge v={a.severity} /></td><td>{a.type}</td>
              <td><a href={`#/devices/${a.deviceId?._id}`}>{a.deviceId?.name}</a></td><td>{a.storeId?.name}</td><td>{a.message}</td>
              <td><Badge v={a.status} />{a.acknowledgedBy && <div className="muted">{a.acknowledgedBy}</div>}</td>
              <td>{a.status === "open" && <button className="btn small" onClick={() => ack(a)}>Acknowledge</button>}</td>
            </tr>
          ))}
          {!data?.items?.length && <tr><td colSpan={8} className="muted">Nothing here.</td></tr>}</tbody></table>
      </div>

      <div className="card scroll">
        <h2>Alert rules</h2>
        <table><thead><tr><th>Type</th><th>Store</th><th>Threshold</th><th>Business hours only</th><th>Delivery</th><th>Enabled</th><th /></tr></thead>
          <tbody>{(rules.data?.items || []).map((r) => (
            <tr key={r._id}>
              <td>{r.type}</td><td>{r.storeId?.name || "all stores"}</td>
              <td>{r.threshold ?? "default"} <span className="muted">{UNITS[r.type] || ""}</span></td>
              <td>{r.businessHoursOnly ? "yes" : "no"}</td>
              <td className="muted">{[r.channels?.webhook && "webhook", r.channels?.email?.length && `email (${r.channels.email.join(", ")})`].filter(Boolean).join(", ") || "dashboard (+ global webhook)"}</td>
              <td>{manage ? <input type="checkbox" checked={r.enabled} onChange={(e) => patchRule(r, { enabled: e.target.checked }).catch(() => {})} /> : r.enabled ? "yes" : "no"}</td>
              <td>{manage && <button className="btn small danger" onClick={() => api.del(`/alert-rules/${r._id}`).then(rules.reload)}>Delete</button>}</td>
            </tr>
          ))}</tbody></table>
        {manage && (
          <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => addRule(e).catch(() => {})}>
            <select value={nr.type} onChange={(e) => setNr({ ...nr, type: e.target.value })}>{(rules.data?.types || []).map((t) => <option key={t}>{t}</option>)}</select>
            <select value={nr.storeId} onChange={(e) => setNr({ ...nr, storeId: e.target.value })}><option value="">All stores</option>{stores.data?.items?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select>
            <input style={{ width: 100 }} placeholder="Threshold" value={nr.threshold} onChange={(e) => setNr({ ...nr, threshold: e.target.value })} />
            <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={nr.businessHoursOnly} onChange={(e) => setNr({ ...nr, businessHoursOnly: e.target.checked })} /> business hours</label>
            <input placeholder="Webhook URL (Slack/WhatsApp gateway)" value={nr.webhook} onChange={(e) => setNr({ ...nr, webhook: e.target.value })} />
            <input placeholder="Emails, comma separated" value={nr.email} onChange={(e) => setNr({ ...nr, email: e.target.value })} />
            <button className="btn primary">Add rule</button>
          </form>
        )}
      </div>
    </>
  );
}
