import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "../api.js";
import { useApi, Badge, ago, when, Err, useAction, Field } from "../ui.jsx";

export default function Enrollment() {
  const stores = useApi("/stores");
  const policies = useApi("/policies");
  const tokens = useApi("/enrollment/tokens", { interval: 15000 });
  const attempts = useApi("/enrollment/attempts?limit=20", { interval: 15000 });
  const agent = useApi("/enrollment/agent");
  const [form, setForm] = useState({ storeId: "", groupId: "", policyId: "", deviceName: "", mode: "single", count: 10, ttlHours: 24, wifiSsid: "", wifiSecurity: "WPA", wifiPassword: "" });
  const groups = useApi(form.storeId ? `/groups?storeId=${form.storeId}` : null);
  const [created, setCreated] = useState(null);
  const [full, setFull] = useState(false);
  const act = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const create = async (e) => {
    e.preventDefault();
    const r = await act.run(() => api.post("/enrollment/tokens", {
      storeId: form.storeId, groupId: form.groupId || undefined, policyId: form.policyId || undefined,
      deviceName: form.deviceName, mode: form.mode, count: Number(form.count), ttlHours: Number(form.ttlHours),
      wifi: form.wifiSsid ? { ssid: form.wifiSsid, security: form.wifiSecurity, password: form.wifiPassword } : undefined,
    }));
    const qr = await QRCode.toDataURL(r.qrPayload, { errorCorrectionLevel: "M", margin: 2, width: 720 });
    setCreated({ ...r, qr });
    setFull(true);
    tokens.reload();
  };

  const revoke = async (id) => {
    if (!window.confirm("Revoke this token? Tablets that have not scanned it yet will be refused.")) return;
    await api.post(`/enrollment/tokens/${id}/revoke`);
    tokens.reload();
  };

  return (
    <>
      <div className="top no-print"><h1>Enrollment</h1><button className="btn" onClick={() => window.print()}>Print setup card</button></div>
      {!agent.data?.agent && agent.data && (
        <div className="card err no-print">No agent APK is published. Build the agent and copy it to server/storage/agent/kk-agent.apk (scripts/build-agent.sh does both), or set AGENT_APK_URL.</div>
      )}
      <div className="grid two no-print">
        <form className="card" onSubmit={(e) => create(e).catch(() => {})}>
          <h2>Generate enrollment QR</h2>
          <div className="form">
            <Field label="Store *">
              <select required value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value, groupId: "" })}>
                <option value="">Choose a store…</option>
                {stores.data?.items?.map((s) => <option key={s._id} value={s._id}>{s.name}{s.kkStoreId ? ` (${s.kkStoreId})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Group">
              <select value={form.groupId} onChange={set("groupId")}><option value="">None</option>{groups.data?.items?.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}</select>
            </Field>
            <Field label="Policy (device level)">
              <select value={form.policyId} onChange={set("policyId")}><option value="">Inherit from store/company</option>{policies.data?.items?.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
            </Field>
            <Field label="Device name"><input placeholder="e.g. Counter 1" value={form.deviceName} onChange={set("deviceName")} /></Field>
            <Field label="Type">
              <select value={form.mode} onChange={set("mode")}><option value="single">Single tablet (single-use)</option><option value="batch">Batch (several tablets)</option></select>
            </Field>
            {form.mode === "batch" && <Field label="How many tablets"><input type="number" min={2} max={500} value={form.count} onChange={set("count")} /></Field>}
            <Field label="Valid for (hours)"><input type="number" min={0.25} max={336} step={0.25} value={form.ttlHours} onChange={set("ttlHours")} /></Field>
          </div>
          <h2 style={{ marginTop: 8 }}>Wi-Fi for setup (optional — not needed on Ethernet)</h2>
          <div className="form">
            <Field label="SSID"><input value={form.wifiSsid} onChange={set("wifiSsid")} /></Field>
            <Field label="Security"><select value={form.wifiSecurity} onChange={set("wifiSecurity")}><option>WPA</option><option>WEP</option><option value="NONE">Open</option></select></Field>
            <Field label="Password"><input type="password" value={form.wifiPassword} onChange={set("wifiPassword")} /></Field>
          </div>
          <p className="note">The Wi-Fi password is put in the QR only (Android needs it there) and is never stored by KKMDM. Show the QR on screen; don&apos;t print or photograph it. Use a temporary staging network where you can.</p>
          <Err error={act.error} />
          <button className="btn primary" disabled={act.busy}>Generate QR</button>
        </form>

        <div className="card">
          <h2>Last generated</h2>
          {!created && <p className="muted">Nothing yet. The QR and token are shown once; only a hash is stored.</p>}
          {created && (
            <>
              <img src={created.qr} alt="Enrollment QR" style={{ width: 240 }} />
              <div className="row"><button className="btn primary" onClick={() => setFull(true)}>Show full screen</button><Countdown until={created.expiresAt} /></div>
              <p className="muted" style={{ marginTop: 12 }}>Fallback for a tablet made Device Owner over ADB:</p>
              <pre className="mono note" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {`adb shell am start -n com.knotkitchen.mdm/.SetupActivity --es kkmdm_server ${JSON.parse(created.qrPayload)["android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE"].kkmdm_server} --es kkmdm_token ${created.token}`}
              </pre>
            </>
          )}
        </div>
      </div>

      <div className="card no-print scroll">
        <h2>Tokens</h2>
        <table><thead><tr><th>Token</th><th>Store</th><th>Device name</th><th>Policy</th><th>Uses</th><th>Expires</th><th>Created by</th><th>Status</th><th /></tr></thead>
          <tbody>{(tokens.data?.items || []).map((t) => (
            <tr key={t._id}>
              <td className="mono">{t.hint}…</td><td>{t.storeId?.name}</td><td>{t.deviceName}</td><td>{t.policyId?.name || "inherit"}</td>
              <td>{t.uses}/{t.maxUses}</td><td title={when(t.expiresAt)}>{when(t.expiresAt)}</td><td className="muted">{t.createdBy?.email}</td>
              <td><Badge v={t.status} /></td>
              <td>{t.status === "active" && <button className="btn small danger" onClick={() => revoke(t._id)}>Revoke</button>}</td>
            </tr>
          ))}</tbody></table>
      </div>

      <div className="card no-print scroll">
        <h2>Recent enrollment attempts</h2>
        <table><thead><tr><th>When</th><th>Result</th><th>Reason</th><th>Device</th><th>IP</th></tr></thead>
          <tbody>{(attempts.data?.items || []).map((a) => (
            <tr key={a._id}><td>{ago(a.at)}</td><td><Badge v={a.success ? "succeeded" : "failed"} /></td><td>{a.reason}</td><td>{a.deviceFacts?.manufacturer} {a.deviceFacts?.model} <span className="mono muted">{a.deviceFacts?.serial}</span></td><td className="mono">{a.ip}</td></tr>
          ))}</tbody></table>
      </div>

      <SetupCard />
      {full && created && <FullQr created={created} onClose={() => setFull(false)} />}
    </>
  );
}

function Countdown({ until }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((new Date(until).getTime() - now) / 1000));
  if (!s) return <Badge v="expired" />;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return <span className="muted">expires in {h ? `${h}h ` : ""}{m}m {String(sec).padStart(2, "0")}s</span>;
}

function FullQr({ created, onClose }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="qr-full" onClick={onClose}>
      <div>
        <img src={created.qr} alt="Enrollment QR" />
        <div className="count"><Countdown until={created.expiresAt} /></div>
        <div>On a factory-reset tablet: tap the Welcome screen 6 times, then scan. {created.maxUses > 1 ? `Works for ${created.maxUses} tablets.` : "Single use."}</div>
        <div style={{ color: "#666", marginTop: 8 }}>Click or press Esc to close</div>
      </div>
    </div>
  );
}

/** Printable "how to set up a tablet" card for restaurant staff and technicians. */
function SetupCard() {
  return (
    <div className="card">
      <h2>How to set up a KnotKitchen tablet</h2>
      <ol style={{ lineHeight: 1.8, fontSize: 15 }}>
        <li>Plug the tablet into power. Connect Ethernet if the tablet has it.</li>
        <li>If the tablet was used before: Settings → System → Reset → Erase all data (factory reset). Wait for the Welcome screen.</li>
        <li>On the very first Welcome screen (language selection), <b>tap the same spot 6 times</b> quickly. A QR scanner opens.</li>
        <li>If it asks for Wi-Fi first, connect to the restaurant or setup Wi-Fi.</li>
        <li>Scan the QR code shown by KnotKitchen support on their screen.</li>
        <li>Tap <b>Accept &amp; continue</b> / <b>Next</b> on the management screens. Do not add a Google account.</li>
        <li>Wait: the tablet downloads KK Agent, enrolls, installs and opens <b>KnotKitchen POS</b>. This takes about 5 minutes.</li>
        <li>Done when KnotKitchen POS is open and you cannot leave it. Tell support it is ready.</li>
      </ol>
      <p className="muted">Problems? The QR is valid for a limited time and usually once. Ask support for a new one. No QR scanner after 6 taps: the tablet is not at the first Welcome screen, or it needs a technician (ADB setup).</p>
    </div>
  );
}
