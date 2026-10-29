import { useState } from "react";
import { api, qs } from "../api.js";
import { useApi, when, Err, Badge } from "../ui.jsx";

export default function Audit() {
  const [f, setF] = useState({ action: "", actor: "" });
  const { data, error } = useApi(`/audit${qs({ ...f, limit: 200 })}`, { interval: 20000 });
  const [verify, setVerify] = useState(null);

  return (
    <>
      <div className="top">
        <h1>Activity / Audit log</h1>
        <div className="row">
          {verify && <Badge v={verify.ok ? "true" : "false"} label={verify.ok ? `chain intact (${verify.checked} rows)` : `chain BROKEN at #${verify.brokenAtSeq}`} />}
          <button className="btn" onClick={() => api.get("/audit/verify").then(setVerify)}>Verify integrity</button>
        </div>
      </div>
      <p className="note">Every admin action and enrollment attempt. Rows are hash-chained: editing or deleting one breaks the chain, which “Verify integrity” detects.</p>
      <div className="card row">
        <input placeholder="Action prefix, e.g. command. or enrollment." value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />
        <input placeholder="Actor email" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} />
      </div>
      <Err error={error} />
      <div className="card scroll">
        <table><thead><tr><th>#</th><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>{(data?.items || []).map((r) => (
            <tr key={r._id}>
              <td className="muted">{r.seq}</td><td>{when(r.at)}</td><td>{r.actorEmail}<div className="muted">{r.actorRole}</div></td>
              <td><b>{r.action}</b></td>
              <td>{r.targetType === "device" ? <a href={`#/devices/${r.targetId}`}>device</a> : r.targetType} <span className="mono muted">{r.targetId?.slice(-6)}</span></td>
              <td className="mono" style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={JSON.stringify(r.details)}>{r.details ? JSON.stringify(r.details) : ""}</td>
              <td className="mono muted">{r.ip}</td>
            </tr>
          ))}</tbody></table>
      </div>
    </>
  );
}
