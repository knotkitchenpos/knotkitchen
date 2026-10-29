import { useState } from "react";
import { api } from "../api.js";
import { useApi, Err, useAction, Field, when, Badge } from "../ui.jsx";

export default function Admins() {
  const { data, error, reload } = useApi("/admins");
  const roles = useApi("/roles");
  const stores = useApi("/stores");
  const [f, setF] = useState({ email: "", name: "", role: "support", password: "", storeIds: [] });
  const act = useAction();

  const create = async (e) => {
    e.preventDefault();
    await act.run(() => api.post("/admins", f));
    setF({ email: "", name: "", role: "support", password: "", storeIds: [] });
    reload();
  };
  const patch = async (a, body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    await act.run(() => api.patch(`/admins/${a.id}`, body));
    reload();
  };

  return (
    <>
      <div className="top"><h1>Admin users</h1></div>
      <Err error={error || act.error} />
      <div className="card scroll">
        <table><thead><tr><th>User</th><th>Role</th><th>2FA</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
          <tbody>{(data?.items || []).map((a) => (
            <tr key={a.id}>
              <td><b>{a.email}</b><div className="muted">{a.name}</div></td>
              <td>
                <select value={a.role} onChange={(e) => patch(a, { role: e.target.value }, `Change ${a.email} to ${e.target.value}? Their sessions end.`).catch(() => {})}>
                  {roles.data?.items?.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                </select>
              </td>
              <td>{a.totpEnabled ? <Badge v="true" label="on" /> : <Badge v="warning" label="off" />}</td>
              <td className="muted">{when(a.lastLoginAt)}<div className="mono">{a.lastLoginIp}</div></td>
              <td>{a.disabled ? <Badge v="false" label="disabled" /> : <Badge v="true" label="active" />}</td>
              <td className="row">
                <button className="btn small" onClick={() => patch(a, { disabled: !a.disabled }, `${a.disabled ? "Enable" : "Disable"} ${a.email}?`).catch(() => {})}>{a.disabled ? "Enable" : "Disable"}</button>
                {a.totpEnabled && <button className="btn small" onClick={() => patch(a, { reset2fa: true }, `Reset 2FA for ${a.email}?`).catch(() => {})}>Reset 2FA</button>}
              </td>
            </tr>
          ))}</tbody></table>
      </div>
      <form className="card" onSubmit={(e) => create(e).catch(() => {})}>
        <h2>Add admin user</h2>
        <div className="form">
          <Field label="Email"><input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Role"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.data?.items?.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></Field>
          <Field label="Initial password (12+ chars, upper, lower, digit)"><input required type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        </div>
        {f.role === "store_user" && (
          <Field label="Stores this user can see">
            <select multiple size={6} value={f.storeIds} onChange={(e) => setF({ ...f, storeIds: [...e.target.selectedOptions].map((o) => o.value) })}>
              {stores.data?.items?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
          </Field>
        )}
        <button className="btn primary" disabled={act.busy}>Create</button>
      </form>
      <div className="card">
        <h2>What each role can do</h2>
        <table><tbody>{(roles.data?.items || []).map((r) => <tr key={r.key}><td><b>{r.name}</b></td><td className="mono" style={{ fontSize: 12 }}>{r.permissions.join(", ")}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}
