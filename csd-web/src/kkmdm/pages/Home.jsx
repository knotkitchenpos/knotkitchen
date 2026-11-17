import { useState } from "react";
import { go } from "../nav.js";
import { api } from "../api.js";
import { useApi, Badge, ago, Err, useAction } from "../ui.jsx";
import { useAuth, can, useReauth } from "../auth.jsx";

const TILES = [
  ["total", "Total devices", ""],
  ["online", "Online", "status=online"],
  ["offline", "Offline", "status=offline"],
  ["lowBattery", "Low battery", "lowBattery=20"],
  ["outdated", "Outdated POS", "outdated=1"],
  ["kioskErrors", "Kiosk errors", "kioskError=1"],
  ["noncompliant", "Policy non-compliant", "noncompliant=1"],
  ["pendingEnrollments", "Pending enrollments", null],
];

export default function Home() {
  const { data, error } = useApi("/summary", { interval: 15000 });
  const t = data?.totals || {};
  const { admin } = useAuth();
  const act = useAction();
  const reauth = useReauth();
  const [updated, setUpdated] = useState("");
  // Every tablet on an older POS gets the newest version in Applications (one bulk install).
  const updateOutdated = async () => {
    if (!window.confirm(`Install the latest POS on ${t.outdated} outdated tablet(s)? Each updates on its next check-in.`)) return;
    const r = await act.run(() => reauth.guard(() => api.post("/devices/update-outdated", {}))).catch(() => null); // shown by <Err error={act.error} />
    if (r) setUpdated(r.total ? `Update sent to ${r.total} tablet(s).` : "Every tablet is already up to date.");
  };
  return (
    <>
      <div className="top"><h1>Dashboard</h1><span className="muted">{data ? `${data.pushConnections} live push connections` : ""}</span></div>
      <Err error={error} />
      <Err error={act.error} />
      {can(admin, "fleet.bulk") && t.outdated > 0 && (
        <p style={{ marginBottom: 12 }}>
          <button type="button" className="primary" disabled={act.busy} onClick={updateOutdated}>Update all outdated tablets ({t.outdated})</button>
          {updated && <span className="muted" style={{ marginLeft: 10 }}>{updated}</span>}
        </p>
      )}
      <div className="grid stats" style={{ marginBottom: 16 }}>
        {TILES.map(([k, label, filter]) => (
          <a key={k} className="stat" href={filter === null ? "/mdm/enrollment" : `/mdm/devices${filter ? `?${filter}` : ""}`}>
            <div className="n">{t[k] ?? "–"}</div>
            <div className="l">{label}</div>
          </a>
        ))}
      </div>
      {reauth.dialog}
      <div className="grid two">
        <div className="card">
          <h2>Recent alerts</h2>
          {!data?.recentAlerts?.length && <div className="muted">No open alerts.</div>}
          <table>
            <tbody>
              {data?.recentAlerts?.map((a) => (
                <tr key={a._id} className="click" onClick={() => { go(`/devices/${a.deviceId?._id}`); }}>
                  <td><Badge v={a.severity} /></td>
                  <td>{a.deviceId?.name}<div className="muted">{a.storeId?.name}</div></td>
                  <td>{a.message}</td>
                  <td className="muted">{ago(a.openedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Rollouts in progress</h2>
          {!data?.rollouts?.length && <div className="muted">No rollouts running.</div>}
          {data?.rollouts?.map((r) => (
            <div key={r._id} className="row" style={{ marginBottom: 8 }}>
              <b>{r.packageName}</b> → {r.versionId?.versionName} ({r.versionId?.versionCode})
              <Badge v={r.status} /> <span className="muted">{r.stage}{r.stage === "percent" ? ` ${r.percent}%` : ""}</span>
            </div>
          ))}
          <a href="/mdm/apps" className="muted">Manage rollouts →</a>
        </div>
      </div>
    </>
  );
}
