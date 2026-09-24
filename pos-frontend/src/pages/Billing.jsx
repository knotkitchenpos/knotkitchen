import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { Capacitor } from "@capacitor/core";
import {
  getBusinessBalance,
  getBalanceTransactions,
  createRecharge,
  verifyRecharge,
  getSubscriptionStatus,
  getSubscriptionQuote,
  addSubscriptionAddon,
  stopSubscriptionAddon,
  rentSubscriptionTablet,
  buySubscriptionPrinter,
  renewSubscription,
  getPlatformInvoices,
} from "../https";
import { loadCashfree } from "../utils/cashfree";

/**
 * Settings → Billing & Subscription.
 *
 * The restaurant's own view of what it pays KnotKitchen and how. The wallet
 * (Business Balance) pays for everything: the POS plan, add-ons, tablet
 * rental and printers. Nothing on this screen can set a price, and none of
 * these endpoints would accept one.
 *
 * This is also the screen a LOCKED account can still reach. If it ever stops
 * loading for a locked restaurant, that restaurant cannot pay its way out --
 * see middlewares/accountLock.js, where these paths are allow-listed.
 *
 * Buying is the Owner's call. A Staff member's purchase comes back 403
 * PIN_REQUIRED and the global PIN popup (utils/pinPrompt) asks for the Store
 * Properties PIN, then retries it. The server enforces it either way.
 */

const PRESETS = [500, 1000, 2000, 5000, 10000];

const money = (amount) => amount?.label || "₹0.00";
const dateOf = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—");
const timeOf = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

/** Top-up buttons. Before the POS plan starts, none may be under the first top-up minimum. */
const presetsFrom = (minRupees) => (minRupees > 0 ? [minRupees, ...PRESETS.filter((p) => p > minRupees)] : PRESETS);

/** Lines, GST and the total, exactly as the server priced them. */
const Bill = ({ bill, totalLabel }) => (
  <div className="divide-y divide-[#F1F5F9] rounded-xl border border-[#E2E8F0] text-[13px]">
    {bill.lines.map((l) => (
      <div key={l.description} className="flex justify-between gap-3 px-3 py-2 text-[#0F172A]">
        <span className="min-w-0">{l.description}</span>
        <span className="shrink-0 font-semibold tabular-nums">{money(l.amount)}</span>
      </div>
    ))}
    <div className="flex justify-between gap-3 px-3 py-2 text-[#64748B]">
      <span>GST</span>
      <span className="shrink-0 font-semibold tabular-nums">{money(bill.tax)}</span>
    </div>
    <div className="flex justify-between gap-3 px-3 py-2 text-[14px] font-extrabold text-[#0F172A]">
      <span>{totalLabel}</span>
      <span className="shrink-0 tabular-nums">{money(bill.total)}</span>
    </div>
  </div>
);

/**
 * The order summary the restaurant accepts before money moves: every line
 * the server will invoice (from GET /api/subscription/quote), GST, the total
 * and the terms. The acceptance is recorded with the purchase.
 */
const OrderSummary = ({ summary, onClose, onConfirm, busy }) => {
  const [accepted, setAccepted] = useState(false);
  const { title, quote, terms, payWith } = summary;
  const online = payWith === "gateway";
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-label={title}>
      <div className="w-full max-w-[440px] rounded-2xl bg-white p-5 shadow-2xl">
        <h3 className="text-[16px] font-extrabold text-[#0F172A]">{title}</h3>
        <p className="mt-0.5 mb-4 text-[12px] text-[#64748B]">
          Order summary · {online ? "paid now by UPI, card or netbanking" : "paid from your wallet"}
        </p>
        <Bill bill={quote} totalLabel="Total payable now" />
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
            I have read the order summary above and accept it and the KnotKitchen Restaurant Service Agreement on
            behalf of this restaurant. {online ? "I will pay it now online." : "It will be paid from the wallet."}
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

const Card = ({ title, subtitle, children, right }) => (
  <section className="rounded-2xl border border-[#E2E8F0] bg-white p-4 sm:p-5">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[13px] font-extrabold uppercase tracking-wider text-[#64748B]">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] text-[#94A3B8]">{subtitle}</p>}
      </div>
      {right}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

const Tag = ({ tone, children }) => (
  <span
    className={`ml-2 inline-block whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-[10.5px] font-extrabold ${
      tone === "green"
        ? "bg-[#DCFCE7] text-[#15803D]"
        : tone === "amber"
          ? "bg-[#FEF3C7] text-[#B45309]"
          : tone === "red"
            ? "bg-[#FEE2E2] text-[#B91C1C]"
            : "bg-[#F1F5F9] text-[#64748B]"
    }`}
  >
    {children}
  </span>
);

const PRIMARY =
  "shrink-0 rounded-xl bg-[#0F172A] px-4 py-2 text-[12.5px] font-extrabold text-white hover:bg-[#1E293B] disabled:opacity-40";
const SECONDARY =
  "shrink-0 rounded-xl border border-[#E2E8F0] px-4 py-2 text-[12.5px] font-bold text-[#334155] hover:border-[#CBD5E1] disabled:opacity-40";

const Billing = () => {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [paying, setPaying] = useState(false);
  // The order summary awaiting acceptance: { title, quote, terms, run, done }.
  const [summary, setSummary] = useState(null);

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
  const { data: subRes, isLoading: subLoading, isError: subError, refetch: refetchSub } = useQuery({
    queryKey: ["subscription"],
    queryFn: getSubscriptionStatus,
  });
  const { data: invRes } = useQuery({
    queryKey: ["subscription", "invoices"],
    queryFn: getPlatformInvoices,
  });

  const balance = balanceRes?.data?.data;
  const transactions = txRes?.data?.data || [];
  const sub = subRes?.data?.data;
  const invoices = invRes?.data?.data || [];
  const periodDays = sub?.periodDays || 30;
  // Until the POS plan has started, one top-up must reach the minimum: that one starts it.
  const minRupees = sub?.needsActivation ? Number(sub.firstRechargeMin?.rupees) || 0 : 0;
  const tablet = sub?.tablet;
  const credits = Number(tablet?.credits) || 0;

  // Both prefixes: the balance, statement, plan, features and invoices.
  const refreshMoney = () => {
    qc.invalidateQueries({ queryKey: ["business-balance"] });
    qc.invalidateQueries({ queryKey: ["subscription"] });
  };

  /** Ask our server, which asks Cashfree, whether a top-up was paid. */
  const settleTopUp = async (gatewayOrderId) => {
    // Never trusted, always re-checked against Cashfree by the server.
    const verified = await verifyRecharge({ gatewayOrderId });
    const { credited, purchased, already, reason } = verified.data.data;

    if (purchased) {
      enqueueSnackbar("Printer paid. KnotKitchen will arrange delivery. The invoice is below.", { variant: "success" });
      refreshMoney();
    } else if (credited || already) {
      enqueueSnackbar("Balance added.", { variant: "success" });
      setAmount("");
      refreshMoney();
    } else {
      enqueueSnackbar(reason || "That payment has not completed.", { variant: "warning" });
    }
  };

  // Back from the full-page checkout in the Android app (see topUp).
  useEffect(() => {
    const gatewayOrderId = new URLSearchParams(window.location.search).get("recharge");
    if (!gatewayOrderId) return;
    window.history.replaceState(null, "", window.location.pathname);
    settleTopUp(gatewayOrderId).catch(() =>
      enqueueSnackbar("The payment could not be checked yet. It is recorded by itself once Cashfree confirms.", {
        variant: "warning",
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Top up.
   *
   * The server opens the Cashfree order and NOTHING is credited until it has
   * asked Cashfree what happened. Whatever the modal resolves with, we ask our
   * own server to check -- which also covers paying and then closing the modal
   * before it reports back.
   *
   * In the Android app the checkout takes the whole page instead, as in
   * Cashfree's own WebView samples: there it lists the phone's UPI apps (via
   * the app's UpiIntentPlugin) and shows its verify step on the way back.
   * Cashfree then returns to this page with ?recharge=<order id>.
   */
  /**
   * Cashfree's checkout for a payment our server opened (a top-up or a
   * printer). true when the page is leaving for Cashfree (the Android app,
   * or a narrow screen): the ?recharge= return settles it. Otherwise the
   * modal has closed, paid or not, and the caller asks our server.
   */
  const checkout = async ({ paymentSessionId, environment }) => {
    const Cashfree = await loadCashfree();
    if (!Cashfree) throw new Error("The payment page could not be loaded. Check your connection.");
    const cashfree = Cashfree({ mode: environment === "PROD" ? "production" : "sandbox" });
    const inApp = Capacitor.isNativePlatform();
    const result = await cashfree.checkout({ paymentSessionId, redirectTarget: inApp ? "_self" : "_modal" });
    return Boolean(result?.redirect);
  };

  const topUp = async (rupees) => {
    const value = Number(rupees);
    if (!Number.isFinite(value) || value <= 0) {
      enqueueSnackbar("Enter an amount greater than zero.", { variant: "warning" });
      return;
    }

    setPaying(true);
    try {
      const inApp = Capacitor.isNativePlatform();
      const opened = await createRecharge({
        amount: value,
        ...(inApp ? { returnUrl: `${window.location.origin}/settings/billing?recharge={order_id}` } : {}),
      });
      const { gatewayOrderId } = opened.data.data;
      // Leaving for Cashfree: the return settles it.
      if (await checkout(opened.data.data)) return;
      await settleTopUp(gatewayOrderId);
    } catch (err) {
      enqueueSnackbar(
        err?.response?.data?.message || err?.message || "The top-up could not be completed.",
        { variant: "error" },
      );
    } finally {
      setPaying(false);
    }
  };

  /**
   * Every purchase and change on this screen. `run` makes the call, `done` is
   * what to say when it worked. 402 means the wallet is short, and the server
   * says by how much.
   */
  const act = useMutation({
    mutationFn: ({ run }) => run(),
    onSuccess: (res, { done }) => {
      // Gone to Cashfree's page: the return reports how it went.
      if (res?.redirected) return;
      // A repeated tap on something already bought: nothing was charged again.
      enqueueSnackbar(res?.data?.data?.already ? "Already done. Nothing was charged again." : done, { variant: "success" });
      setSummary(null);
      refreshMoney();
    },
    onError: (err) => {
      enqueueSnackbar(err?.response?.data?.message || err?.message || "That did not go through.", {
        variant: err?.response?.status === 402 ? "warning" : "error",
      });
    },
  });
  const busy = act.isPending;

  /** Price it now (the same pricing the purchase uses), then show the order summary. */
  const review = async ({ item, ...rest }) => {
    try {
      const quote = (await getSubscriptionQuote(item))?.data?.data;
      if (quote) setSummary({ quote, ...rest });
    } catch (err) {
      enqueueSnackbar(err?.response?.data?.message || "That could not be priced.", { variant: "warning" });
    }
  };

  const addAddon = (a) =>
    review({
      item: `ADDON:${a.code}`,
      title: `Add ${a.name}`,
      terms: [
        `Charged now for the days left in this period, then ${money(a.price)} + GST every ${periodDays} days with the POS plan.`,
        "Stop it any time: it keeps working until the end of the period already paid. No refunds.",
      ],
      run: () => addSubscriptionAddon({ code: a.code, accepted: true }),
      done: `${a.name} is on.`,
    });

  const rentTablet = () =>
    review({
      item: "TABLET",
      title: "Rent a tablet",
      terms: [
        `Charged now for the days left in this period, then ${money(tablet?.nextPrice)} + GST every ${periodDays} days with the POS plan.`,
        "Uses one of your qualifying top-ups. The tablet stays KnotKitchen's property; to end the rental, return it through KnotKitchen support.",
      ],
      run: () => rentSubscriptionTablet({ accepted: true }),
      done: "Tablet rented.",
    });

  const buyPrinter = (p) =>
    review({
      item: `PRINTER:${p.code}`,
      title: `Buy a ${p.name}`,
      payWith: "gateway",
      terms: ["One-time purchase, paid now by UPI, card or netbanking. Not from your wallet. No monthly fee."],
      run: async () => {
        const inApp = Capacitor.isNativePlatform();
        const opened = await buySubscriptionPrinter({
          code: p.code,
          accepted: true,
          ...(inApp ? { returnUrl: `${window.location.origin}/settings/billing?recharge={order_id}` } : {}),
        });
        if (await checkout(opened.data.data)) return { redirected: true };
        const verified = (await verifyRecharge({ gatewayOrderId: opened.data.data.gatewayOrderId })).data.data;
        if (!verified.purchased) throw new Error(verified.reason || "The payment was not completed. Nothing was charged.");
        return verified;
      },
      done: `${p.name} paid. KnotKitchen will arrange delivery. The invoice is below.`,
    });

  // After a CSD credit, say: a top-up renews by itself.
  const renewNow = () =>
    act.mutate({
      run: async () => {
        const res = await renewSubscription();
        if (!res?.data?.data?.renewed) throw new Error(res?.data?.data?.lastRenewalError || "Nothing is due for renewal yet.");
        return res;
      },
      done: "The POS plan is renewed.",
    });

  if (isLoading || subLoading) return <div className="p-6 text-[13px] text-[#94A3B8]">Loading billing…</div>;
  // Without the subscription the page would read as "EXPIRED" with no add-ons.
  if (subError) {
    return (
      <div className="p-6 text-[13px] text-[#B91C1C]">
        Could not load your plan.{" "}
        <button type="button" onClick={() => refetchSub()} className="font-bold underline">
          Try again
        </button>
      </div>
    );
  }

  const [badge, tone] = sub?.exempt
    ? ["DEMO", "green"]
    : sub?.active
      ? ["ACTIVE", "green"]
      : sub?.needsActivation
        ? ["NOT STARTED", "slate"]
        : sub?.inGrace
          ? ["GRACE", "amber"]
          : ["EXPIRED", "red"];
  const tablets = (sub?.tablets || []).filter((t) => t.active);

  return (
    <div className="h-full overflow-y-auto bg-[#F8FAFC] p-4 sm:p-5 space-y-5">
      <header>
        <h1 className="text-[20px] font-extrabold text-[#0F172A]">Billing &amp; Subscription</h1>
        <p className="text-[13px] text-[#64748B]">Your wallet, POS plan, add-ons, tablets, printers and invoices.</p>
      </header>

      {balance?.locked && (
        <div className="rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-4">
          <p className="text-[14px] font-extrabold text-[#B91C1C]">This account is locked</p>
          <p className="mt-1 text-[13px] text-[#7F1D1D]">
            {balance.lockedReason || "There is an outstanding amount on this account."} It unlocks by itself once paid.
          </p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ---------------------------------------------------------- */}
        <Card title="Wallet" subtitle="Your Business Balance. It pays the POS plan, add-ons, tablets and per-order charges.">
          <p className="text-[32px] font-extrabold leading-none text-[#0F172A]">{money(balance?.balance)}</p>

          {balance?.dues?.count > 0 && (
            <p className="mt-2 text-[12.5px] font-semibold text-[#B45309]">
              {balance.dues.count} unpaid order charge(s) — {money(balance.dues)}. These are
              collected automatically when you add balance.
            </p>
          )}

          {sub?.needsActivation && (
            <p className="mt-3 rounded-xl border border-[#FED7AA] bg-[#FFF7ED] px-3 py-2 text-[12.5px] text-[#9A3412]">
              <span className="font-extrabold">First recharge: at least {money(sub.firstRechargeMin)}.</span> Your POS
              plan ({money(sub.basePlan?.price)} + GST for {periodDays} days) starts automatically when it arrives, and
              the rest stays in your wallet.
            </p>
          )}

          <div className="mt-4">
            <p className="text-[12px] font-bold text-[#64748B]">Recharge</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {presetsFrom(minRupees).map((preset) => (
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
                min={minRupees || 1}
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={minRupees ? `At least ₹${minRupees.toLocaleString("en-IN")}` : "Custom amount"}
                className="h-[42px] min-w-0 flex-1 rounded-xl border border-[#E2E8F0] px-3 text-[14px] text-[#0F172A] focus:border-[#FD5302] focus:outline-none"
              />
              <button
                type="button"
                disabled={paying || !amount}
                onClick={() => topUp(amount)}
                className="h-[42px] shrink-0 rounded-xl bg-[#FD5302] px-5 text-[13.5px] font-extrabold text-white hover:bg-[#D64502] disabled:opacity-50"
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
          title={`${sub?.basePlan?.name || "POS"} plan`}
          subtitle={`${money(sub?.basePlan?.price)} + GST every ${periodDays} days, from your wallet`}
          right={<Tag tone={tone}>{badge}</Tag>}
        >
          {sub?.exempt ? (
            <p className="text-[13px] text-[#64748B]">
              KnotKitchen has set this store up as a demo store. It has every add-on, is never charged for the plan,
              per order or per e-bill, and is never locked.
            </p>
          ) : sub?.needsActivation ? (
            <p className="text-[13px] text-[#64748B]">
              Not started yet. Recharge at least {money(sub.firstRechargeMin)} in one payment and the POS plan starts
              automatically: {money(sub.basePlan?.price)} + GST comes out of it for the first {periodDays} days.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-[13px] text-[#64748B]">
                Current period: {dateOf(sub?.currentPeriodStart)} – {dateOf(sub?.currentPeriodEnd)}
              </p>
              {sub && !sub.active && (
                <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12.5px] text-[#991B1B]">
                  <p className="font-extrabold">The POS plan ended on {dateOf(sub.currentPeriodEnd)}.</p>
                  <p className="mt-0.5">
                    {sub.lastRenewalError || "It has not renewed yet."}{" "}
                    {sub.inGrace ? `The POS locks at ${timeOf(sub.graceEndsAt)} unless it renews. ` : ""}
                    Recharge the wallet and it renews at once.
                  </p>
                  <button type="button" disabled={busy} onClick={renewNow} className={`${SECONDARY} mt-2 bg-white`}>
                    Try the renewal now
                  </button>
                </div>
              )}
              {sub?.nextRenewal && (
                <>
                  <p className="text-[13px] font-bold text-[#0F172A]">
                    {sub.active ? `Renews on ${dateOf(sub.nextRenewal.at)}` : "Due now"}: {money(sub.nextRenewal.total)} from
                    your wallet
                  </p>
                  <Bill bill={sub.nextRenewal} totalLabel="Renewal total" />
                </>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ------------------------------------------------------------ */}
      <Card
        title="Add-ons"
        subtitle={`Monthly, from your wallet, renewing with the POS plan every ${periodDays} days. Added mid-period, you pay only for the days left.`}
      >
        {(sub?.addons || []).length === 0 ? (
          <p className="text-[13px] text-[#94A3B8]">No add-ons are available at the moment.</p>
        ) : (
          <div className="space-y-2">
            {sub.addons.map((a) => (
              <div
                key={a.code}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${
                  a.owned || sub.exempt ? "border-[#FD5302] bg-[#FFF7ED]" : "border-[#E2E8F0]"
                }`}
              >
                <div className="min-w-0 flex-1 basis-[220px]">
                  <p className="text-[14px] font-extrabold text-[#0F172A]">
                    {a.name}
                    {sub.exempt ? (
                      <Tag tone="green">INCLUDED</Tag>
                    ) : a.owned && a.endsAt ? (
                      <Tag tone="amber">STOPS {dateOf(a.endsAt).toUpperCase()}</Tag>
                    ) : a.owned ? (
                      <Tag tone="green">ON</Tag>
                    ) : null}
                  </p>
                  {a.description && <p className="text-[12px] text-[#64748B]">{a.description}</p>}
                  <p className="text-[12px] font-semibold text-[#334155]">
                    {money(a.price)} + GST / {periodDays} days
                  </p>
                </div>
                {!sub.exempt &&
                  (a.owned && !a.endsAt ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        act.mutate({
                          run: () => stopSubscriptionAddon(a.code),
                          done: `${a.name} stops at renewal. It works until ${dateOf(sub.currentPeriodEnd)}.`,
                        })
                      }
                      className={SECONDARY}
                    >
                      Stop at renewal
                    </button>
                  ) : a.owned ? (
                    // Stopped this period and taken back: already paid, so no charge.
                    <button
                      type="button"
                      disabled={busy || !sub.active}
                      onClick={() => act.mutate({ run: () => addSubscriptionAddon({ code: a.code }), done: `${a.name} keeps renewing.` })}
                      className={PRIMARY}
                    >
                      Keep
                    </button>
                  ) : (
                    <button type="button" disabled={busy || !sub.active} onClick={() => addAddon(a)} className={PRIMARY}>
                      Add
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}
        {sub && !sub.exempt && !sub.active && (
          <p className="mt-3 text-[12px] font-semibold text-[#94A3B8]">
            Add-ons can be added while the POS plan is running. Recharge the wallet to start or renew it.
          </p>
        )}
      </Card>

      {sub && !sub.exempt && (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* ---------------------------------------------------------- */}
          <Card
            title="Tablets"
            subtitle={`Monthly rental: the first ${money(tablet?.firstPrice)}, each extra ${money(tablet?.extraPrice)}, + GST.`}
          >
            {tablets.length === 0 ? (
              <p className="text-[13px] text-[#94A3B8]">No tablets rented.</p>
            ) : (
              <div className="space-y-1.5">
                {tablets.map((t) => (
                  <p key={t.serial} className="flex flex-wrap justify-between gap-2 text-[13px] text-[#0F172A]">
                    <span className="font-bold">Tablet #{t.serial}</span>
                    <span className="text-[#64748B]">
                      {money(t.price)} + GST / {periodDays} days
                      {t.endsAt ? ` · returned, rental ends ${dateOf(t.endsAt)}` : ` · since ${dateOf(t.rentedAt)}`}
                    </span>
                  </p>
                ))}
              </div>
            )}
            <p className="mt-3 text-[13px] text-[#0F172A]">
              Next tablet: <span className="font-bold">{money(tablet?.nextPrice)} + GST</span> / {periodDays} days ·
              Top-ups ready for a tablet: <span className="font-bold">{credits}</span>
            </p>
            <p className="mt-1 text-[12px] text-[#64748B]">
              Each tablet needs its own recharge of at least {money(tablet?.rechargeRequired)} in one payment, made after
              the POS plan started. The money stays in your wallet and pays your bills.
            </p>
            <button type="button" disabled={busy || credits < 1 || !sub.active} onClick={rentTablet} className={`${PRIMARY} mt-3`}>
              {credits < 1 ? `Top up ${money(tablet?.rechargeRequired)} to rent a tablet` : "Rent a tablet"}
            </button>
          </Card>

          {/* ---------------------------------------------------------- */}
          <Card title="Printers" subtitle="Buy once, paid online by UPI, card or netbanking (not from your wallet). No monthly fee.">
            {(sub.printers || []).length === 0 ? (
              <p className="text-[13px] text-[#94A3B8]">No printers are on sale at the moment.</p>
            ) : (
              <div className="space-y-2">
                {sub.printers.map((p) => (
                  <div key={p.code} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E2E8F0] p-3">
                    <div className="min-w-0 flex-1 basis-[220px]">
                      <p className="text-[14px] font-extrabold text-[#0F172A]">{p.name}</p>
                      <p className="text-[12px] text-[#64748B]">
                        {money(p.price)} + GST, one time{p.owned ? ` · you have bought ${p.owned}` : ""}
                      </p>
                    </div>
                    <button type="button" disabled={busy} onClick={() => buyPrinter(p)} className={PRIMARY}>
                      Buy
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
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
      <Card title="Transactions" subtitle="Every credit and debit on your wallet.">
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

      {/* Mounted only while open, so the terms box starts unticked every time. */}
      {summary && (
        <OrderSummary
          summary={summary}
          busy={busy}
          onClose={() => setSummary(null)}
          onConfirm={() => act.mutate({ run: summary.run, done: summary.done })}
        />
      )}
    </div>
  );
};

export default Billing;
