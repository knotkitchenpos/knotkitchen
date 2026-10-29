import { useApi, Badge, ago, Err } from "../ui.jsx";

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
  return (
    <>
      <div className="top"><h1>Dashboard</h1><span className="muted">{data ? `${data.pushConnections} live push connections` : ""}</span></div>
      <Err error={error} />
      <div className="grid stats" style={{ marginBottom: 16 }}>
        {TILES.map(([k, label, filter]) => (
          <a key={k} className="stat" href={filter === null ? "#/enrollment" : `#/devices${filter ? `?${filter}` : ""}`}>
            <div className="n">{t[k] ?? "–"}</div>
            <div className="l">{label}</div>
          </a>
        ))}
      </div>
      <div className="grid two">
        <div className="card">
          <h2>Recent alerts</h2>
          {!data?.recentAlerts?.length && <div className="muted">No open alerts.</div>}
          <table>
            <tbody>
              {data?.recentAlerts?.map((a) => (
                <tr key={a._id} className="click" onClick={() => { window.location.hash = `#/devices/${a.deviceId?._id}`; }}>
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
          <a href="#/apps" className="muted">Manage rollouts →</a>
        </div>
      </div>
    </>
  );
}
