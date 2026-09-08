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
  getPlatformInvoices,
} from "../https";
import { useSelector } from "react-redux";
import SecurityPinModal from "../components/common/SecurityPinModal";
import { checkActionAuthorization } from "../utils/security";

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
const loadCashfree = () =>
  new Promise((resolve) => {
    if (window.Cashfree) return resolve(window.Cashfree);
    const el = document.createElement("script");
    el.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    el.onload = () => resolve(window.Cashfree || null);
    el.onerror = () => resolve(null);
    document.body.appendChild(el);
  });

const PRESETS = [500, 1000, 2000, 5000, 10000];

const money = (amount) => amount?.label || "₹0.00";

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

  const balance = balanceRes?.data?.data;
  const transactions = txRes?.data?.data || [];
  const subscription = subRes?.data?.data;
  const plans = plansRes?.data?.data || [];
  const invoices = invRes?.data?.data || [];

  const user = useSelector((st) => st.user);
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingPlan, setPendingPlan] = useState(null);
  // What each plan would actually cost RIGHT NOW. On an upgrade the server
  // charges the difference for the days left in the period, not the full
  // price again, and the operator should see that before committing.
  const [upgradeQuotes, setUpgradeQuotes] = useState({});

  useEffect(() => {
    let cancelled = false;
    const open = plans.filter((p) => p.isAvailable !== false && p.code !== subscription?.planCode);
    if (!open.length) return undefined;
    Promise.all(
      open.map((p) =>
        getSubscriptionQuote(p.code)
          .then((r) => [p.code, r?.data?.data?.charge])
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
  }, [plansRes, subscription?.planCode]);

  /**
   * Changing the plan is the Owner's decision. A Staff member has to enter
   * the Store Properties PIN first; the server enforces the same rule, so
   * this modal is the prompt, not the protection.
   */
  const changePlan = (planCode) => {
    const auth = checkActionAuthorization(user, { isOwnerOnly: false });
    if (auth.status === "REQUIRE_PIN") {
      setPendingPlan(planCode);
      setPinOpen(true);
      return;
    }
    buy.mutate(planCode);
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
    mutationFn: (planCode) => purchasePlan({ planCode }),
    onSuccess: (res) => {
      const d = res?.data?.data;
      enqueueSnackbar(`${d?.planName || "Plan"} is active.`, { variant: "success" });
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

  if (isLoading) return <div className="p-6 text-[13px] text-[#94A3B8]">Loading billing…</div>;

  return (
    <div className="h-full overflow-y-auto bg-[#F8FAFC] p-5 space-y-5">
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
              : "No active plan"
          }
          right={
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-extrabold ${
                subscription?.active
                  ? "bg-[#DCFCE7] text-[#15803D]"
                  : subscription?.inGrace
                    ? "bg-[#FEF3C7] text-[#B45309]"
                    : "bg-[#F1F5F9] text-[#64748B]"
              }`}
            >
              {subscription?.active ? "ACTIVE" : subscription?.inGrace ? "GRACE" : "INACTIVE"}
            </span>
          }
        >
          {plans.length === 0 ? (
            <p className="text-[13px] text-[#94A3B8]">
              No plans are available at the moment.
            </p>
          ) : (
            <div className="space-y-2">
              {plans.map((plan) => {
                const current = subscription?.planCode === plan.code && subscription?.active;
                // Listed but closed to new subscriptions. Shown rather than
                // hidden so a restaurant can see the whole ladder.
                const locked = plan.isAvailable === false && !current;
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
                      </p>
                      <p className="text-[12px] text-[#64748B]">
                        {money(plan.price)} / {subscription?.periodDays || 30} days
                        {plan.source === "offer" && " · offer price"}
                        {plan.source === "restaurant" && " · your agreed rate"}
                      </p>
                      {/* An upgrade mid-period is charged on the difference for
                          the days that remain, never the full price again. */}
                      {upgradeQuotes[plan.code] != null && !current && !locked && (
                        <p className="text-[11.5px] font-bold text-[#15803D]">
                          You pay {money(upgradeQuotes[plan.code])} now
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={buy.isPending || current || locked}
                      onClick={() => changePlan(plan.code)}
                      className="shrink-0 rounded-xl bg-[#0F172A] px-4 py-2 text-[12.5px] font-extrabold text-white hover:bg-[#1E293B] disabled:opacity-40"
                    >
                      {current ? "Active" : locked ? "Locked" : subscription?.active ? "Switch" : "Subscribe"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

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

      <SecurityPinModal
        isOpen={pinOpen}
        title="Plan changes need authorisation"
        actionLabel="Change plan"
        onClose={() => {
          setPinOpen(false);
          setPendingPlan(null);
        }}
        onSuccess={() => {
          setPinOpen(false);
          if (pendingPlan) buy.mutate(pendingPlan);
          setPendingPlan(null);
        }}
      />
    </div>
  );
};

export default Billing;
