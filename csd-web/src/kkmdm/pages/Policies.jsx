import { useState } from "react";
import { api } from "../api.js";
import { useApi, Err, useAction, Field, when } from "../ui.jsx";
import { useAuth, can } from "../auth.jsx";

export default function Policies() {
  const { admin } = useAuth();
  const { data, error, reload } = useApi("/policies");
  const defaults = useApi("/policies/defaults");
  const [editing, setEditing] = useState(null);
  const editable = can(admin, "policies.edit");

  return (
    <>
      <div className="top">
        <h1>Policies</h1>
        {editable && <button className="btn primary" onClick={() => setEditing({ name: "", description: "", settings: {} })}>New policy</button>}
      </div>
      <p className="note">A policy only lists the settings it changes. Resolution: built-in defaults → company → store → group → device; the most specific value wins. Each device&apos;s Policy tab shows the effective result and where every value came from.</p>
      <Err error={error} />
      {editing ? (
        <Editor policy={editing} defaults={defaults.data?.settings} onDone={() => { setEditing(null); reload(); }} />
      ) : (
        <div className="card">
          <table><thead><tr><th>Policy</th><th>Version</th><th>Overrides</th><th>Assigned to</th><th>Updated</th><th /></tr></thead>
            <tbody>{(data?.items || []).map((p) => (
              <tr key={p._id}>
                <td><b>{p.name}</b><div className="muted">{p.description}</div></td>
                <td>v{p.version}</td>
                <td className="mono">{Object.keys(p.settings || {}).length ? JSON.stringify(p.settings).slice(0, 80) : "none (defaults)"}</td>
                <td>{p.assignments.map((a) => a.scope).join(", ") || <span className="muted">not assigned</span>}</td>
                <td className="muted">{when(p.updatedAt)}</td>
                <td>{editable && <button className="btn small" onClick={() => setEditing(p)}>Edit</button>}</td>
              </tr>
            ))}</tbody></table>
        </div>
      )}
      {defaults.data && !editing && (
        <details className="card">
          <summary>Built-in defaults (every key a policy can set)</summary>
          <textarea readOnly rows={30} value={JSON.stringify(defaults.data.settings, null, 2)} />
        </details>
      )}
    </>
  );
}

function Editor({ policy, defaults, onDone }) {
  const [name, setName] = useState(policy.name);
  const [description, setDescription] = useState(policy.description || "");
  const [text, setText] = useState(JSON.stringify(policy.settings || {}, null, 2));
  const [companyDefault, setCompanyDefault] = useState(false);
  const act = useAction();

  const save = async () => {
    let settings;
    try {
      settings = JSON.parse(text);
    } catch (e) {
      act.setError(new Error(`Settings are not valid JSON: ${e.message}`));
      return;
    }
    await act.run(async () => {
      const r = policy._id
        ? await api.put(`/policies/${policy._id}`, { name, description, settings })
        : await api.post("/policies", { name, description, settings });
      if (companyDefault) {
        const me = await api.get("/stores");
        const companyId = me.items?.[0]?.companyId;
        if (companyId) await api.put("/policy-assignments", { scope: "company", targetId: companyId, policyId: r.policy._id });
      }
    });
    onDone();
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${policy.name}? Devices fall back to the next level up.`)) return;
    await act.run(() => api.del(`/policies/${policy._id}`));
    onDone();
  };

  return (
    <div className="card">
      <h2>{policy._id ? `Edit ${policy.name} (v${policy.version} → v${policy.version + 1})` : "New policy"}</h2>
      <div className="form">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <Field label="Overrides (JSON; only the keys you want to change)">
        <textarea rows={18} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <p className="muted">Example: {'{ "kiosk": { "allowedPackages": ["com.pinelabs.masterapp"] }, "audio": { "minVolumePercent": 70 }, "restrictions": { "blockConfigWifi": true } }'}</p>
      <label className="row" style={{ marginBottom: 10 }}><input type="checkbox" checked={companyDefault} onChange={(e) => setCompanyDefault(e.target.checked)} /> Make this the company default</label>
      <Err error={act.error} />
      <div className="row">
        <button className="btn primary" disabled={act.busy} onClick={() => save().catch(() => {})}>Save</button>
        <button className="btn" onClick={onDone}>Cancel</button>
        <span className="spacer" />
        {policy._id && <button className="btn danger" onClick={() => remove().catch(() => {})}>Delete</button>}
      </div>
      {defaults && <details style={{ marginTop: 12 }}><summary>Reference: defaults</summary><textarea readOnly rows={20} value={JSON.stringify(defaults, null, 2)} /></details>}
    </div>
  );
}
