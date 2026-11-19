import React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSnackbar } from "notistack";
import { riderApi, errorMessage } from "../api";
import { greeting, firstName, rupees } from "../format";
import { DeliveryCard } from "../components/Delivery";
import { CardSkeleton, Empty, ErrorCard, Icon, Toggle } from "../components/ui";
import { AlertsPrompt, AndroidAppCard, InstallPrompt } from "../components/Prompts";

/** The rider's day: who they are, online or not, and the delivery that matters now. */
export default function Home({ me }) {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const active = useQuery({ queryKey: ["active"], queryFn: riderApi.active, refetchInterval: 60_000 });
  const today = useQuery({ queryKey: ["history", "today", ""], queryFn: () => riderApi.history("today"), staleTime: 60_000 });
  const online = Boolean(me.online);
  const suspended = me.status === "suspended";

  const toggle = useMutation({
    mutationFn: (next) => riderApi.setOnline(next),
    onSuccess: (res) => {
      qc.setQueryData(["me"], res);
      enqueueSnackbar(res.rider.online ? "You're online. New deliveries will reach you." : "You're offline. No new deliveries.", { variant: res.rider.online ? "success" : "info" });
    },
    onError: (err) => enqueueSnackbar(errorMessage(err), { variant: "error" }),
  });

  const list = active.data?.deliveries || [];
  // New ones first, then whatever is under way.
  const order = { assigned: 0, arrived: 1, on_the_way: 2, accepted: 3, cancelled: 4 };
  const sorted = [...list].sort((a, b) => (order[a.stage] ?? 9) - (order[b.stage] ?? 9));
  const [main, ...rest] = sorted;
  const doneToday = today.data?.summary;

  return (
    <div className="space-y-4 px-4 pb-6 r-safe-top">
      <header className="pt-2">
        <p className="r-muted text-[15px] font-semibold">
          {greeting()}, <span style={{ color: "var(--r-ink)" }} className="font-extrabold">{firstName(me.name)} 👋</span>
        </p>
        <div className="mt-1 flex items-center gap-2">
          <Icon.store s={18} className="r-faint" />
          <p className="truncate text-[17px] font-extrabold">{me.storeName || "Your store"}</p>
          <span className="r-faint text-[13px] font-bold">· ID {me.storeId}</span>
        </div>
      </header>

      {/* Online / offline: the one control a rider uses every shift. */}
      <section
        className="r-card flex items-center gap-4 p-4"
        style={{ background: online ? "var(--r-green-soft)" : "var(--r-card)", borderColor: online ? "var(--r-green)" : "var(--r-line)" }}
        aria-live="polite"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl" style={{ background: online ? "var(--r-green)" : "var(--r-card-2)", color: online ? "#fff" : "var(--r-ink-3)" }}>
          {online ? <span className="r-live-dot" style={{ background: "#fff" }} /> : <Icon.bike />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[18px] font-black" style={{ color: online ? "var(--r-green)" : "var(--r-ink)" }}>
            {online ? "🟢 You're Online" : "🔴 You're Offline"}
          </p>
          <p className="r-muted text-[13.5px] font-semibold">{suspended ? "Your account is suspended." : online ? "Ready for deliveries" : "Go online to receive delivery requests."}</p>
        </div>
        <Toggle checked={online} disabled={toggle.isPending || suspended} onChange={(v) => toggle.mutate(v)} label={online ? "Go offline" : "Go online"} />
      </section>

      {suspended ? (
        <p className="rounded-2xl px-4 py-3 text-[14.5px] font-bold" style={{ background: "var(--r-red-soft)", color: "var(--r-red)" }}>
          {me.storeName || "Your store"} has paused your account{me.statusNote ? `: “${me.statusNote}”` : "."} You can finish a ride already under way.
        </p>
      ) : null}

      <AndroidAppCard />
      <AlertsPrompt />

      {active.isLoading ? (
        <CardSkeleton rows={3} />
      ) : active.isError ? (
        <ErrorCard message={errorMessage(active.error, "Couldn't load your deliveries.")} onRetry={() => active.refetch()} />
      ) : main ? (
        <>
          <DeliveryCard key={main.orderId} delivery={main} primary />
          {rest.length ? (
            <Link to="/deliveries" className="r-card r-focus flex items-center justify-between p-4 text-[15px] font-extrabold">
              {rest.length} more deliver{rest.length === 1 ? "y" : "ies"} on you
              <Icon.chevron />
            </Link>
          ) : null}
        </>
      ) : online ? (
        <div className="r-card">
          <Empty emoji="🎉" title="You're all caught up" body="No active deliveries" />
        </div>
      ) : (
        <div className="r-card">
          <Empty
            emoji="🛵"
            title="You're Offline"
            body="Go online to receive delivery requests."
            action={
              !suspended ? (
                <button type="button" className="r-btn r-btn-green" disabled={toggle.isPending} onClick={() => toggle.mutate(true)}>
                  Go online
                </button>
              ) : null
            }
          />
        </div>
      )}

      {doneToday?.delivered ? (
        <Link to="/history" className="r-card r-focus flex items-center gap-3 p-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: "var(--r-green-soft)", color: "var(--r-green)" }}>
            <Icon.check />
          </span>
          <div className="flex-1">
            <p className="text-[15.5px] font-extrabold">
              {doneToday.delivered} delivered today
            </p>
            <p className="r-muted text-[13.5px] font-semibold">Orders worth {rupees(doneToday.value)}</p>
          </div>
          <Icon.chevron className="r-faint" />
        </Link>
      ) : null}

      <InstallPrompt />
    </div>
  );
}
