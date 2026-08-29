import React, { useCallback, useEffect, useState } from "react";
import { FiPlus, FiShield, FiLock, FiInfo } from "react-icons/fi";
import { staffAdmin, errorMessage, fieldErrors } from "../api";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";

const dt = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Never";

const EMPTY = { fullName: "", phone: "", personalEmail: "", officialEmail: "", role: "staff" };

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
          fullName: member.fullName, phone: member.phone,
          personalEmail: member.personalEmail || "", officialEmail: member.officialEmail || "",
          role: member.role,
        }
      : EMPTY
  );
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: name === "phone" ? value.replace(/\D/g, "").slice(0, 10) : value }));
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
        // phone is intentionally omitted — the server rejects changing it.
        const { phone, ...rest } = form; // eslint-disable-line no-unused-vars
        await staffAdmin.update(member.id, rest);
      } else {
        await staffAdmin.create(form);
      }
      onSaved();
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
          <Field label="Login phone number" name="phone" inputMode="numeric" required disabled={editing} {...fieldProps} />
          {editing && (
            <p className="-mt-2 flex items-start gap-1.5 text-xs text-navy-500">
              <FiInfo className="mt-0.5 shrink-0" aria-hidden="true" />
              The login phone identifies this account across the audit log and cannot be changed.
              Disable this record and create a new one instead.
            </p>
          )}
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

const StaffManagement = () => {
  const { staff: currentUser } = useAuth();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [dialog, setDialog] = useState(null); // null | {} | member
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

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Staff Management</h1>
          <p className="mt-1 text-sm text-navy-500">
            Only people listed here can sign in — an unlisted number cannot even request a code.
          </p>
        </div>
        <button type="button" onClick={() => setDialog({})}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500">
          <FiPlus aria-hidden="true" /> Add staff
        </button>
      </header>

      <input value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, Staff ID, phone or email…"
        aria-label="Search staff"
        className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />

      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {busy && rows.length === 0 && <p className="mt-6 text-sm text-navy-500">Loading staff…</p>}

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-navy-200 bg-white">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-b border-navy-200 bg-navy-50 text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th scope="col" className="px-4 py-3">Staff ID</th>
                <th scope="col" className="px-4 py-3">Name</th>
                <th scope="col" className="px-4 py-3">Phone</th>
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
                    <td className="px-4 py-3 text-navy-700">{m.phone}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-navy-700">
                        {m.role === "admin" && <FiShield size={12} className="text-brand-600" aria-hidden="true" />}
                        {m.role === "admin" ? "Administrator" : "CSD Staff"}
                        {locked && <FiLock size={11} className="text-navy-400" title="Predefined administrator" />}
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
                      {!locked && !isMe && (
                        <button type="button" onClick={() => toggleStatus(m)}
                          className="ml-3 font-semibold text-navy-600 hover:text-navy-900">
                          {m.status === "active" ? "Disable" : "Reactivate"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 flex items-start gap-1.5 text-xs text-navy-500">
        <FiLock className="mt-0.5 shrink-0" aria-hidden="true" />
        Numbers marked with a lock are predefined administrators from the server configuration.
        They cannot be demoted or disabled — they are the recovery path if other admin accounts are lost.
      </p>

      {dialog && (
        <StaffDialog
          member={dialog.id ? dialog : null}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); load(); }}
        />
      )}
    </div>
  );
};

export default StaffManagement;
