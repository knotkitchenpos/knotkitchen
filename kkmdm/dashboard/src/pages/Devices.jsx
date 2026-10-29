import { useMemo, useState } from "react";
import { api, qs } from "../api.js";
import { useApi, Badge, ago, Err, Pager, useAction } from "../ui.jsx";
import { useAuth, can, useReauth } from "../auth.jsx";
import { COMMANDS } from "./commandsMeta.js";

const FILTERS = [
  ["status", "Status", [["", "Any"], ["online", "Online"], ["offline", "Offline"]]],
  ["lifecycle", "Lifecycle", [["", "Not retired"], ["enrolled", "Enrolled"], ["active", "Active"], ["in_repair", "In repair"], ["in_stock", "In stock"], ["retired", "Retired"]]],
];
const TOGGLES = [["lowBattery", "Low battery", "20"], ["notCharging", "Not charging", "1"], ["outdated", "Outdated app", "1"], ["kioskError", "Kiosk error", "1"], ["noncompliant", "Non-compliant", "1"], ["pilot", "Pilot", "1"]];

function readQuery() {
  const q = window.location.hash.split("?")[1] || "";
  return Object.fromEntries(new URLSearchParams(q));
}

export default function Devices() {
  const { admin } = useAuth();
  const [f, setF] = useState(() => ({ page: 1, ...readQuery() }));
  const [selected, setSelected] = useState(new Set());
  const path = `/devices${qs({ ...f, limit: 50 })}`;
  const { data, error } = useApi(path, { interval: 20000 });
  const stores = useApi("/stores");
  const act = useAction();
  const reauth = useReauth();
  const [bulkType, setBulkType] = useState("");
  const [msg, setMsg] = useState("");

  const set = (k, v) => {
    const next = { ...f, [k]: v, page: 1 };
    setF(next);
    setSelected(new Set());
  };
  const items = data?.items || [];
  const allOn = items.length > 0 && items.every((d) => selected.has(d._id));
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(items.map((d) => d._id)));
  const toggle = (id) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSelected(s);
  };

  const bulkCommands = useMemo(() => COMMANDS.filter((c) => can(admin, c.perm) && !["wipe", "release_device_owner", "locate"].includes(c.type)), [admin]);

  const runBulk = async () => {
    const meta = COMMANDS.find((c) => c.type === bulkType);
    if (!meta) return;
    const target = selected.size ? { deviceIds: [...selected] } : f.storeId ? { storeId: f.storeId } : { fleet: true };
    const scope = selected.size ? `${selected.size} selected device(s)` : f.storeId ? "every device in this store" : "the WHOLE FLEET";
    if (!window.confirm(`${meta.label} on ${scope}?`)) return;
    const r = await act.run(() => reauth.guard(() => api.post("/devices/bulk/commands", { type: bulkType, target, params: meta.params, force: meta.force })));
    setMsg(`Queued for ${r.total} device(s). Track it under Remote Actions.`);
    setSelected(new Set());
  };

  return (
    <>
      <div className="top">
        <h1>Devices</h1>
        <div className="row">
          <a className="btn" href={`/api/devices/export.csv${qs({ ...f, page: undefined })}`}>Export CSV</a>
        </div>
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <input placeholder="Search name, serial, model, asset tag" value={f.q || ""} onChange={(e) => set("q", e.target.value)} style={{ minWidth: 260 }} />
          <select value={f.storeId || ""} onChange={(e) => set("storeId", e.target.value)}>
            <option value="">All stores</option>
            {stores.data?.items?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
          {FILTERS.map(([k, , opts]) => (
            <select key={k} value={f[k] || ""} onChange={(e) => set(k, e.target.value)}>
              {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ))}
        </div>
        <div className="row">
          {TOGGLES.map(([k, label, v]) => (
            <label key={k} className="row" style={{ gap: 4, fontSize: 13 }}>
              <input type="checkbox" checked={Boolean(f[k])} onChange={(e) => set(k, e.target.checked ? v : "")} /> {label}
            </label>
          ))}
        </div>
      </div>

      {can(admin, "fleet.bulk") && (
        <div className="card row">
          <b>Bulk action</b>
          <span className="muted">{selected.size ? `${selected.size} selected` : f.storeId ? "applies to this store" : "nothing selected = whole fleet"}</span>
          <select value={bulkType} onChange={(e) => setBulkType(e.target.value)}>
            <option value="">Choose…</option>
            {bulkCommands.map((c) => <option key={c.type} value={c.type}>{c.label}</option>)}
          </select>
          <button className="btn primary" disabled={!bulkType || act.busy} onClick={() => runBulk().catch(() => {})}>Run</button>
          {msg && <span className="muted">{msg}</span>}
          <Err error={act.error} />
        </div>
      )}

      <div className="card scroll">
        <Err error={error} />
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" checked={allOn} onChange={toggleAll} /></th>
              <th>Name</th><th>Store</th><th>Status</th><th>Last seen</th><th>Battery</th><th>Android</th><th>POS</th><th>Model</th><th>Network</th><th>Kiosk</th><th>Policy</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d._id} className="click" onClick={() => { window.location.hash = `#/devices/${d._id}`; }}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(d._id)} onChange={() => toggle(d._id)} /></td>
                <td><b>{d.name}</b>{d.pilot && <> <Badge v="info" label="pilot" /></>}<div className="muted mono">{d.serial}</div></td>
                <td>{d.storeId?.name}{d.groupId && <div className="muted">{d.groupId.name}</div>}</td>
                <td><Badge v={d.online ? "online" : "offline"} /></td>
                <td className="muted">{ago(d.lastSeenAt)}</td>
                <td>{d.telemetry?.battery != null ? `${d.telemetry.battery}%${d.telemetry.charging ? " ⚡" : ""}` : "—"}</td>
                <td>{d.androidVersion}</td>
                <td>{d.posVersion || "—"}</td>
                <td>{d.manufacturer} {d.model}</td>
                <td>{d.telemetry?.networkType}{d.telemetry?.ssid ? ` · ${d.telemetry.ssid}` : ""}</td>
                <td><Badge v={d.kiosk?.state} /></td>
                <td><Badge v={d.policy?.compliant ? "true" : "false"} label={d.policy?.compliant ? "compliant" : "not compliant"} /></td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={12} className="muted">No devices match. Enroll one from the Enrollment page.</td></tr>}
          </tbody>
        </table>
        <Pager page={Number(f.page)} total={data?.total} limit={50} onPage={(p) => setF({ ...f, page: p })} />
      </div>
      {reauth.dialog}
    </>
  );
}
