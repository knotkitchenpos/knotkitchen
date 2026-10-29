import { useState } from "react";
import { api } from "../api.js";
import { useApi, Err, useAction, Modal, Field, ago } from "../ui.jsx";
import { useAuth, can } from "../auth.jsx";

export default function Stores() {
  const { admin } = useAuth();
  // Active by default, as CSD lists them; the other CSD statuses on request.
  const [status, setStatus] = useState("active");
  const { data, error, reload } = useApi(`/stores${status ? `?status=${status}` : ""}`);
  const policies = useApi(can(admin, "policies.view") ? "/policies" : null);
  const [edit, setEdit] = useState(null);
  const [syncMsg, setSyncMsg] = useState("");
  const act = useAction();

  const sync = async () => {
    const r = await act.run(() => api.post("/stores/sync"));
    setSyncMsg(r.skipped ? `Skipped: ${r.reason}` : `Synced ${r.total} KnotKitchen stores: ${r.active} active, ${r.created} new, ${r.updated} updated, ${r.archived} deleted.`);
    reload();
  };

  return (
    <>
      <div className="top">
        <h1>Stores</h1>
        {can(admin, "stores.edit") && <div className="row"><span className="muted">{syncMsg}</span><button className="btn" disabled={act.busy} onClick={() => sync().catch(() => {})}>Sync from KnotKitchen</button></div>}
      </div>
      <p className="note">Stores come from KnotKitchen&apos;s records as CSD shows them (matched on the 6-digit store ID), and follow CSD within 5 minutes; deleted stores drop out.</p>
      <div className="row" style={{ marginBottom: 8 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="suspended">Suspended</option>
          <option value="closed_temporarily">Closed temporarily</option>
          <option value="closed_until">Closed until a date</option>
          <option value="closed">Closed</option>
        </select>
        <span className="muted">{data?.items?.length ?? 0} stores</span>
      </div>
      <Err error={error || act.error} />
      <div className="card scroll">
        <table><thead><tr><th>Store</th><th>KK store ID</th><th>KK status</th><th>Devices</th><th>Policy</th><th>Maintenance window</th><th>Business hours</th><th>Synced</th><th /></tr></thead>
          <tbody>{(data?.items || []).map((s) => (
            <tr key={s._id}>
              <td><a href={`#/devices?storeId=${s._id}`}><b>{s.name}</b></a></td>
              <td className="mono">{s.kkStoreId || "—"}</td><td>{s.kkStatus || "—"}</td>
              <td>{s.online}/{s.devices} online</td><td>{s.policy?.name || <span className="muted">company default</span>}</td>
              <td>{s.maintenanceWindow?.start}–{s.maintenanceWindow?.end}</td><td>{s.businessHours?.open}–{s.businessHours?.close}</td>
              <td className="muted">{s.syncedAt ? ago(s.syncedAt) : "manual"}</td>
              <td>{can(admin, "stores.edit") && <button className="btn small" onClick={() => setEdit(s)}>Edit</button>}</td>
            </tr>
          ))}</tbody></table>
      </div>
      {edit && <EditStore store={edit} policies={policies.data?.items || []} canPolicy={can(admin, "policies.edit")} onClose={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function EditStore({ store, policies, canPolicy, onClose }) {
  const [f, setF] = useState({ mwStart: store.maintenanceWindow.start, mwEnd: store.maintenanceWindow.end, open: store.businessHours.open, close: store.businessHours.close, policyId: store.policy?._id || "" });
  const act = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    await act.run(async () => {
      await api.patch(`/stores/${store._id}`, { maintenanceWindow: { start: f.mwStart, end: f.mwEnd }, businessHours: { open: f.open, close: f.close } });
      if (canPolicy && (f.policyId || "") !== (store.policy?._id || "")) {
        await api.put("/policy-assignments", { scope: "store", targetId: store._id, policyId: f.policyId || null });
      }
    });
    onClose();
  };
  return (
    <Modal title={store.name} onClose={onClose}>
      <div className="form">
        <Field label="Maintenance window start"><input type="time" value={f.mwStart} onChange={set("mwStart")} /></Field>
        <Field label="Maintenance window end"><input type="time" value={f.mwEnd} onChange={set("mwEnd")} /></Field>
        <Field label="Business hours open"><input type="time" value={f.open} onChange={set("open")} /></Field>
        <Field label="Business hours close"><input type="time" value={f.close} onChange={set("close")} /></Field>
      </div>
      {canPolicy && (
        <Field label="Store policy">
          <select value={f.policyId} onChange={set("policyId")}><option value="">Company default</option>{policies.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select>
        </Field>
      )}
      <p className="muted">App updates, reboots and OS updates wait for the maintenance window unless forced. Offline alerts can be limited to business hours.</p>
      <Err error={act.error} />
      <button className="btn primary" disabled={act.busy} onClick={() => save().catch(() => {})}>Save</button>
    </Modal>
  );
}
