import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import {
  getBusinessBalance,
  getBalanceTransactions,
  createRecharge,
  verifyRecharge,
  getSubscriptionStatus,
  getSubscriptionPlans,
  purchasePlan,
  getSubscriptionQuote,
  getSubscriptionTerms,
  purchaseInstallation,
  getPlatformInvoices,
} from "../https";
import { useSelector } from "react-redux";
import SecurityPinModal from "../components/common/SecurityPinModal";
import { checkActionAuthorization } from "../utils/security";
import { loadCashfree } from "../utils/cashfree";

/**
 * Settings → Billing.
 *
 * The restaurant's own view of what it owes KnotKitchen and how to pay it.
 * Everything here is read-and-pay: no price on this screen can be edited, and
 * none of these endpoints would accept one.
 *
 * This is also the screen a LOCKED account can still reach. If it ever stops
 * loading for a locked restaurant, that restaurant cannot pay its way out --
 * see middlewares/accountLock.js, where these paths are allow-listed.
 */

/** Cashfree JS v3, loaded on demand. Resolves null if it cannot load. */
const PRESETS = [500, 1000, 2000, 5000, 10000];

const money = (amount) => amount?.label || "₹0.00";
const paise = (n) => `₹${(Number(n || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateOf = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—");

/**
 * Agreement v2.0, Schedule 1: the order summary the restaurant accepts before
 * money moves. Every line the server will invoice is shown first, tax on its
 * own line, and the acceptance is recorded with the purchase.
 */
const OrderSummary = ({ summary, onClose, onConfirm, busy }) => {
  const [accepted, setAccepted] = useState(false);
  if (!summary) return null;
  const { title, lines, total, terms, agreementVersion } = summary;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-label={title}>
      <div className="w-full max-w-[440px] rounded-2xl bg-white p-5 shadow-2xl">
        <h3 className="text-[16px] font-extrabold text-[#0F172A]">{title}</h3>
        <p className="mt-0.5 text-[12px] text-[#64748B]">Order summary · KnotKitchen Restaurant Service Agreement {agreementVersion}</p>
        <div className="mt-4 divide-y divide-[#F1F5F9] rounded-xl border border-[#E2E8F0] text-[13px]">
          {lines.map((l) => (
            <div key={l.label} className={`flex justify-between gap-3 px-3 py-2 ${l.muted ? "text-[#94A3B8]" : "text-[#0F172A]"}`}>
              <span>{l.label}</span>
              <span className="font-semibold tabular-nums">{l.value}</span>
            </div>
          ))}
          <div className="flex justify-between gap-3 px-3 py-2 text-[14px] font-extrabold text-[#0F172A]">
            <span>Total payable now</span>
            <span className="tabular-nums">{total}</span>
          </div>
        </div>
        {terms?.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[12px] text-[#64748B]">
            {terms.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
        <label className="mt-4 flex items-start gap-2 text-[12.5px] text-[#0F172A]">
          <input type="checkbox" className="mt-0.5" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>
            I have read the order summary above and accept it and the KnotKitchen Restaurant Service Agreement {agreementVersion}
            on behalf of this restaurant. It will be paid from the Business Balance.
          </span>
        </label>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="h-[42px] rounded-xl border border-[#E2E8F0] text-[13px] font-bold text-[#334155]">
            Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!accepted || busy}
            className="h-[42px] rounded-xl bg-[#FD5302] text-[13px] font-extrabold text-white disabled:opacity-50"
          >
            {busy ? "Working…" : "Accept and pay"}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Clause 6.1: the commitment a restaurant may choose, or none. */
const COMMITMENT_CHOICES = [
  { months: 0, label: "Month to month", sub: "No discount, no commitment" },
  { months: 3, label: "3 months", sub: "5% off the plan fee" },
  { months: 6, label: "6 months", sub: "10% off the plan fee" },
  { months: 12, label: "12 months", sub: "20% off the plan fee" },
];

const Card = ({ title, subtitle, children, right }) => (
  <section className="rounded-2xl border border-[#E2E8F0] bg-white p-5">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[13px] font-extrabold uppercase tracking-wider text-[#64748B]">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] text-[#94A3B8]">{subtitle}</p>}
      </div>
      {right}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

const Billing = () => {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    document.title = "KnotKitchen | Billing";
  }, []);

  const { data: balanceRes, isLoading } = useQuery({
    queryKey: ["business-balance"],
    queryFn: getBusinessBalance,
  });
  const { data: txRes } = useQuery({
    queryKey: ["business-balance", "transactions"],
    queryFn: () => getBalanceTransactions({ limit: 50 }),
  });
  const { data: subRes } = useQuery({
    queryKey: ["subscription"],
    queryFn: getSubscriptionStatus,
  });
  const { data: plansRes } = useQuery({
    queryKey: ["subscription", "plans"],
    queryFn: getSubscriptionPlans,
  });
  const { data: invRes } = useQuery({
    queryKey: ["subscription", "invoices"],
    queryFn: getPlatformInvoices,
  });
  const { data: termsRes } = useQuery({
    queryKey: ["subscription", "terms"],
    queryFn: getSubscriptionTerms,
  });
  const terms = termsRes?.data?.data;

  // Clause 6: chosen once, applied to every period it covers.
  const [commitmentMonths, setCommitmentMonths] = useState(0);
  const [installOption, setInstallOption] = useState("");
  // The order summary awaiting acceptance, and what to run once accepted.
  const [summary, setSummary] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);

  const balance = balanceRes?.data?.data;
  const transactions = txRes?.data?.data || [];
  const subscription = subRes?.data?.data;
  const plans = plansRes?.data?.data || [];
  const invoices = invRes?.data?.data || [];

  const user = useSelector((st) => st.user);
  const [pinOpen, setPinOpen] = useState(false);
  // What each plan would actually cost RIGHT NOW. On an upgrade the server
  // charges the difference for the days left in the period, not the full
  // price again, and the operator should see that before committing.
  const [upgradeQuotes, setUpgradeQuotes] = useState({});

  useEffect(() => {
    let cancelled = false;
    const currentPrice = Number(plans.find((p) => p.code === subscription?.planCode)?.price) || 0;
    const open = plans.filter(
      (p) => p.isAvailable !== false && p.code !== subscription?.planCode && Number(p.price) >= currentPrice,
    );
    if (!open.length) return undefined;
    Promise.all(
      open.map((p) =>
        getSubscriptionQuote(p.code, commitmentMonths)
          .then((r) => [p.code, r?.data?.data])
          .catch(() => [p.code, null]),
      ),
    ).then((rows) => {
      if (cancelled) return;
      setUpgradeQuotes(Object.fromEntries(rows.filter(([, v]) => v != null)));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plansRes, subscription?.planCode, commitmentMonths]);

  /** Run `action` now, or after the Store Properties PIN for a Staff member. */
  const authorise = (action) => {
    const auth = checkActionAuthorization(user, { isOwnerOnly: false });
    if (auth.status === "REQUIRE_PIN") {
      setPendingAction(() => action);
      setPinOpen(true);
      return;
    }
    action();
  };

  /**
   * Changing the plan is the Owner's decision. A Staff member has to enter
   * the Store Properties PIN first; the server enforces the same rule, so
   * this modal is the prompt, not the protection.
   */
  const changePlan = async (planCode) => {
    let q;
    try {
      q = (await getSubscriptionQuote(planCode, commitmentMonths))?.data?.data;
    } catch (err) {
      enqueueSnackbar(err?.response?.data?.message || "Could not price that plan.", { variant: "error" });
      return;
    }
    if (!q) return;
    const run = () => buy.mutate({ planCode, commitmentMonths, accepted: true });
    // A plain renewal on the same terms was accepted already; anything new is
    // shown as an order summary first (Agreement clause 2.2).
    if (!q.acceptanceRequired) {
      authorise(run);
      return;
    }
    const lines = [
      { label: `${q.planName} plan · ${subscription?.periodDays || 30} days${q.isUpgrade ? ` (upgrade, ${q.remainingDays} days left)` : ""}`, value: money(q.charge) },
    ];
    if (q.discountPaise > 0) {
      lines.push({ label: `${q.commitment.months}-month commitment discount (${q.commitment.discountPercent}%)`, value: `− ${money(q.discount)}` });
      lines.push({ label: "Plan fee after discount", value: money(q.netCharge) });
    }
    lines.push({
      label: q.tax?.applicable ? `GST ${q.tax.percent}%${q.tax.interState ? " (IGST)" : " (CGST + SGST)"}` : "GST",
      value: q.tax?.applicable ? paise(q.tax.totalTaxPaise) : "Not applicable (KnotKitchen is not GST-registered)",
      muted: !q.tax?.applicable,
    });
    const termsList = [];
    if (q.commitment) {
      termsList.push(
        `${q.commitment.months}-month commitment: ${q.commitment.discountPercent}% off the ${q.planName} plan fee for ${q.commitment.periodsTotal} billing periods, then the standard fee. The discount never applies to the Installation Charge, per-order charges, domains, add-ons or taxes.`,
      );
      termsList.push("If the subscription is not renewed before the commitment ends, the discount received so far becomes payable (Agreement clause 6.5).");
    }
    termsList.push("Plan fees for a period that has started are not refunded (clause 12A.1). Plans cannot be downgraded.");
    setSummary({
      title: q.isUpgrade ? `Upgrade to ${q.planName}` : subscription?.planCode === planCode ? `Renew ${q.planName}` : `Subscribe to ${q.planName}`,
      lines,
      total: money(q.total),
      terms: termsList,
      agreementVersion: q.agreementVersion || "v2.0",
      onConfirm: () => authorise(run),
    });
  };

  const payInstallation = () => {
    const option = terms?.installationOptions?.find((o) => o.code === installOption);
    if (!option) {
      enqueueSnackbar("Choose an installation option first.", { variant: "warning" });
      return;
    }
    const run = () => installBuy.mutate({ optionCode: option.code, accepted: true });
    const lines = [{ label: `Installation Charge · ${option.name}`, value: money(option.amount) }];
    lines.push({
      label: option.tax?.applicable ? `GST ${option.tax.percent}%${option.tax.interState ? " (IGST)" : " (CGST + SGST)"}` : "GST",
      value: option.tax?.applicable ? paise(option.tax.totalTaxPaise) : "Not applicable (KnotKitchen is not GST-registered)",
      muted: !option.tax?.applicable,
    });
    setSummary({
      title: "Installation Charge",
      lines,
      total: option.total ? money(option.total) : money(option.amount),
      terms: [
        "One-time charge for installation, set-up and onboarding" + (option.equipment ? `, and the loan of a ${option.equipment}, which remains KnotKitchen's property` : "") + ".",
        "Refundable when you leave: 25% before completing 12 months from activation, 100% on or after the 12-month anniversary, less any unpaid dues or unreturned equipment, with an itemised statement (Agreement clause 5.6).",
      ],
      agreementVersion: subscription?.agreementVersion || "v2.0",
      onConfirm: () => authorise(run),
    });
  };

  const refreshMoney = () => {
    qc.invalidateQueries({ queryKey: ["business-balance"] });
    qc.invalidateQueries({ queryKey: ["subscription"] });
  };

  /**
   * Top up.
   *
   * The server opens the Cashfree order and NOTHING is credited until it has
   * asked Cashfree what happened. Whatever the modal resolves with, we ask our
   * own server to check -- which also covers paying and then closing the modal
   * before it reports back.
   */
  const topUp = async (rupees) => {
    const value = Number(rupees);
    if (!Number.isFinite(value) || value <= 0) {
      enqueueSnackbar("Enter an amount greater than zero.", { variant: "warning" });
      return;
    }

    setPaying(true);
    try {
      const opened = await createRecharge({ amount: value });
      const { paymentSessionId, gatewayOrderId, environment } = opened.data.data;

      const Cashfree = await loadCashfree();
      if (!Cashfree) {
        enqueueSnackbar("The payment page could not be loaded. Check your connection.", {
          variant: "error",
        });
        return;
      }

      const cashfree = Cashfree({ mode: environment === "PROD" ? "production" : "sandbox" });
      await cashfree.checkout({ paymentSessionId, redirectTarget: "_modal" });

      // Never trusted, always re-checked against Cashfree by the server.
      const verified = await verifyRecharge({ gatewayOrderId });
      const { credited, already, reason } = verified.data.data;

      if (credited || already) {
        enqueueSnackbar("Balance added.", { variant: "success" });
        setAmount("");
        refreshMoney();
      } else {
        enqueueSnackbar(reason || "That payment has not completed.", { variant: "warning" });
      }
    } catch (err) {
      enqueueSnackbar(
        err?.response?.data?.message || "The top-up could not be completed.",
        { variant: "error" },
      );
    } finally {
      setPaying(false);
    }
  };

  const buy = useMutation({
    mutationFn: (body) => purchasePlan(body),
    onSuccess: (res) => {
      const d = res?.data?.data;
      enqueueSnackbar(`${d?.planName || "Plan"} is active.`, { variant: "success" });
      setSummary(null);
      refreshMoney();
      qc.invalidateQueries({ queryKey: ["subscription", "invoices"] });
    },
    onError: (err) => {
      // 402 means the balance is short. Say by how much rather than just no.
      enqueueSnackbar(
        err?.response?.data?.message || "That plan could not be activated.",
        { variant: err?.response?.status === 402 ? "warning" : "error" },
      );
    },
  });

  const installBuy = useMutation({
    mutationFn: (body) => purchaseInstallation(body),
    onSuccess: () => {
      enqueueSnackbar("Installation Charge paid. You can now choose a plan.", { variant: "success" });
      setSummary(null);
      refreshMoney();
      qc.invalidateQueries({ queryKey: ["subscription", "invoices"] });
    },
    onError: (err) => {
      enqueueSnackbar(err?.response?.data?.message || "The Installation Charge could not be paid.", {
        variant: err?.response?.status === 402 ? "warning" : "error",
      });
    },
  });

  if (isLoading) return <div className="p-6 text-[13px] text-[#94A3B8]">Loading billing…</div>;

  return (
    <div className="h-full overflow-y-auto bg-[#F8FAFC] p-4 sm:p-5 space-y-5">
      <header>
        <h1 className="text-[20px] font-extrabold text-[#0F172A]">Billing</h1>
        <p className="text-[13px] text-[#64748B]">
          Your KnotKitchen Business Balance, subscription and invoices.
        </p>
      </header>

      {balance?.locked && (
        <div className="rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-4">
          <p className="text-[14px] font-extrabold text-[#B91C1C]">This account is locked</p>
          <p className="mt-1 text-[13px] text-[#7F1D1D]">
            {balance.lockedReason ||
              "There is an outstanding amount on this account."}{" "}
            Add balance below and it unlocks automatically.
          </p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ---------------------------------------------------------- */}
        <Card
          title="Business Balance"
          subtitle="Used for your subscription and per-order charges."
        >
          <p className="text-[32px] font-extrabold leading-none text-[#0F172A]">
            {money(balance?.balance)}
          </p>

          {balance?.dues?.count > 0 && (
            <p className="mt-2 text-[12.5px] font-semibold text-[#B45309]">
              {balance.dues.count} unpaid order charge(s) — {money(balance.dues)}. These are
              collected automatically when you add balance.
            </p>
          )}

          <div className="mt-4">
            <p className="text-[12px] font-bold text-[#64748B]">Add balance</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={paying}
                  onClick={() => topUp(preset)}
                  className="rounded-xl border border-[#E2E8F0] px-4 py-2 text-[13px] font-bold text-[#0F172A] hover:border-[#FD5302] hover:text-[#C2410C] disabled:opacity-50"
                >
                  ₹{preset.toLocaleString("en-IN")}
                </button>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Custom amount"
                className="h-[42px] flex-1 rounded-xl border border-[#E2E8F0] px-3 text-[14px] text-[#0F172A] focus:border-[#FD5302] focus:outline-none"
              />
              <button
                type="button"
                disabled={paying || !amount}
                onClick={() => topUp(amount)}
                className="h-[42px] rounded-xl bg-[#FD5302] px-5 text-[13.5px] font-extrabold text-white hover:bg-[#D64502] disabled:opacity-50"
              >
                {paying ? "Opening…" : "Add"}
              </button>
            </div>
            <p className="mt-2 text-[11.5px] text-[#94A3B8]">
              Paid securely through Cashfree. Your balance updates once the payment is confirmed.
            </p>
          </div>
        </Card>

        {/* ---------------------------------------------------------- */}
        <Card
          title="Subscription"
          subtitle={
            subscription?.active
              ? `Renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString("en-IN", { dateStyle: "medium" })}`
              : subscription?.exempt
                ? "Demo store — no subscription or charges"
                : "No active plan"
          }
          right={
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-extrabold ${
                subscription?.active || subscription?.exempt
                  ? "bg-[#DCFCE7] text-[#15803D]"
                  : subscription?.inGrace
                    ? "bg-[#FEF3C7] text-[#B45309]"
                    : "bg-[#F1F5F9] text-[#64748B]"
              }`}
            >
              {subscription?.active ? "ACTIVE" : subscription?.exempt ? "DEMO" : subscription?.inGrace ? "GRACE" : "INACTIVE"}
            </span>
          }
        >
          {subscription?.exempt ? (
            <p className="text-[13px] text-[#64748B]">
              KnotKitchen has set this store up as a demo store. It needs no subscription, is never
              charged per order or per e-bill, and is never locked.
            </p>
          ) : subscription?.installationRequired ? (
            /* Clause 5.4: the Installation Charge comes before the first plan. */
            <div className="space-y-2">
              <p className="text-[13px] text-[#64748B]">
                Choose how KnotKitchen will be installed at your restaurant. This one-time charge is paid
                before your first plan and is refundable when you leave (25% before 12 months, 100% after).
              </p>
              {(terms?.installationOptions || []).map((o) => (
                <label
                  key={o.code}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 ${
                    installOption === o.code ? "border-[#FD5302] bg-[#FFF7ED]" : "border-[#E2E8F0]"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <input type="radio" name="installation" checked={installOption === o.code} onChange={() => setInstallOption(o.code)} />
                    <span>
                      <span className="block text-[14px] font-extrabold text-[#0F172A]">{o.name}</span>
                      <span className="block text-[12px] text-[#64748B]">
                        {o.equipment ? `${o.equipment} on loan, stays KnotKitchen's` : "Set-up and onboarding only"}
                      </span>
                    </span>
                  </span>
                  <span className="text-[14px] font-extrabold text-[#0F172A]">
                    {money(o.amount)}
                    {o.tax?.applicable && <span className="block text-[11px] font-semibold text-[#94A3B8]">+ GST</span>}
                  </span>
                </label>
              ))}
              <button
                type="button"
                disabled={!installOption || installBuy.isPending}
                onClick={payInstallation}
                className="mt-1 rounded-xl bg-[#0F172A] px-4 py-2 text-[12.5px] font-extrabold text-white hover:bg-[#1E293B] disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          ) : plans.length === 0 ? (
            <p className="text-[13px] text-[#94A3B8]">
              No plans are available at the moment.
            </p>
          ) : (
            <div className="space-y-2">
              {subscription?.commitment?.running ? (
                <p className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2 text-[12.5px] text-[#166534]">
                  <span className="font-extrabold">{subscription.commitment.months}-month commitment</span> ·{" "}
                  {subscription.commitment.discountPercent}% off the plan fee ·{" "}
                  {subscription.commitment.periodsUsed} of {subscription.commitment.periodsTotal} periods used
                  {subscription.commitment.endsAt ? ` · current period ends ${dateOf(subscription.commitment.endsAt)}` : ""}
                </p>
              ) : subscription?.commitment?.repaymentDuePaise > 0 ? (
                <p className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12.5px] text-[#991B1B]">
                  Your {subscription.commitment.months}-month commitment ended early. The discount received,{" "}
                  {paise(subscription.commitment.repaymentDuePaise)} plus GST where applicable, is collected from your next top-up.
                </p>
              ) : (
                <div>
                  <p className="text-[12px] font-bold text-[#64748B]">Commitment (optional)</p>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {COMMITMENT_CHOICES.map((c) => (
                      <button
                        key={c.months}
                        type="button"
                        aria-pressed={commitmentMonths === c.months}
                        onClick={() => setCommitmentMonths(c.months)}
                        className={`rounded-xl border px-2 py-2 text-left ${
                          commitmentMonths === c.months ? "border-[#FD5302] bg-[#FFF7ED] ring-1 ring-[#FD5302]" : "border-[#E2E8F0]"
                        }`}
                      >
                        <span className="block text-[12.5px] font-extrabold text-[#0F172A]">{c.label}</span>
                        <span className="block text-[11px] text-[#64748B]">{c.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {plans.map((plan) => {
                const own = subscription?.planCode === plan.code;
                const current = own && subscription?.active;
                // Listed but closed to new subscriptions. Shown rather than
                // hidden so a restaurant can see the whole ladder. A
                // restaurant's own plan can always be renewed.
                const locked = plan.isAvailable === false && !own;
                // Never a downgrade, running or ended (the server refuses it
                // too): a restaurant renews its plan or moves up.
                const currentPlan = plans.find((p) => p.code === subscription?.planCode);
                const lower =
                  !own && !locked && currentPlan && Number(plan.price) < Number(currentPlan.price);
                return (
                  <div
                    key={plan.code}
                    className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${
                      current
                        ? "border-[#FD5302] bg-[#FFF7ED]"
                        : locked
                          ? "border-[#E2E8F0] bg-[#F8FAFC] opacity-70"
                          : "border-[#E2E8F0]"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-[14px] font-extrabold text-[#0F172A]">
                        {plan.name}
                        {current && (
                          <span className="ml-2 text-[11px] font-bold text-[#C2410C]">CURRENT</span>
                        )}
                        {locked && (
                          <span className="ml-2 text-[11px] font-bold text-[#94A3B8]">LOCKED</span>
                        )}
                        {lower && (
                          <span className="ml-2 text-[11px] font-bold text-[#94A3B8]">LOWER PLAN</span>
                        )}
                      </p>
                      <p className="text-[12px] text-[#64748B]">
                        {money(plan.price)} / {subscription?.periodDays || 30} days
                        {plan.source === "offer" && " · offer price"}
                        {plan.source === "restaurant" && " · your agreed rate"}
                      </p>
                      {/* An upgrade mid-period is charged on the difference for
                          the days that remain, never the full price again. */}
                      {lower && (
                        <p className="text-[11.5px] font-semibold text-[#94A3B8]">
                          Plans can&apos;t be downgraded. Renew {currentPlan.name} or upgrade.
                        </p>
                      )}
                      {upgradeQuotes[plan.code] != null && !current && !locked && !lower && (
                        <p className="text-[11.5px] font-bold text-[#15803D]">
                          You pay {money(upgradeQuotes[plan.code].total)} now
                          {upgradeQuotes[plan.code].discountPaise > 0 && ` (${upgradeQuotes[plan.code].commitment.discountPercent}% off, GST included)`}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={buy.isPending || current || locked || lower}
                      onClick={() => changePlan(plan.code)}
                      className="shrink-0 rounded-xl bg-[#0F172A] px-4 py-2 text-[12.5px] font-extrabold text-white hover:bg-[#1E293B] disabled:opacity-40"
                    >
                      {current ? "Active" : locked ? "Locked" : lower ? "Not available" : own ? "Renew" : subscription?.planCode ? "Upgrade" : "Subscribe"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {subscription?.installation && (
        <Card title="Installation" subtitle="Agreement clause 5. One-time, refundable when you leave.">
          <p className="text-[13px] text-[#0F172A]">
            <span className="font-extrabold">{subscription.installation.optionName}</span> ·{" "}
            {paise(subscription.installation.amountPaise)} paid on {dateOf(subscription.installation.paidAt)}
            {subscription.activatedAt ? ` · activated ${dateOf(subscription.activatedAt)}` : ""}
          </p>
          <p className="mt-1 text-[12px] text-[#64748B]">
            If you left today you would get back {paise(subscription.installation.refund?.refundPaise)} (
            {subscription.installation.refund?.percent}%), less any unpaid dues or unreturned equipment.
            {subscription.installation.refund?.anniversaryAt && !subscription.installation.refund?.completed12Months
              ? ` 100% from ${dateOf(subscription.installation.refund.anniversaryAt)}.`
              : ""}
          </p>
        </Card>
      )}

      {/* ------------------------------------------------------------ */}
      <Card title="Invoices" subtitle="Opens in a new tab. Use your browser's Print to save a PDF.">
        {invoices.length === 0 ? (
          <p className="text-[13px] text-[#94A3B8]">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#94A3B8]">
                  <th className="pb-2">Invoice</th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2 text-right">Amount</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-[#F1F5F9]">
                    <td className="py-2.5 font-semibold text-[#0F172A]">{inv.number}</td>
                    <td className="py-2.5 text-[#64748B]">
                      {new Date(inv.date).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                    </td>
                    <td className="py-2.5 text-right font-bold tabular-nums text-[#0F172A]">
                      {money(inv.total)}
                    </td>
                    <td className="py-2.5 text-right">
                      <a
                        href={inv.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12.5px] font-bold text-[#C2410C] underline underline-offset-2"
                      >
                        View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------------ */}
      <Card title="Transactions" subtitle="Every credit and debit on your balance.">
        {transactions.length === 0 ? (
          <p className="text-[13px] text-[#94A3B8]">Nothing yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#94A3B8]">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Description</th>
                  <th className="pb-2 text-right">Credit</th>
                  <th className="pb-2 text-right">Debit</th>
                  <th className="pb-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-t border-[#F1F5F9]">
                    <td className="py-2.5 whitespace-nowrap text-[#64748B]">
                      {new Date(t.at).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                    </td>
                    <td className="py-2.5 text-[#0F172A]">{t.description}</td>
                    <td className="py-2.5 text-right font-semibold tabular-nums text-[#15803D]">
                      {t.credit ? money(t.credit) : "—"}
                    </td>
                    <td className="py-2.5 text-right font-semibold tabular-nums text-[#B91C1C]">
                      {t.debit ? money(t.debit) : "—"}
                    </td>
                    <td className="py-2.5 text-right font-bold tabular-nums text-[#0F172A]">
                      {money(t.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <OrderSummary
        summary={summary}
        busy={buy.isPending || installBuy.isPending}
        onClose={() => setSummary(null)}
        onConfirm={() => summary?.onConfirm?.()}
      />

      <SecurityPinModal
        isOpen={pinOpen}
        title="Plan changes need authorisation"
        actionLabel="Change plan"
        onClose={() => {
          setPinOpen(false);
          setPendingAction(null);
        }}
        onSuccess={() => {
          setPinOpen(false);
          if (pendingAction) pendingAction();
          setPendingAction(null);
        }}
      />
    </div>
  );
};

export default Billing;
