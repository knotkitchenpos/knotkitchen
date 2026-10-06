import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { getWebsiteSettings, updateWebsiteSettings, validateGatewayCredentials } from "../../https/storefrontApi";

/**
 * Store Properties > Payment Gateway (owner only; the server checks too).
 * Open to every store: Knot Eats and table QR payments use these keys, with or
 * without the Website add-on. Verify & Save is the only way keys are saved
 * (the validate endpoint stores them), so a blank secret is never sent as a
 * placeholder that would be sealed as the real key.
 */
const inputClass =
  "w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] text-[13px] font-bold text-[#0F172A] focus:outline-none focus:border-[#FD5302]";
const labelClass = "text-[11.5px] font-bold text-[#94A3B8]";

// Non-secret fields come from what is stored; secrets always start blank.
const formFrom = (pg) => ({
  cashfree: { clientId: pg.cashfree?.clientId || "", clientSecret: "", environment: pg.cashfree?.environment === "PROD" ? "PROD" : "TEST" },
  phonepe: {
    merchantId: pg.phonepe?.merchantId || "",
    saltKey: "",
    saltIndex: pg.phonepe?.saltIndex || "1",
    environment: pg.phonepe?.environment === "PROD" ? "PROD" : "UAT",
  },
});

const Status = ({ on }) =>
  on ? (
    <span className="px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#15803D] text-xs font-bold">Configured</span>
  ) : (
    <span className="px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#64748B] text-xs font-bold">Unconfigured</span>
  );

const PaymentGatewayCard = () => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["website", "settings"], queryFn: getWebsiteSettings });
  const pg = data?.data?.data?.settings?.paymentGateways || {};
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (data && !form) setForm(formFrom(data.data?.data?.settings?.paymentGateways || {}));
  }, [data, form]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["website", "settings"] });
    qc.invalidateQueries({ queryKey: ["knot-eats"] });
  };
  const fail = (err, fallback) => enqueueSnackbar(err.response?.data?.message || fallback, { variant: "error" });

  const verify = useMutation({
    mutationFn: (gateway) => validateGatewayCredentials({ gateway, ...form[gateway] }),
    onSuccess: (res, gateway) => {
      enqueueSnackbar(res.data?.message || "Credentials verified and saved.", { variant: "success" });
      const secret = gateway === "cashfree" ? "clientSecret" : "saltKey";
      setForm((f) => ({ ...f, [gateway]: { ...f[gateway], [secret]: "" } }));
      refresh();
    },
    onError: (err) => fail(err, "Validation failed."),
  });

  const setActive = useMutation({
    mutationFn: (value) => updateWebsiteSettings({ paymentGateways: { activeGateway: value } }),
    onSuccess: () => {
      enqueueSnackbar("Active payment gateway updated.", { variant: "success" });
      refresh();
    },
    onError: (err) => fail(err, "Couldn't change the active gateway."),
  });

  if (isLoading || !form) return <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 text-[13px] text-[#94A3B8]">Loading payment gateway…</div>;

  const edit = (gateway, key) => (e) => setForm((f) => ({ ...f, [gateway]: { ...f[gateway], [key]: e.target.value } }));
  const cf = form.cashfree;
  const pp = form.phonepe;
  const active = pg.activeGateway || "cashfree";
  const busy = verify.isPending || setActive.isPending;

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
      <div>
        <h4 className="text-[16px] font-extrabold text-[#0F172A]">Payment Gateway</h4>
        <p className="text-[12px] text-[#94A3B8]">
          Configure Cashfree or PhonePe credentials. Only ONE gateway can be active at a time for website, Knot Eats and table QR payments.
        </p>
      </div>

      <div className="p-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] text-xs text-[#92400E]">
        Enter <strong>this restaurant&apos;s own</strong> payment gateway keys. Every online payment settles to the account these
        keys belong to. Never enter KnotKitchen&apos;s keys here.
      </div>

      <div>
        <label className={labelClass}>Select Active Gateway</label>
        <select className={inputClass} value={active} disabled={busy} onChange={(e) => setActive.mutate(e.target.value)}>
          <option value="cashfree">Cashfree {pg.cashfree?.isConfigured ? "(Configured)" : "(Not configured)"}</option>
          <option value="phonepe">PhonePe {pg.phonepe?.isConfigured ? "(Configured)" : "(Not configured)"}</option>
        </select>
      </div>

      {/* Cashfree */}
      <div className="p-4 rounded-2xl border border-[#E2E8F0] space-y-3">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <div>
            <h4 className="font-extrabold text-sm text-[#0F172A]">Cashfree</h4>
            <p className="text-xs text-[#94A3B8]">Accept Instant UPI, Cards & BNPL</p>
          </div>
          <Status on={pg.cashfree?.isConfigured} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>Client ID (App ID)</label>
            <input className={inputClass} placeholder="CF_APP_..." value={cf.clientId} onChange={edit("cashfree", "clientId")} />
          </div>
          <div>
            <label className={labelClass}>Client Secret</label>
            <input
              type="password"
              className={inputClass}
              placeholder={pg.cashfree?.clientSecretMasked ? `Saved: ${pg.cashfree.clientSecretMasked}` : "Client secret"}
              value={cf.clientSecret}
              onChange={edit("cashfree", "clientSecret")}
            />
          </div>
          <div>
            <label className={labelClass}>Environment</label>
            <select className={inputClass} value={cf.environment} onChange={edit("cashfree", "environment")}>
              <option value="TEST">TEST (Sandbox)</option>
              <option value="PROD">PROD (Live)</option>
            </select>
          </div>
        </div>
        <button
          type="button"
          disabled={busy || !cf.clientId.trim() || !cf.clientSecret.trim()}
          onClick={() => verify.mutate("cashfree")}
          className="h-[36px] px-3.5 rounded-xl border border-[#FD5302] text-[#C2410C] text-[12.5px] font-bold hover:bg-[#FD5302]/5 disabled:opacity-40"
        >
          Verify & Save Cashfree Credentials
        </button>
      </div>

      {/* PhonePe */}
      <div className="p-4 rounded-2xl border border-[#E2E8F0] space-y-3">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <div>
            <h4 className="font-extrabold text-sm text-[#0F172A]">PhonePe</h4>
            <p className="text-xs text-[#94A3B8]">Direct PhonePe UPI & PG Integration</p>
          </div>
          <Status on={pg.phonepe?.isConfigured} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Merchant ID</label>
            <input className={inputClass} placeholder="MERCHANTUAT..." value={pp.merchantId} onChange={edit("phonepe", "merchantId")} />
          </div>
          <div>
            <label className={labelClass}>Salt Key</label>
            <input
              type="password"
              className={inputClass}
              placeholder={pg.phonepe?.saltKeyMasked ? `Saved: ${pg.phonepe.saltKeyMasked}` : "Salt key"}
              value={pp.saltKey}
              onChange={edit("phonepe", "saltKey")}
            />
          </div>
          <div>
            <label className={labelClass}>Salt Index</label>
            <input className={inputClass} placeholder="1" value={pp.saltIndex} onChange={edit("phonepe", "saltIndex")} />
          </div>
          <div>
            <label className={labelClass}>Environment</label>
            <select className={inputClass} value={pp.environment} onChange={edit("phonepe", "environment")}>
              <option value="UAT">UAT (Sandbox)</option>
              <option value="PROD">PROD (Live)</option>
            </select>
          </div>
        </div>
        <button
          type="button"
          disabled={busy || !pp.merchantId.trim() || !pp.saltKey.trim()}
          onClick={() => verify.mutate("phonepe")}
          className="h-[36px] px-3.5 rounded-xl border border-[#FD5302] text-[#C2410C] text-[12.5px] font-bold hover:bg-[#FD5302]/5 disabled:opacity-40"
        >
          Verify & Save PhonePe Credentials
        </button>
      </div>
    </div>
  );
};

export default PaymentGatewayCard;
