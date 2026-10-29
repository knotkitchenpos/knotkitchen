import { useState } from "react";
import { api } from "../api.js";
import { useApi, Badge, ago, when, Err, useAction, Field, Modal } from "../ui.jsx";
import { useAuth, can, useReauth } from "../auth.jsx";
import { COMMANDS } from "./commandsMeta.js";

const TABS = ["Info", "Status", "Application", "Kiosk", "Network", "Battery", "Storage", "Policy", "Activity", "Remote Actions", "Logs"];

function Kv({ rows }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v ?? "—"}</dd></div>
      ))}
    </dl>
  );
}

export default function DeviceDetail({ params }) {
  const id = params[0];
  const { admin } = useAuth();
  const [tab, setTab] = useState("Info");
  const { data, error, reload } = useApi(`/devices/${id}`, { interval: 10000 });
  const d = data?.device;
  if (error) return <Err error={error} />;
  if (!d) return <div className="muted">Loading…</div>;
  const t = d.telemetry || {};
  const outdated = data.posLatestVersionCode != null && (d.posVersionCode ?? 0) < data.posLatestVersionCode;

  return (
    <>
      <div className="top">
        <div>
          <a href="#/devices" className="muted">← Devices</a>
          <h1>{d.name} <Badge v={d.online ? "online" : "offline"} /> <Badge v={d.kiosk?.state} /></h1>
          <div className="muted">{d.storeId?.name} · last seen {ago(d.lastSeenAt)} · push {data.connected ? "connected" : "not connected"}</div>
        </div>
        <QuickActions device={d} admin={admin} onDone={reload} />
      </div>
      <div className="tabs">
        {TABS.map((x) => <button key={x} className={tab === x ? "on" : ""} onClick={() => setTab(x)}>{x}</button>)}
      </div>
      <div className="card">
        {tab === "Info" && <InfoTab d={d} admin={admin} onSaved={reload} />}
        {tab === "Status" && <Kv rows={[
          ["Online", d.online ? "yes" : "no"], ["Last seen", when(d.lastSeenAt)], ["Lifecycle", <Badge v={d.lifecycle} />],
          ["Enrolled", when(d.enrolledAt)], ["Ready (kiosk locked)", when(d.readyAt)], ["Uptime", t.uptimeSec ? `${Math.round(t.uptimeSec / 3600)} h` : null],
          ["Last boot reason", t.lastBootReason], ["Android", `${d.androidVersion} (SDK ${d.sdkInt})`], ["Security patch", d.securityPatch],
          ["Agent", `${d.agentVersion} (${d.agentVersionCode})`], ["Attestation", d.attestation ? `${d.attestation.verified ? "verified" : "not verified"} — ${d.attestation.detail}` : null],
          ["Google Play services", d.gms ? "yes" : "no"], ["Volume", t.volume != null ? `${t.volume}%` : null], ["Brightness", t.brightness],
        ]} />}
        {tab === "Application" && (
          <>
            <Kv rows={[["POS version", <>{d.posVersion} ({d.posVersionCode}) {outdated && <Badge v="warning" label="outdated" />}</>], ["Latest in repository", data.posLatestVersionCode]]} />
            <h2 style={{ marginTop: 16 }}>Installed apps</h2>
            <table><thead><tr><th>Package</th><th>Version</th><th>Code</th></tr></thead>
              <tbody>{(d.apps || []).map((a) => <tr key={a.packageName}><td className="mono">{a.packageName}</td><td>{a.versionName}</td><td>{a.versionCode}</td></tr>)}</tbody></table>
          </>
        )}
        {tab === "Kiosk" && <Kv rows={[["State", <Badge v={d.kiosk?.state} />], ["Error", d.kiosk?.error], ["Recent POS crashes", d.kiosk?.crashCount], ["Technician until", when(d.kiosk?.technicianUntil)], ["Lost mode", d.lostMode?.enabled ? `on — ${d.lostMode.message}` : "off"]]} />}
        {tab === "Network" && <Kv rows={[["Type", t.networkType], ["SSID", t.ssid || "(hidden unless location is allowed by policy)"], ["Signal", t.signal != null ? `${t.signal}/4` : null], ["IP", t.ip], ["Internet reachable", t.internetReachable ? "yes" : "no"], ["Location", d.location?.lat ? `${d.location.lat.toFixed(5)}, ${d.location.lng.toFixed(5)} (±${Math.round(d.location.accuracy)} m, ${ago(d.location.at)})` : "not collected"]]} />}
        {tab === "Battery" && <><Kv rows={[["Level", t.battery != null ? `${t.battery}%` : null], ["Charging", t.charging ? "yes" : "no"], ["Plugged", t.plugged]]} /><History id={id} field="battery" unit="%" /></>}
        {tab === "Storage" && <Kv rows={[["Free storage", t.storageFreeMb != null ? `${t.storageFreeMb} MB of ${t.storageTotalMb} MB` : null], ["Free RAM", t.ramFreeMb != null ? `${t.ramFreeMb} MB of ${t.ramTotalMb} MB` : null]]} />}
        {tab === "Policy" && <PolicyTab id={id} />}
        {tab === "Activity" && <ActivityTab id={id} />}
        {tab === "Remote Actions" && <CommandsTab id={id} device={d} admin={admin} />}
        {tab === "Logs" && <LogsTab id={id} admin={admin} />}
      </div>
    </>
  );
}

function QuickActions({ device, admin, onDone }) {
  const act = useAction();
  const reauth = useReauth();
  const [otp, setOtp] = useState(null);
  const send = async (meta) => {
    let params = meta.params || {};
    if (meta.prompt) {
      const m = window.prompt(meta.prompt, "This tablet belongs to KnotKitchen. Please return it.");
      if (m === null) return;
      params = { message: m, phone: window.prompt("Contact phone (optional)", "") || "" };
    }
    if (meta.confirm && !window.confirm(meta.confirm)) return;
    await act.run(() => reauth.guard(() => api.post(`/devices/${device._id}/commands`, { type: meta.type, params, force: meta.force })));
    onDone();
  };
  const issueOtp = async () => {
    const reason = window.prompt("Reason for technician access (logged)", "On-site support");
    if (reason === null) return;
    setOtp(await act.run(() => api.post(`/devices/${device._id}/technician-otp`, { reason })));
  };
  const quick = ["restart_app", "refresh_status", "reboot", "lock"].map((t) => COMMANDS.find((c) => c.type === t)).filter((c) => can(admin, c.perm));
  return (
    <div className="row">
      {quick.map((c) => <button key={c.type} className="btn" disabled={act.busy} onClick={() => send(c).catch(() => {})}>{c.label}</button>)}
      {can(admin, "technician.otp") && <button className="btn" onClick={() => issueOtp().catch(() => {})}>Technician PIN</button>}
      <Err error={act.error} />
      {otp && (
        <Modal title="Technician PIN" onClose={() => setOtp(null)}>
          <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: 8, textAlign: "center" }}>{otp.code}</div>
          <p className="muted">Valid until about {new Date(otp.validUntil).toLocaleTimeString("en-IN")}. On the tablet, tap the KnotKitchen title 7 times (on the screen behind the POS) or use the POS&apos;s technician menu, then enter this PIN. The kiosk re-locks by itself.</p>
        </Modal>
      )}
      {reauth.dialog}
    </div>
  );
}

function InfoTab({ d, admin, onSaved }) {
  const stores = useApi("/stores");
  const groups = useApi(d.storeId ? `/groups?storeId=${d.storeId._id}` : null);
  // A policy for this tablet alone, on top of its store's and group's.
  const canPolicy = can(admin, "policies.edit");
  const policies = useApi(can(admin, "policies.view") ? "/policies" : null);
  const devicePolicyId = policies.data?.items?.find((p) => p.assignments.some((a) => a.scope === "device" && String(a.targetId) === String(d._id)))?._id || "";
  const [policyId, setPolicyId] = useState(null); // null: unchanged
  const [form, setForm] = useState({
    name: d.name, storeId: d.storeId?._id || "", groupId: d.groupId?._id || "", lifecycle: d.lifecycle, pilot: d.pilot,
    inventory: { assetTag: d.inventory?.assetTag || "", purchaseDate: d.inventory?.purchaseDate?.slice(0, 10) || "", warrantyUntil: d.inventory?.warrantyUntil?.slice(0, 10) || "", notes: d.inventory?.notes || "" },
  });
  const act = useAction();
  const reauth = useReauth();
  const editable = can(admin, "devices.edit");
  const inv = (k) => (e) => setForm({ ...form, inventory: { ...form.inventory, [k]: e.target.value } });
  const save = () => act.run(async () => {
    await api.patch(`/devices/${d._id}`, form);
    if (canPolicy && policyId !== null && policyId !== devicePolicyId) {
      await api.put("/policy-assignments", { scope: "device", targetId: d._id, policyId: policyId || null });
    }
    onSaved();
  });
  const retire = async () => {
    const wipe = window.confirm("Retire this device. OK = also wipe it (Super Admin). Cancel = choose not to wipe.");
    if (!wipe && !window.confirm("Retire WITHOUT wiping? Its credentials are revoked and it stops reporting.")) return;
    await act.run(() => reauth.guard(() => api.post(`/devices/${d._id}/retire`, { wipe })));
    onSaved();
  };
  return (
    <>
      <div className="form">
        <Field label="Name"><input disabled={!editable} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Store">
          <select disabled={!editable} value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value, groupId: "" })}>
            {stores.data?.items?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Group">
          <select disabled={!editable} value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
            <option value="">None</option>
            {groups.data?.items?.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
          </select>
        </Field>
        <Field label="Lifecycle">
          <select disabled={!editable} value={form.lifecycle} onChange={(e) => setForm({ ...form, lifecycle: e.target.value })}>
            {["in_stock", "enrolled", "active", "in_repair"].map((x) => <option key={x}>{x}</option>)}
            {d.lifecycle === "retired" && <option>retired</option>}
          </select>
        </Field>
        {policies.data && (
          <Field label="Policy (this tablet only)">
            <select disabled={!canPolicy} value={policyId ?? devicePolicyId} onChange={(e) => setPolicyId(e.target.value)}>
              <option value="">Inherit from store/company</option>
              {policies.data.items.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Pilot device (gets rollouts first)"><select disabled={!editable} value={form.pilot ? "1" : ""} onChange={(e) => setForm({ ...form, pilot: Boolean(e.target.value) })}><option value="">No</option><option value="1">Yes</option></select></Field>
        <Field label="Asset tag"><input disabled={!editable} value={form.inventory.assetTag} onChange={inv("assetTag")} /></Field>
        <Field label="Purchase date"><input disabled={!editable} type="date" value={form.inventory.purchaseDate} onChange={inv("purchaseDate")} /></Field>
        <Field label="Warranty until"><input disabled={!editable} type="date" value={form.inventory.warrantyUntil} onChange={inv("warrantyUntil")} /></Field>
        <Field label="Notes"><input disabled={!editable} value={form.inventory.notes} onChange={inv("notes")} /></Field>
      </div>
      <Kv rows={[["Serial", <span className="mono">{d.serial}</span>], ["IMEI", d.imei], ["Model", `${d.manufacturer} ${d.model}`], ["Hardware ID", <span className="mono">{d.hardwareId}</span>], ["Device ID", <span className="mono">{d._id}</span>]]} />
      <Err error={act.error} />
      {editable && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={act.busy} onClick={() => save().catch(() => {})}>Save</button>
          {can(admin, "devices.edit") && <button className="btn" onClick={() => api.post(`/devices/${d._id}/rotate-credentials`).then(onSaved)}>Rotate device credential</button>}
          <span className="spacer" />
          {can(admin, "devices.retire") && d.lifecycle !== "retired" && <button className="btn danger" onClick={() => retire().catch(() => {})}>Retire / offboard</button>}
        </div>
      )}
      {reauth.dialog}
    </>
  );
}

function History({ id, field, unit }) {
  const { data } = useApi(`/devices/${id}/telemetry?hours=24`);
  const pts = (data?.items || []).filter((p) => p[field] != null);
  if (pts.length < 2) return <p className="muted">Not enough history yet.</p>;
  const w = 640, h = 120;
  const t0 = new Date(pts[0].ts).getTime(), t1 = new Date(pts[pts.length - 1].ts).getTime();
  const path = pts.map((p, i) => `${i ? "L" : "M"}${((new Date(p.ts).getTime() - t0) / Math.max(1, t1 - t0)) * w},${h - (p[field] / 100) * h}`).join(" ");
  return (
    <div style={{ marginTop: 14 }}>
      <div className="muted">{field} over the last 24 h ({unit})</div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ border: "1px solid var(--line)", borderRadius: 8 }}>
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />
      </svg>
    </div>
  );
}

function PolicyTab({ id }) {
  const { data, error } = useApi(`/devices/${id}/policy`);
  if (error) return <Err error={error} />;
  if (!data) return null;
  return (
    <>
      <Kv rows={[
        ["Compliant", <Badge v={data.applied?.compliant ? "true" : "false"} label={data.applied?.compliant ? "yes" : "no"} />],
        ["Expected hash", <span className="mono">{data.hash}</span>], ["Applied hash", <span className="mono">{data.applied?.appliedHash}</span>],
        ["Applied at", when(data.applied?.appliedAt)], ["Errors", data.applied?.errors?.length ? data.applied.errors.join("; ") : "none"],
        ["Layers", data.layers.map((l) => `${l.scope}: ${l.name} v${l.version}`).join("  →  ") || "built-in defaults only"],
      ]} />
      <h2 style={{ marginTop: 16 }}>Overrides (key ← where it came from)</h2>
      <table><tbody>{Object.entries(data.sources).map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td>{v}</td></tr>)}</tbody></table>
      <h2 style={{ marginTop: 16 }}>Effective settings</h2>
      <textarea readOnly rows={18} value={JSON.stringify(data.settings, null, 2)} />
    </>
  );
}

function ActivityTab({ id }) {
  const { data } = useApi(`/devices/${id}/events`, { interval: 15000 });
  return (
    <table><thead><tr><th>When</th><th>Event</th><th>Detail</th></tr></thead>
      <tbody>{(data?.items || []).map((e) => <tr key={e._id}><td className="muted" title={when(e.at)}>{ago(e.at)}</td><td><Badge v={e.type} /></td><td>{e.message}</td></tr>)}</tbody></table>
  );
}

function CommandsTab({ id, device, admin }) {
  const { data, reload } = useApi(`/devices/${id}/commands`, { interval: 5000 });
  const act = useAction();
  const reauth = useReauth();
  const run = async (meta) => {
    let params = meta.params || {};
    if (meta.prompt) {
      const m = window.prompt(meta.prompt, "This tablet belongs to KnotKitchen. Please return it.");
      if (m === null) return;
      params = { message: m, phone: window.prompt("Contact phone (optional)", "") || "" };
    }
    if (meta.confirm && !window.confirm(`${device.name}: ${meta.confirm}`)) return;
    await act.run(() => reauth.guard(() => api.post(`/devices/${id}/commands`, { type: meta.type, params, force: meta.force })));
    reload();
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        {COMMANDS.filter((c) => can(admin, c.perm)).map((c) => (
          <button key={c.type} className={`btn small ${c.danger ? "danger" : ""}`} disabled={act.busy} onClick={() => run(c).catch(() => {})}>{c.label}</button>
        ))}
      </div>
      <Err error={act.error} />
      <table><thead><tr><th>Created</th><th>Command</th><th>By</th><th>Status</th><th>Result</th></tr></thead>
        <tbody>{(data?.items || []).map((c) => (
          <tr key={c._id}>
            <td className="muted" title={when(c.createdAt)}>{ago(c.createdAt)}</td>
            <td>{c.type}{c.holdForMaintenance && <div className="muted">waits for maintenance window</div>}</td>
            <td className="muted">{c.createdByEmail}</td>
            <td><Badge v={c.status} /></td>
            <td className="mono" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>{c.error || (c.result ? JSON.stringify(c.result) : "")}</td>
          </tr>
        ))}</tbody></table>
      {reauth.dialog}
    </>
  );
}

function LogsTab({ id, admin }) {
  const { data, error } = useApi(can(admin, "logs.pull") ? `/devices/${id}/logs` : null, { interval: 10000 });
  if (!can(admin, "logs.pull")) return <p className="muted">You cannot view logs.</p>;
  return (
    <>
      <p className="muted">Use “Pull logs” or “Request bug report” under Remote Actions. Bug reports need a tap on the tablet to share (Android asks for consent).</p>
      <Err error={error} />
      <table><thead><tr><th>When</th><th>Kind</th><th>Size</th><th /></tr></thead>
        <tbody>{(data?.items || []).map((l) => (
          <tr key={l._id}><td>{when(l.createdAt)}</td><td>{l.kind}</td><td>{Math.round(l.size / 1024)} KB</td><td><a className="btn small" href={`/api/devices/${id}/logs/${l._id}/download`}>Download</a></td></tr>
        ))}</tbody></table>
    </>
  );
}
