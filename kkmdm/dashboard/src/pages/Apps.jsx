import { useRef, useState } from "react";
import { api } from "../api.js";
import { useApi, Badge, when, Err, useAction } from "../ui.jsx";
import { useAuth, can } from "../auth.jsx";

export default function Apps() {
  const { admin } = useAuth();
  const { data, error, reload } = useApi("/apps");
  const rollouts = useApi("/apps/rollouts/all", { interval: 15000 });
  const fileRef = useRef();
  const act = useAction();
  const [msg, setMsg] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const manage = can(admin, "apps.manage");
  const roll = can(admin, "rollouts.manage");

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const r = await act.run(() => api.upload(`/apps/upload?label=${encodeURIComponent(file.name)}`, file));
    setMsg(`Uploaded ${r.version.packageName} ${r.version.versionName} (${r.version.versionCode}); signature verified (${r.version.signatureScheme}).`);
    fileRef.current.value = "";
    reload();
  };
  // The server downloads it itself (GitHub release assets), so nothing has to be uploaded from a PC.
  const importApk = async () => {
    if (!importUrl.trim()) return;
    const r = await act.run(() => api.post("/apps/import", { url: importUrl.trim() }));
    setMsg(`Imported ${r.version.packageName} ${r.version.versionName} (${r.version.versionCode}); signature verified (${r.version.signatureScheme}).`);
    setImportUrl("");
    reload();
  };
  const setCurrent = async (app, v) => {
    if (!window.confirm(`Make ${v.versionName} (${v.versionCode}) the version for the WHOLE fleet now, without staging?`)) return;
    await act.run(() => api.post(`/apps/${app._id}/set-current`, { versionId: v._id }));
    reload();
  };
  const startRollout = async (v) => {
    await act.run(() => api.post("/apps/rollouts", { versionId: v._id }));
    rollouts.reload();
  };
  const rolloutAction = async (r, action, body) => {
    if (action === "rollback" && !window.confirm("Roll back? Devices on the new version go back to the stable one.")) return;
    await act.run(() => api.post(`/apps/rollouts/${r._id}/${action}`, body));
    rollouts.reload();
    reload();
  };

  return (
    <>
      <div className="top"><h1>Applications</h1></div>
      {manage && (
        <div className="card row">
          <b>Upload APK</b>
          <input type="file" accept=".apk" ref={fileRef} />
          <button className="btn primary" disabled={act.busy} onClick={() => upload().catch(() => {})}>{act.busy ? "Uploading…" : "Upload"}</button>
          <span className="muted">Package, version and signing certificate are read from the APK; the v2/v3 signature is verified.</span>
          <div className="row" style={{ width: "100%" }}>
            <b>or import from URL</b>
            <input style={{ flex: 1, minWidth: 260 }} placeholder="https://github.com/…/releases/download/…/app.apk" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} />
            <button className="btn" disabled={act.busy || !importUrl.trim()} onClick={() => importApk().catch(() => {})}>Import</button>
          </div>
          {msg && <div style={{ width: "100%" }}>{msg}</div>}
        </div>
      )}
      <Err error={error || act.error} />

      <div className="card scroll">
        <h2>Rollouts</h2>
        {!rollouts.data?.items?.length && <p className="muted">None yet. Start one from a version below: pilot devices first, then a percentage of the fleet, then everyone.</p>}
        <table><tbody>{(rollouts.data?.items || []).map((r) => (
          <tr key={r._id}>
            <td><b>{r.packageName}</b><div className="muted">{r.previousVersionId?.versionName || "none"} → {r.versionId?.versionName} ({r.versionId?.versionCode})</div></td>
            <td><Badge v={r.status} /> <span className="muted">{r.stage}{r.stage === "percent" ? ` ${r.percent}%` : ""}</span></td>
            <td>{r.progress ? `${r.progress.updated}/${r.progress.targeted} targeted updated (fleet ${r.progress.fleet})` : ""}</td>
            <td>{roll && ["running", "paused"].includes(r.status) && (
              <div className="row">
                {r.stage !== "all" && <button className="btn small" onClick={() => rolloutAction(r, "advance", { percent: r.stage === "pilot" ? 10 : Math.min(100, r.percent * 2 + 10) }).catch(() => {})}>Advance %</button>}
                {r.stage !== "all" && <button className="btn small" onClick={() => rolloutAction(r, "all").catch(() => {})}>All devices</button>}
                {r.status === "running" ? <button className="btn small" onClick={() => rolloutAction(r, "pause").catch(() => {})}>Pause</button> : <button className="btn small" onClick={() => rolloutAction(r, "resume").catch(() => {})}>Resume</button>}
                <button className="btn small primary" onClick={() => rolloutAction(r, "complete").catch(() => {})}>Complete</button>
                <button className="btn small danger" onClick={() => rolloutAction(r, "rollback").catch(() => {})}>Roll back</button>
              </div>
            )}</td>
          </tr>
        ))}</tbody></table>
        <p className="muted">Installs wait for each store&apos;s maintenance window. Rolling back a POS reinstalls the stable version (the app is removed first, since Android cannot downgrade in place).</p>
      </div>

      {(data?.items || []).map((app) => (
        <div key={app._id} className="card scroll">
          <div className="row"><h2 style={{ margin: 0 }}>{app.name}</h2><Badge v="info" label={app.role} /><span className="mono muted">{app.packageName}</span></div>
          <p className="muted mono">signing cert SHA-256 {app.signingCertSha256}</p>
          <table><thead><tr><th>Version</th><th>Code</th><th>Min SDK</th><th>Size</th><th>Installed on</th><th>Uploaded</th><th>Status</th><th /></tr></thead>
            <tbody>{app.versions.map((v) => (
              <tr key={v._id}>
                <td>{v.versionName}</td><td>{v.versionCode}</td><td>{v.minSdk}</td><td>{Math.round(v.size / 1024 / 1024 * 10) / 10} MB</td>
                <td>{v.installedOn}</td><td className="muted">{when(v.createdAt)}<br />{v.uploadedBy?.email}</td>
                <td>{String(app.currentVersionId) === String(v._id) ? <Badge v="active" label="stable" /> : ""}</td>
                <td>{roll && String(app.currentVersionId) !== String(v._id) && (
                  <div className="row">
                    <button className="btn small primary" onClick={() => startRollout(v).catch(() => {})}>Staged rollout</button>
                    <button className="btn small" onClick={() => setCurrent(app, v).catch(() => {})}>Set stable now</button>
                  </div>
                )}</td>
              </tr>
            ))}</tbody></table>
        </div>
      ))}
    </>
  );
}
