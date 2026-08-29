import React, { useCallback, useEffect, useState } from "react";
import { restaurants, errorMessage } from "../api";

/**
 * Menus, Tables and Restaurant Users for the restaurant page.
 *
 * These are the three capabilities the retired Admin Portal had that CSD did
 * not. Each panel loads on demand rather than with the page — a restaurant can
 * have hundreds of dishes, and most support calls never open them.
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

// --- Menus ------------------------------------------------------------------

const MenusPanel = ({ storeId }) => {
  const [{ data, loading, error }, reload] = usePanel(restaurants.menus, storeId);
  const [editing, setEditing] = useState(null); // { menuId, itemId }
  const [draft, setDraft] = useState({ name: "", price: "" });
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  const startEdit = (menuId, item) => {
    setSaveError("");
    setEditing({ menuId, itemId: item.id });
    setDraft({ name: item.name, price: String(item.price ?? "") });
  };

  const save = async () => {
    setBusy(true);
    setSaveError("");
    try {
      await restaurants.updateDish(storeId, editing.menuId, editing.itemId, {
        name: draft.name,
        price: Number(draft.price),
      });
      setEditing(null);
      await reload();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleAvailable = async (menuId, item) => {
    setBusy(true);
    setSaveError("");
    try {
      await restaurants.updateDish(storeId, menuId, item.id, { isAvailable: !item.isAvailable });
      await reload();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const togglePublish = async (menuId) => {
    setBusy(true);
    setSaveError("");
    try {
      await restaurants.toggleMenuPublish(storeId, menuId);
      await reload();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Card title="Menus"><Note>Loading…</Note></Card>;
  if (error) return <Card title="Menus"><Note tone="error">{error}</Note></Card>;
  if (!data?.menus?.length) return <Card title="Menus"><Note>No menus for this store.</Note></Card>;

  return (
    <Card title="Menus">
      {saveError && <div className="mb-3"><Note tone="error">{saveError}</Note></div>}
      <div className="space-y-4">
        {data.menus.map((menu) => (
          <div key={menu.id} className="rounded-xl border border-navy-100">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-navy-100 px-4 py-2.5">
              <div>
                <span className="text-sm font-semibold text-navy-900">{menu.name}</span>
                <span className="ml-2 text-xs text-navy-500">{menu.itemCount} items</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    menu.published ? "bg-green-100 text-green-700" : "bg-navy-100 text-navy-600"
                  }`}
                >
                  {menu.published ? "Published" : "Not published"}
                </span>
                {data.canEdit && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => togglePublish(menu.id)}
                    className="rounded-lg border border-navy-200 px-2.5 py-1 text-xs font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-50"
                  >
                    {menu.published ? "Unpublish" : "Publish"}
                  </button>
                )}
              </div>
            </div>

            <div className="divide-y divide-navy-50">
              {menu.items.map((item) => {
                const isEditing = editing?.menuId === menu.id && editing?.itemId === item.id;
                return (
                  <div key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <span
                      title={item.isVegetarian ? "Vegetarian" : "Non-vegetarian"}
                      className={`h-3 w-3 shrink-0 rounded-sm border ${
                        item.isVegetarian ? "border-green-600" : "border-red-600"
                      }`}
                    >
                      <span
                        className={`mx-auto mt-[3px] block h-1.5 w-1.5 rounded-full ${
                          item.isVegetarian ? "bg-green-600" : "bg-red-600"
                        }`}
                      />
                    </span>

                    {isEditing ? (
                      <>
                        <input
                          value={draft.name}
                          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                          className="min-w-[10rem] flex-1 rounded-lg border border-navy-200 px-2 py-1 text-sm"
                        />
                        <input
                          value={draft.price}
                          onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                          inputMode="decimal"
                          className="w-24 rounded-lg border border-navy-200 px-2 py-1 text-sm"
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={save}
                          className="rounded-lg bg-navy-900 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="text-xs font-semibold text-navy-500"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-navy-900">{item.name}</span>
                        <span className="text-sm tabular-nums text-navy-700">₹{item.price}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            item.isAvailable ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {item.isAvailable ? "Available" : "Unavailable"}
                        </span>
                        {data.canEdit && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => toggleAvailable(menu.id, item)}
                              className="rounded-lg border border-navy-200 px-2 py-1 text-xs font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-50"
                            >
                              {item.isAvailable ? "Mark unavailable" : "Mark available"}
                            </button>
                            <button
                              type="button"
                              onClick={() => startEdit(menu.id, item)}
                              className="text-xs font-semibold text-navy-600 hover:underline"
                            >
                              Edit
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {!data.canEdit && (
        <p className="mt-3 text-xs text-navy-500">
          Only an administrator can change prices, availability or publishing.
        </p>
      )}
    </Card>
  );
};

// --- Tables -----------------------------------------------------------------

const STATUS_STYLES = {
  available: "bg-green-100 text-green-700",
  occupied: "bg-blue-100 text-blue-700",
  reserved: "bg-amber-100 text-amber-700",
  cleaning: "bg-navy-100 text-navy-600",
};

const TablesPanel = ({ storeId }) => {
  const [{ data, loading, error }, reload] = usePanel(restaurants.tables, storeId);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  const update = async (tableId, payload) => {
    setBusy(true);
    setSaveError("");
    try {
      await restaurants.updateTable(storeId, tableId, payload);
      await reload();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Card title="Tables"><Note>Loading…</Note></Card>;
  if (error) return <Card title="Tables"><Note tone="error">{error}</Note></Card>;
  if (!data?.tables?.length) return <Card title="Tables"><Note>No tables for this store.</Note></Card>;

  return (
    <Card title="Tables">
      {saveError && <div className="mb-3"><Note tone="error">{saveError}</Note></div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-navy-500">
              <th className="pb-2 pr-3 font-semibold">Table</th>
              <th className="pb-2 pr-3 font-semibold">Seats</th>
              <th className="pb-2 pr-3 font-semibold">Zone</th>
              <th className="pb-2 pr-3 font-semibold">QR</th>
              <th className="pb-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-50">
            {data.tables.map((t) => (
              <tr key={t.id}>
                <td className="py-2.5 pr-3 font-semibold text-navy-900">{t.tableNumber}</td>
                <td className="py-2.5 pr-3 tabular-nums text-navy-700">{t.capacity}</td>
                <td className="py-2.5 pr-3 text-navy-700">{t.zone || "—"}</td>
                <td className="py-2.5 pr-3">
                  {data.canEdit ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => update(t.id, { qrEnabled: !t.qrEnabled })}
                      className="rounded-lg border border-navy-200 px-2 py-1 text-xs font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-50"
                    >
                      {t.qrEnabled ? "On" : "Off"}
                    </button>
                  ) : (
                    <span className="text-navy-700">{t.qrEnabled ? "On" : "Off"}</span>
                  )}
                </td>
                <td className="py-2.5">
                  {data.canEdit ? (
                    <select
                      value={t.status}
                      disabled={busy}
                      onChange={(e) => update(t.id, { status: e.target.value })}
                      className="rounded-lg border border-navy-200 px-2 py-1 text-xs font-semibold capitalize text-navy-800 disabled:opacity-50"
                    >
                      {data.statuses.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
                        STATUS_STYLES[t.status] || "bg-navy-100 text-navy-600"
                      }`}
                    >
                      {t.status}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
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

export { MenusPanel, TablesPanel, UsersPanel };
