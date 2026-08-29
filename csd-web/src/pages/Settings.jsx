import React, { useEffect, useState } from "react";
import { FiCheckCircle, FiXCircle, FiAlertTriangle, FiInfo } from "react-icons/fi";
import { settings as settingsApi, errorMessage } from "../api";

const Yes = ({ ok, yes = "Configured", no = "Not configured" }) => (
  <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${ok ? "text-emerald-700" : "text-red-600"}`}>
    {ok ? <FiCheckCircle size={14} aria-hidden="true" /> : <FiXCircle size={14} aria-hidden="true" />}
    {ok ? yes : no}
  </span>
);

const Row = ({ label, children, hint }) => (
  <div className="border-b border-navy-100 py-3 last:border-b-0 sm:flex sm:items-start sm:justify-between sm:gap-6">
    <div className="sm:w-1/2">
      <dt className="text-sm font-medium text-navy-800">{label}</dt>
      {hint && <p className="mt-0.5 text-xs text-navy-500">{hint}</p>}
    </div>
    <dd className="mt-1 text-sm text-navy-900 sm:mt-0 sm:text-right">{children}</dd>
  </div>
);

const Card = ({ title, subtitle, children }) => (
  <section className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
    <h2 className="text-sm font-bold uppercase tracking-wider text-navy-700">{title}</h2>
    {subtitle && <p className="mt-0.5 text-xs text-navy-500">{subtitle}</p>}
    <dl className="mt-3">{children}</dl>
  </section>
);

const Settings = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    settingsApi.get()
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(errorMessage(err, "Could not load settings.")));
    return () => { alive = false; };
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-navy-500">Loading settings…</p>;

  const { authentication: a, access: ac, platform: p } = data;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-navy-900">System Settings</h1>
        <p className="mt-1 text-sm text-navy-500">
          How this deployment is configured. Values come from the server environment and are
          read-only here.
        </p>
      </header>

      {!a.smsConfigured && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <FiAlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <strong>No SMS provider is configured.</strong> Nobody can receive a login code on this
            server. Set <code className="font-mono">FAST2SMS_API_KEY</code> in the deployment
            environment.
          </span>
        </div>
      )}

      {a.devOtpBypassEnabled && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <FiAlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <strong>Development OTP bypass is enabled.</strong> A fixed code will be accepted
            instead of a real one. This must never be on in production.
          </span>
        </div>
      )}

      <div className="space-y-5">
        <Card title="Authentication" subtitle="How people sign in to this panel">
          <Row label="Method">{a.method}</Row>
          <Row label="SMS provider" hint={a.smsProvider}>
            <Yes ok={a.smsConfigured} />
          </Row>
          <Row label="Session secret" hint="Signs the session cookie; separate from the POS secret">
            <Yes ok={a.sessionSecretConfigured} yes="Set (32+ chars)" no="Missing or too short" />
          </Row>
          <Row label="Session length">{a.sessionLength}</Row>
          <Row label="Code validity">{a.otpValidityMinutes} minutes</Row>
          <Row label="Resend cooldown">{a.otpResendCooldownSeconds} seconds</Row>
          <Row label="Max code attempts">{a.otpMaxAttempts}</Row>
          <Row label="Predefined administrators" hint="Cannot be demoted or disabled — the recovery path">
            <span className="font-mono text-xs">{a.predefinedAdminPhones.join(", ")}</span>
          </Row>
        </Card>

        <Card title="Access control" subtitle="Who can reach what">
          <Row label="Model">{ac.model}</Row>
          <Row label="Role enforcement">{ac.roleSource}</Row>
          <Row label="Staff accounts">
            {ac.staffTotal} total · {ac.staffActive} active · {ac.staffDisabled} disabled
          </Row>
          <Row label="Active administrators">
            <span className={ac.activeAdmins <= 1 ? "font-semibold text-amber-700" : ""}>
              {ac.activeAdmins}
              {ac.activeAdmins <= 1 && " — only one"}
            </span>
          </Row>
        </Card>

        <Card title="Platform">
          <Row label="Environment">
            <span className={p.environment === "production" ? "font-semibold" : ""}>{p.environment}</span>
          </Row>
          <Row label="Base domain">{p.baseDomain || "—"}</Row>
          <Row label="Database"><Yes ok={p.databaseConnected} yes="Connected" no="Disconnected" /></Row>
          <Row label="Reporting timezone">{p.timezone}</Row>
        </Card>

        {data.notImplemented?.length > 0 && (
          <Card title="Not yet available" subtitle="Known gaps, so you aren't left looking for them">
            {data.notImplemented.map((n) => (
              <Row key={n.feature} label={n.feature}>
                <span className="inline-flex items-start gap-1.5 text-left text-xs text-navy-500 sm:max-w-xs">
                  <FiInfo className="mt-0.5 shrink-0" aria-hidden="true" />
                  {n.reason}
                </span>
              </Row>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
};

export default Settings;
