import React from "react";
import { useAuth } from "../context/AuthContext";
import StatusBadge from "../components/StatusBadge";

const fmt = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

const Row = ({ label, children }) => (
  <div className="flex flex-col gap-1 border-b border-navy-100 py-3 last:border-b-0 sm:flex-row sm:items-center">
    <dt className="w-56 shrink-0 text-xs font-semibold uppercase tracking-wider text-navy-500">
      {label}
    </dt>
    <dd className="text-sm text-navy-900">{children ?? "—"}</dd>
  </div>
);

const Profile = () => {
  const { staff } = useAuth();
  if (!staff) return null;

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-600 text-2xl font-bold text-white">
          {staff.fullName.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-navy-900">{staff.fullName}</h1>
          <p className="text-sm text-navy-500">
            Staff ID: <span className="font-mono">{staff.staffId}</span>
          </p>
        </div>
      </header>

      <section className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-navy-700">
          Account details
        </h2>
        <dl>
          <Row label="Full name">{staff.fullName}</Row>
          <Row label="Staff ID"><span className="font-mono">{staff.staffId}</span></Row>
          <Row label="Login phone number">+91 {staff.phone}</Row>
          <Row label="Personal email">{staff.personalEmail || "—"}</Row>
          <Row label="Official email">{staff.officialEmail || "—"}</Row>
          <Row label="Role">
            <span className="font-medium">
              {staff.role === "admin" ? "Administrator" : "CSD Staff"}
            </span>
          </Row>
          <Row label="Account status"><StatusBadge status={staff.status} /></Row>
          <Row label="Date joined">{fmt(staff.dateJoined)}</Row>
          <Row label="Last login">{fmt(staff.lastLoginAt)}</Row>
          <Row label="Permissions">
            {staff.permissions?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {staff.permissions.map((p) => (
                  <span key={p} className="rounded-full bg-navy-100 px-2 py-0.5 text-[11px] text-navy-700">
                    {p}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-navy-500">
                Determined by role ({staff.role === "admin" ? "full access" : "CSD access"})
              </span>
            )}
          </Row>
        </dl>
      </section>

      <p className="mt-4 text-xs text-navy-500">
        Need a change to your details or access? Contact a KnotKitchen administrator.
      </p>
    </div>
  );
};

export default Profile;
