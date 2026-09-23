import React, { useCallback, useEffect, useState } from "react";
import { restaurants, errorMessage } from "../api";

/**
 * Restaurant Users for the restaurant page (ported from the retired Admin Portal).
 *
 * `canEdit` comes from the server on every response. The UI never decides for
 * itself whether the signed-in person may write: the server already knows, and
 * a second copy of that rule in the client is a copy that can drift.
 */

const Card = ({ title, action, children }) => (
  <section className="rounded-2xl border border-navy-200 bg-white p-5">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

const Note = ({ children, tone = "muted" }) => (
  <p
    className={`text-sm ${
      tone === "error" ? "text-red-600" : "text-navy-500"
    }`}
  >
    {children}
  </p>
);

/** Shared load/refresh plumbing so each panel below stays about its own data. */
const usePanel = (loader, storeId) => {
  const [state, setState] = useState({ data: null, loading: false, error: "", loaded: false });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await loader(storeId);
      setState({ data, loading: false, error: "", loaded: true });
    } catch (err) {
      setState({ data: null, loading: false, error: errorMessage(err), loaded: true });
    }
  }, [loader, storeId]);

  useEffect(() => {
    load();
  }, [load]);

  return [state, load, setState];
};

// --- Restaurant users -------------------------------------------------------

const UsersPanel = ({ storeId }) => {
  const [{ data, loading, error }, reload] = usePanel(restaurants.users, storeId);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  const update = async (userId, payload) => {
    setBusy(true);
    setSaveError("");
    try {
      await restaurants.updateUser(storeId, userId, payload);
      await reload();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Card title="POS users"><Note>Loading…</Note></Card>;
  if (error) return <Card title="POS users"><Note tone="error">{error}</Note></Card>;
  if (!data?.users?.length) return <Card title="POS users"><Note>No POS users for this store.</Note></Card>;

  return (
    <Card title="POS users">
      {saveError && <div className="mb-3"><Note tone="error">{saveError}</Note></div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-navy-500">
              <th className="pb-2 pr-3 font-semibold">Name</th>
              <th className="pb-2 pr-3 font-semibold">Phone</th>
              <th className="pb-2 pr-3 font-semibold">Role</th>
              <th className="pb-2 font-semibold">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-50">
            {data.users.map((u) => (
              <tr key={u.id}>
                <td className="py-2.5 pr-3 font-semibold text-navy-900">{u.name || "—"}</td>
                <td className="py-2.5 pr-3 tabular-nums text-navy-700">{u.phone || "—"}</td>
                <td className="py-2.5 pr-3">
                  {data.canEdit ? (
                    <select
                      value={u.role}
                      disabled={busy}
                      onChange={(e) => update(u.id, { role: e.target.value })}
                      className="rounded-lg border border-navy-200 px-2 py-1 text-xs font-semibold text-navy-800 disabled:opacity-50"
                    >
                      {data.roles.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-navy-700">{u.role}</span>
                  )}
                </td>
                <td className="py-2.5">
                  {data.canEdit ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => update(u.id, { isActive: !u.isActive })}
                      className="rounded-lg border border-navy-200 px-2.5 py-1 text-xs font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-50"
                    >
                      {u.isActive ? "Disable sign-in" : "Enable sign-in"}
                    </button>
                  ) : (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        u.isActive ? "bg-green-100 text-green-700" : "bg-navy-100 text-navy-600"
                      }`}
                    >
                      {u.isActive ? "Active" : "Disabled"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-navy-500">
        These are the restaurant&apos;s own POS logins, not KnotKitchen staff.
        Passwords cannot be set from here — the restaurant resets its own.
      </p>
    </Card>
  );
};

export { UsersPanel };
