import { useState } from "react";
import QRCode from "qrcode";
import { api } from "../api.js";
import { useApi, Err, useAction, Field } from "../ui.jsx";
import { useAuth } from "../auth.jsx";

export default function Settings() {
  const { admin, setAdmin } = useAuth();
  const { data } = useApi("/settings");
  const [tfa, setTfa] = useState(null);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", totp: "" });
  const act = useAction();
  const [msg, setMsg] = useState("");

  const setup = async () => {
    const r = await act.run(() => api.post("/auth/2fa/setup"));
    setTfa({ ...r, qr: await QRCode.toDataURL(r.otpauthUrl, { width: 220 }) });
  };
  const enable = async () => {
    await act.run(() => api.post("/auth/2fa/enable", { totp: code }));
    setTfa(null);
    setAdmin({ ...admin, totpEnabled: true });
    setMsg("Two-factor sign-in is on.");
  };
  const changePw = async (e) => {
    e.preventDefault();
    await act.run(() => api.post("/auth/password", pw));
    setPw({ currentPassword: "", newPassword: "", totp: "" });
    setMsg("Password changed. Other sessions were signed out.");
  };

  return (
    <>
      <div className="top"><h1>Settings</h1></div>
      {msg && <div className="note">{msg}</div>}
      <Err error={act.error} />
      <div className="grid two">
        <div className="card">
          <h2>Server</h2>
          <dl className="kv">
            <dt>Environment</dt><dd>{data?.environment}</dd>
            <dt>Public URL (in QR)</dt><dd className="mono">{data?.publicUrl}</dd>
            <dt>Agent APK</dt><dd className="mono">{data?.agent ? `${data.agent.versionName ?? ""} (${data.agent.versionCode ?? "?"}) ${data.agent.url}` : "not published"}</dd>
            <dt>Agent signature checksum</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{data?.agent?.signatureChecksum}</dd>
            <dt>Heartbeat</dt><dd>{data?.heartbeatSeconds}s (offline after {data?.offlineAfterSeconds}s)</dd>
            <dt>Token default TTL</dt><dd>{data?.enrollTokenDefaultTtlHours} h</dd>
            <dt>Store sync</dt><dd>{data?.storeSync ? "connected to KnotKitchen" : "not configured"}</dd>
            <dt>Alert webhook</dt><dd>{data?.alertWebhook ? "set" : "not set"}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>Two-factor sign-in</h2>
          {admin.totpEnabled ? <p>On. Ask a Super Admin to reset it if you lose your phone.</p> : (
            <>
              {!tfa && <button className="btn primary" onClick={() => setup().catch(() => {})}>Set up 2FA</button>}
              {tfa && (
                <>
                  <p className="muted">Scan with Google Authenticator / Microsoft Authenticator, then enter the 6-digit code.</p>
                  <img src={tfa.qr} alt="2FA QR" />
                  <p className="mono muted">{tfa.secret}</p>
                  <div className="row"><input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /><button className="btn primary" onClick={() => enable().catch(() => {})}>Turn on</button></div>
                </>
              )}
            </>
          )}
          <h2 style={{ marginTop: 20 }}>Change password</h2>
          <form onSubmit={(e) => changePw(e).catch(() => {})}>
            <Field label="Current password"><input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
            <Field label="New password (12+ chars, upper, lower, digit)"><input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
            {admin.totpEnabled && <Field label="2FA code"><input value={pw.totp} onChange={(e) => setPw({ ...pw, totp: e.target.value })} /></Field>}
            <button className="btn">Change password</button>
          </form>
        </div>
      </div>
    </>
  );
}
