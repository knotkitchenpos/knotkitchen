import { useState } from "react";
import { api, qs } from "../api.js";
import { useApi, Badge, ago, when, Err } from "../ui.jsx";
import { useAuth, can } from "../auth.jsx";

export default function Commands() {
  const { admin } = useAuth();
  const [status, setStatus] = useState("");
  const { data, error, reload } = useApi(`/commands${qs({ status, limit: 100 })}`, { interval: 5000 });
  const bulk = useApi("/bulk", { interval: 10000 });

  const cancel = async (c) => {
    await api.post(`/commands/${c.cmdId}/cancel`);
    reload();
  };

  return (
    <>
      <div className="top"><h1>Remote Actions</h1></div>
      <div className="card scroll">
        <h2>Bulk jobs</h2>
        <table><thead><tr><th>When</th><th>Action</th><th>Target</th><th>By</th><th>Progress</th></tr></thead>
          <tbody>{(bulk.data?.items || []).map((j) => {
            const done = (j.progress.succeeded || 0) + (j.progress.failed || 0) + (j.progress.expired || 0);
            return (
              <tr key={j._id}>
                <td>{ago(j.createdAt)}</td><td>{j.type}</td>
                <td className="muted">{j.target.fleet ? "whole fleet" : j.target.storeId ? "store" : j.target.groupId ? "group" : `${j.target.deviceIds?.length} devices`}</td>
                <td className="muted">{j.createdByEmail}</td>
                <td>{done}/{j.total} done · {Object.entries(j.progress).map(([k, n]) => `${k} ${n}`).join(", ")}</td>
              </tr>
            );
          })}</tbody></table>
      </div>
      <div className="card scroll">
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Command history</h2>
          <span className="spacer" />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {["queued", "sent", "delivered", "executing", "succeeded", "failed", "expired", "cancelled"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <Err error={error} />
        <table><thead><tr><th>Created</th><th>Device</th><th>Command</th><th>By</th><th>Status</th><th>Timeline</th><th>Result</th><th /></tr></thead>
          <tbody>{(data?.items || []).map((c) => (
            <tr key={c._id}>
              <td title={when(c.createdAt)}>{ago(c.createdAt)}</td>
              <td><a href={`#/devices/${c.deviceId?._id}`}>{c.deviceId?.name}</a></td>
              <td>{c.type}</td><td className="muted">{c.createdByEmail}</td>
              <td><Badge v={c.status} /></td>
              <td className="muted" style={{ fontSize: 12 }}>{c.history.map((h) => `${h.status} ${new Date(h.at).toLocaleTimeString("en-IN")}`).join(" → ")}</td>
              <td className="mono" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>{c.error || (c.result ? JSON.stringify(c.result) : "")}</td>
              <td>{c.status === "queued" && can(admin, "cmd.basic") && <button className="btn small" onClick={() => cancel(c)}>Cancel</button>}</td>
            </tr>
          ))}</tbody></table>
      </div>
    </>
  );
}
