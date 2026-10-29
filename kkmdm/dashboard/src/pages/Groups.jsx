import { useState } from "react";
import { api } from "../api.js";
import { useApi, Err, useAction } from "../ui.jsx";
import { useAuth, can } from "../auth.jsx";

export default function Groups() {
  const { admin } = useAuth();
  const { data, error, reload } = useApi("/groups");
  const stores = useApi("/stores");
  const policies = useApi(can(admin, "policies.view") ? "/policies" : null);
  const [f, setF] = useState({ storeId: "", name: "", description: "" });
  const act = useAction();
  const editable = can(admin, "groups.edit");

  const create = async (e) => {
    e.preventDefault();
    await act.run(() => api.post("/groups", f));
    setF({ ...f, name: "", description: "" });
    reload();
  };
  const policyOf = (g) => policies.data?.items?.find((p) => p.assignments.some((a) => a.scope === "group" && a.targetId === g._id));
  const assign = async (g, policyId) => {
    await act.run(() => api.put("/policy-assignments", { scope: "group", targetId: g._id, policyId: policyId || null }));
    policies.reload();
  };
  const remove = async (g) => {
    if (!window.confirm(`Delete group ${g.name}? Its devices stay in the store.`)) return;
    await act.run(() => api.del(`/groups/${g._id}`));
    reload();
  };

  return (
    <>
      <div className="top"><h1>Groups</h1></div>
      <p className="note">Optional sub-division of a store (e.g. Counter, Kitchen display, Captain tablets). A group can carry its own policy, which sits between the store and the device.</p>
      {editable && (
        <form className="card row" onSubmit={(e) => create(e).catch(() => {})}>
          <select required value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })}><option value="">Store…</option>{stores.data?.items?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select>
          <input required placeholder="Group name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input placeholder="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <button className="btn primary" disabled={act.busy}>Add group</button>
        </form>
      )}
      <Err error={error || act.error} />
      <div className="card">
        <table><thead><tr><th>Group</th><th>Store</th><th>Description</th><th>Policy</th><th /></tr></thead>
          <tbody>{(data?.items || []).map((g) => (
            <tr key={g._id}>
              <td><a href={`#/devices?groupId=${g._id}`}><b>{g.name}</b></a></td><td>{g.storeId?.name}</td><td className="muted">{g.description}</td>
              <td>
                {can(admin, "policies.edit") ? (
                  <select value={policyOf(g)?._id || ""} onChange={(e) => assign(g, e.target.value).catch(() => {})}>
                    <option value="">Inherit from store</option>
                    {policies.data?.items?.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                  </select>
                ) : (policyOf(g)?.name || "inherit")}
              </td>
              <td>{editable && <button className="btn small danger" onClick={() => remove(g).catch(() => {})}>Delete</button>}</td>
            </tr>
          ))}</tbody></table>
      </div>
    </>
  );
}
