import React, { useCallback, useEffect, useState } from "react";
import { FiPlus, FiShield, FiLock, FiInfo } from "react-icons/fi";
import { staffAdmin, errorMessage, fieldErrors } from "../api";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { dtOrNever as dt } from "../lib/format";


const EMPTY = {
  fullName: "",
  phone: "",
  personalEmail: "",
  officialEmail: "",
  role: "staff",
  permissions: [],
};

/** Ready-made access sets; each is just a list of sections. */
const PRESETS = [
  { key: "full", label: "Full support", sections: [] },
  { key: "sales", label: "Sales", sections: ["stores", "whatsapp", "chat", "jobs", "health", "knowledge"] },
  { key: "support", label: "Support without billing", sections: ["stores", "search", "whatsapp", "chat", "jobs", "hardware", "eats", "devices", "health", "knowledge"] },
];
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Defined at module scope, NOT inside StaffDialog. A component declared inside
 * another component's body is a brand-new type on every render, so React
 * unmounts and remounts it — which drops focus out of the input after every
 * single keystroke.
 */
const Field = ({ label, name, form, errors, onChange, ...rest }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">{label}</span>
    <input
      name={name}
      value={form[name]}
      onChange={onChange}
      {...rest}
      className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm outline-none ${
        errors[name] ? "border-red-400" : "border-navy-200 focus:border-brand-500"
      } ${rest.disabled ? "bg-navy-50 text-navy-500" : ""}`}
    />
    {errors[name] && <span className="mt-1 block text-xs text-red-600">{errors[name]}</span>}
  </label>
);

const StaffDialog = ({ member, onClose, onSaved }) => {
  const editing = !!member;
  const [form, setForm] = useState(
    editing
      ? {
          fullName: member.fullName,
          phone: member.phone || "",
          // password is only set on create, or when the admin explicitly resets one on edit
          password: "",
          personalEmail: member.personalEmail || "",
          officialEmail: member.officialEmail || "",
          role: member.role,
          permissions: member.permissions || [],
        }
      : EMPTY
  );
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);
  const [sections, setSections] = useState([]);
  useEffect(() => { staffAdmin.sections().then(setSections).catch(() => setSections([])); }, []);
  const custom = form.permissions.length > 0 && !PRESETS.some((p) => sameSet(p.sections, form.permissions));
  const toggleSection = (key) => setForm((f) => {
    // "Full support" stores no list, so unticking one starts from every section.
    const from = f.permissions.length ? f.permissions : sections.map((s) => s.key);
    const next = from.includes(key) ? from.filter((k) => k !== key) : [...from, key];
    return { ...f, permissions: next.length === sections.length ? [] : next };
  });

  const set = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((x) => ({ ...x, [name]: undefined }));
    setBanner("");
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setBanner("");
    setErrors({});
    try {
      if (editing) {
        // password is only sent if it was set in this session (a reset).
        const { password, ...rest } = form;
        const payload = password ? { ...rest, password } : rest;
        await staffAdmin.update(member.id, payload);
        onSaved();
      } else {
        // No password: they choose one at their first sign-in with this code.
        onSaved(await staffAdmin.create(form));
      }
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      setBanner(Object.keys(fe).length ? "Please correct the highlighted fields." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const fieldProps = { form, errors, onChange: set };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div role="dialog" aria-modal="true" className="my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-bold text-navy-900">
          {editing ? `Edit ${member.staffId}` : "Add staff member"}
        </h2>

        {banner && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{banner}</p>}

        <form onSubmit={submit} className="space-y-4">
          <Field label="Full name" name="fullName" required {...fieldProps} />
          {/* Staff sign in with this number (owner, 2026-11-03). */}
          <Field
            label="Login phone number"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={10}
            pattern="[0-9]{10}"
            placeholder="10-digit mobile number"
            required={!editing || !member?.phone}
            {...fieldProps}
          />
          {editing && member.needsSetup === false ? (
            <Field
              label="New password (leave blank to keep)"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              {...fieldProps}
            />
          ) : !editing ? (
            <p className="flex items-start gap-1.5 rounded-xl bg-navy-50 p-3 text-xs text-navy-600">
              <FiInfo className="mt-0.5 shrink-0" aria-hidden="true" />
              They choose their own password at their first sign-in, using a setup code you get after saving.
            </p>
          ) : null}
          <Field label="Official email" name="officialEmail" type="email" {...fieldProps} />
          <Field label="Personal email" name="personalEmail" type="email" {...fieldProps} />

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">Role</span>
            <select name="role" value={form.role} onChange={set}
              disabled={editing && member.isPredefinedAdmin}
              className="w-full rounded-xl border border-navy-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 disabled:bg-navy-50">
              <option value="staff">CSD Staff</option>
              <option value="admin">Administrator</option>
            </select>
          </label>

          {form.role === "staff" && sections.length > 0 && (
            <fieldset>
              <legend className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">Access</legend>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p.key} type="button" onClick={() => setForm((f) => ({ ...f, permissions: p.sections }))}
                    aria-pressed={sameSet(p.sections, form.permissions)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${sameSet(p.sections, form.permissions) ? "bg-navy-900 text-white" : "bg-navy-50 text-navy-600 hover:bg-navy-100"}`}>
                    {p.label}
                  </button>
                ))}
                {custom && <span className="rounded-full bg-navy-900 px-3 py-1 text-xs font-semibold text-white">Custom</span>}
              </div>
              <div className="grid gap-1 sm:grid-cols-2">
                {sections.map((s) => {
                  const on = form.permissions.length === 0 || form.permissions.includes(s.key);
                  const last = on && form.permissions.length === 1;
                  return (
                    <label key={s.key} className="flex items-center gap-2 text-sm text-navy-800">
                      <input type="checkbox" checked={on} disabled={last} onChange={() => toggleSection(s.key)} />
                      {s.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {form.role === "admin" && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              <FiShield className="mt-0.5 shrink-0" aria-hidden="true" />
              Administrators can onboard stores, change store status, manage staff and see every report.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={busy}
              className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">
              Cancel
            </button>
            <button type="submit" disabled={busy}
              className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
              {busy ? "Saving…" : editing ? "Save changes" : "Add staff member"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/**
 * The one-time setup code, shown to the admin once (the server keeps only a
 * hash). The staff member signs in with their phone and this code, then
 * chooses their password.
 */
const SetupCodeDialog = ({ info, onClose }) => {
  const [copied, setCopied] = useState(false);
  const until = info.setupCodeExpiresAt ? dt(info.setupCodeExpiresAt) : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.setupCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="setup-code-title" className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
        <h2 id="setup-code-title" className="text-lg font-bold text-navy-900">Setup code for {info.fullName}</h2>
        <p className="mt-1 text-sm text-navy-500">{info.staffId} · {info.phone}</p>
        <p className="mt-5 font-mono text-4xl font-bold tracking-[0.3em] text-navy-900" aria-label={`Setup code ${info.setupCode.split("").join(" ")}`}>
          {info.setupCode}
        </p>
        <button type="button" onClick={copy} className="mt-3 text-sm font-semibold text-brand-600 hover:text-brand-700">
          {copied ? "Copied" : "Copy code"}
        </button>
        <p className="mt-4 text-sm text-navy-600">
          Give this code to them privately. At their first sign-in they choose <b>First time signing in?</b>, enter their phone number and this code, and set their own password.
        </p>
        {until && <p className="mt-2 text-xs text-navy-500">Valid until {until}. It is shown only now.</p>}
        <button type="button" onClick={onClose}
          className="mt-5 w-full rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500">
          Done
        </button>
      </div>
    </div>
  );
};

const StaffManagement = () => {
  const { staff: currentUser } = useAuth();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [dialog, setDialog] = useState(null); // null | {} | member
  const [codeInfo, setCodeInfo] = useState(null); // a setup code to show once
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setRows(await staffAdmin.list(q.trim() ? { q: q.trim() } : undefined));
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Could not load staff."));
    } finally {
      setBusy(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const toggleStatus = async (m) => {
    const next = m.status === "active" ? "disabled" : "active";
    try {
      await staffAdmin.update(m.id, { status: next });
      load();
    } catch (err) {
      // The server's lockout guards produce a specific message — show it.
      setError(errorMessage(err, "Could not change that account's status."));
    }
  };

  // Gone for good: signed out at once, their open jobs and WhatsApp chats go back to unassigned.
  const removeMember = async (m) => {
    if (!window.confirm(`Delete ${m.fullName} (${m.staffId})?

They are signed out at once and can no longer sign in. Their open jobs and WhatsApp chats go back to unassigned. This cannot be undone.`)) return;
    try {
      await staffAdmin.remove(m.id);
      load();
    } catch (err) {
      setError(errorMessage(err, "Could not delete that staff member."));
    }
  };

  // Their code expired or was lost before they signed in: a fresh one, shown once.
  const newSetupCode = async (m) => {
    try {
      setCodeInfo({ ...m, ...(await staffAdmin.newSetupCode(m.id)) });
      load();
    } catch (err) {
      setError(errorMessage(err, "Could not create a new setup code."));
    }
  };

  // A lost or new phone: they set two-factor sign-in up again at their next sign-in.
  const resetMfa = async (m) => {
    if (!window.confirm(`Reset two-factor sign-in for ${m.fullName}?\n\nThey are signed out and set it up again with their phone at the next sign-in. Only do this once you know it is really them asking.`)) return;
    try {
      await staffAdmin.resetMfa(m.id);
      load();
    } catch (err) {
      setError(errorMessage(err, "Could not reset two-factor sign-in."));
    }
  };

  return (
    <div className="mx-auto max-w-[1600px]">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Staff Management</h1>
        </div>
        <button type="button" onClick={() => setDialog({})}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500">
          <FiPlus aria-hidden="true" /> Add staff
        </button>
      </header>

      <input value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, Staff ID or phone…"
        aria-label="Search staff"
        className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />

      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {busy && rows.length === 0 && <p className="mt-6 text-sm text-navy-500">Loading staff…</p>}

      {rows.length > 0 && (
        <>
        {/* Phones: one card per person, so Edit, Disable and Delete are in reach without scrolling sideways. */}
        <ul className="mt-4 space-y-2.5 sm:hidden">
          {rows.map((m) => {
            const isMe = m.id === currentUser?.id;
            const locked = m.isPredefinedAdmin;
            return (
              <li key={m.id} className="rounded-2xl border border-navy-200 bg-white p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-navy-900">
                      {m.fullName}
                      {isMe && <span className="ml-1.5 text-xs font-normal text-brand-600">(you)</span>}
                    </p>
                    <p className="font-mono text-xs text-navy-500">{m.staffId}</p>
                  </div>
                  <StatusBadge status={m.status} />
                </div>
                <p className="mt-2 break-all text-sm text-navy-700">{m.phone || "No phone yet"}{m.email ? ` · ${m.email}` : ""}</p>
                {m.needsSetup && <p className="mt-1 text-xs font-medium text-amber-700">Waiting for first sign-in</p>}
                <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-navy-600">
                  {m.role === "admin" && <FiShield size={12} className="text-brand-600" aria-hidden="true" />}
                  {m.role === "admin" ? "Administrator" : "CSD Staff"}
                  {locked && <FiLock size={11} className="text-navy-400" aria-hidden="true" />}
                  <span className="text-navy-400">· Last login {dt(m.lastLoginAt)}</span>
                </p>
                <div className="mt-3 flex flex-wrap justify-end gap-x-4 gap-y-2 text-sm">
                  {m.needsSetup && m.status === "active" && (
                    <button type="button" onClick={() => newSetupCode(m)} className="font-semibold text-navy-600">
                      New setup code
                    </button>
                  )}
                  {m.mfaEnabled && !isMe && (
                    <button type="button" onClick={() => resetMfa(m)} className="font-semibold text-navy-600">
                      Reset 2FA
                    </button>
                  )}
                  {!locked && !isMe && (
                    <button type="button" onClick={() => toggleStatus(m)} className="font-semibold text-navy-600">
                      {m.status === "active" ? "Disable" : "Reactivate"}
                    </button>
                  )}
                  {!locked && !isMe && (
                    <button type="button" onClick={() => removeMember(m)} className="font-semibold text-red-600">
                      Delete
                    </button>
                  )}
                  <button type="button" onClick={() => setDialog(m)} className="font-semibold text-brand-600">
                    Edit
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-navy-200 bg-white sm:block">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-b border-navy-200 bg-navy-50 text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th scope="col" className="px-4 py-3">Staff ID</th>
                <th scope="col" className="px-4 py-3">Name</th>
                <th scope="col" className="px-4 py-3">Login phone</th>
                <th scope="col" className="px-4 py-3">Role</th>
                <th scope="col" className="px-4 py-3">Last login</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const isMe = m.id === currentUser?.id;
                const locked = m.isPredefinedAdmin;
                return (
                  <tr key={m.id} className="border-b border-navy-100 last:border-b-0 hover:bg-navy-50">
                    <td className="px-4 py-3 font-mono text-xs text-navy-700">{m.staffId}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-navy-900">
                        {m.fullName}
                        {isMe && <span className="ml-1.5 text-xs font-normal text-brand-600">(you)</span>}
                      </div>
                      {m.officialEmail && <div className="text-xs text-navy-400">{m.officialEmail}</div>}
                    </td>
                    <td className="px-4 py-3 text-navy-700">
                      <span className="block font-medium">{m.phone || <span className="text-amber-600">No phone yet</span>}</span>
                      {m.email && <span className="block text-xs text-navy-500">{m.email}</span>}
                      {m.needsSetup && <span className="block text-xs font-medium text-amber-700">Waiting for first sign-in</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-navy-700">
                        {m.role === "admin" && <FiShield size={12} className="text-brand-600" aria-hidden="true" />}
                        {m.role === "admin" ? "Administrator" : "CSD Staff"}
                        {locked && <FiLock size={11} className="text-navy-400" title="Seeded super-administrator" />}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-navy-600">{dt(m.lastLoginAt)}</td>
                    <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" onClick={() => setDialog(m)}
                        className="font-semibold text-brand-600 hover:text-brand-700">
                        Edit
                      </button>
                      {/* Hidden where the server would refuse anyway, so the
                          UI never offers an action that cannot succeed. */}
                      {m.needsSetup && m.status === "active" && (
                        <button type="button" onClick={() => newSetupCode(m)}
                          className="ml-3 font-semibold text-navy-600 hover:text-navy-900">
                          New setup code
                        </button>
                      )}
                      {m.mfaEnabled && !isMe && (
                        <button type="button" onClick={() => resetMfa(m)}
                          className="ml-3 font-semibold text-navy-600 hover:text-navy-900">
                          Reset 2FA
                        </button>
                      )}
                      {!locked && !isMe && (
                        <button type="button" onClick={() => toggleStatus(m)}
                          className="ml-3 font-semibold text-navy-600 hover:text-navy-900">
                          {m.status === "active" ? "Disable" : "Reactivate"}
                        </button>
                      )}
                      {!locked && !isMe && (
                        <button type="button" onClick={() => removeMember(m)}
                          className="ml-3 font-semibold text-red-600 hover:text-red-700">
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <p className="mt-4 flex items-start gap-1.5 text-xs text-navy-500">
        <FiLock className="mt-0.5 shrink-0" aria-hidden="true" />
        Numbers marked with a lock are predefined administrators from the server configuration.
        They cannot be demoted, disabled or deleted — they are the recovery path if other admin accounts are lost.
      </p>

      {dialog && (
        <StaffDialog
          member={dialog.id ? dialog : null}
          onClose={() => setDialog(null)}
          onSaved={(created) => {
            setDialog(null);
            if (created?.setupCode) setCodeInfo(created);
            load();
          }}
        />
      )}
      {codeInfo && <SetupCodeDialog info={codeInfo} onClose={() => setCodeInfo(null)} />}
    </div>
  );
};

export default StaffManagement;
