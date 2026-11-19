import React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { riderApi, errorMessage, errorCode } from "../api";
import { rupees, clock, minutesBetween, telHref, STAGES } from "../format";
import { ActionButtons, ActionSheets, useDeliveryActions, openMaps } from "../components/Delivery";
import { CardSkeleton, Empty, ErrorCard, Icon, StageBadge, TopBar } from "../components/ui";

const STEPS = ["assigned", "accepted", "on_the_way", "arrived", "delivered"];
const STEP_LABEL = { assigned: "Assigned", accepted: "Accepted", on_the_way: "On the way", arrived: "Arrived", delivered: "Delivered" };

function Stepper({ stage, times }) {
  const at = STEPS.indexOf(stage);
  const when = { assigned: times.assignedAt, accepted: times.acceptedAt, on_the_way: times.startedAt, arrived: times.arrivedAt, delivered: times.deliveredAt };
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Delivery progress">
      {STEPS.map((s, i) => {
        const done = i <= at;
        return (
          <li key={s} className="flex flex-col items-center text-center" aria-current={i === at ? "step" : undefined}>
            <span className="h-1.5 w-full rounded-full" style={{ background: done ? "var(--r-green)" : "var(--r-line)" }} />
            <span className="mt-1.5 text-[11px] font-extrabold leading-tight" style={{ color: done ? "var(--r-ink)" : "var(--r-ink-3)" }}>
              {STEP_LABEL[s]}
            </span>
            {when[s] ? <span className="r-faint text-[10.5px] font-semibold">{clock(when[s])}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Section({ title, children, right }) {
  return (
    <section className="r-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="r-faint text-[12px] font-extrabold uppercase tracking-widest">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function DeliveryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["delivery", id], queryFn: () => riderApi.delivery(id), refetchInterval: 45_000, retry: (n, err) => errorCode(err) !== "NOT_YOURS" && n < 2 });
  const d = q.data?.delivery;
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/"));

  if (q.isLoading) {
    return (
      <div className="px-4">
        <TopBar title="Delivery" onBack={back} />
        <div className="space-y-3">
          <CardSkeleton rows={2} />
          <CardSkeleton rows={4} />
        </div>
      </div>
    );
  }
  if (q.isError || !d) {
    const gone = errorCode(q.error) === "NOT_YOURS" || q.error?.response?.status === 404;
    return (
      <div className="px-4">
        <TopBar title="Delivery" onBack={back} />
        {gone ? (
          <div className="r-card">
            <Empty emoji="🔄" title="Not your delivery any more" body="The store gave this order to someone else or took it back." action={<Link to="/" className="r-btn r-btn-primary">Back to Home</Link>} />
          </div>
        ) : (
          <ErrorCard message={errorMessage(q.error, "Couldn't load this delivery.")} onRetry={() => q.refetch()} />
        )}
      </div>
    );
  }
  return <Detail d={d} back={back} />;
}

function Detail({ d, back }) {
  const actions = useDeliveryActions(d);
  const live = ["assigned", "accepted", "on_the_way", "arrived"].includes(d.stage);
  const tel = telHref(d.customer.phone);
  const storeTel = telHref(d.store?.phone);
  const extras = [
    ["Subtotal", d.bills.subtotal],
    ["Taxes", d.bills.tax],
    ["Packaging", d.bills.packagingFee],
    ["Delivery Charge", d.bills.deliveryFee],
    ["Platform fee", d.bills.platformFee],
  ].filter(([, v]) => v > 0);

  return (
    <div className="pb-[300px]">
      <div className="px-4">
        <TopBar title={`Delivery #${d.orderNumber}`} onBack={back} right={<StageBadge stage={d.stage} />} />
      </div>

      <div className="space-y-3 px-4">
        {d.stage === "cancelled" ? (
          <div className="rounded-[20px] p-4" role="alert" style={{ background: "var(--r-red-soft)", color: "var(--r-red)" }}>
            <p className="text-[17px] font-black">Order cancelled</p>
            <p className="mt-1 text-[14.5px] font-bold">Don’t deliver it. If you already have the food, take it back to the store.</p>
          </div>
        ) : d.stage === "delivered" ? (
          <section className="r-card p-5 text-center" style={{ borderColor: "var(--r-green)", borderWidth: 2 }}>
            <div className="text-[48px]" aria-hidden="true">
              ✅
            </div>
            <p className="text-[22px] font-black" style={{ color: "var(--r-green)" }}>
              🟢 Delivered
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-left text-[14px]">
              {[
                ["Completed", clock(d.times.deliveredAt)],
                ["Took", minutesBetween(d.times.startedAt, d.times.deliveredAt) ? `${minutesBetween(d.times.startedAt, d.times.deliveredAt)} min` : "-"],
                ["Customer", d.customer.name],
                ["Amount", rupees(d.bills.total)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl p-3" style={{ background: "var(--r-card-2)" }}>
                  <dt className="r-faint text-[12px] font-bold">{k}</dt>
                  <dd className="truncate font-extrabold">{v}</dd>
                </div>
              ))}
            </dl>
            <Link to="/" className="r-btn r-btn-primary mt-4 w-full">
              Back to Home
            </Link>
          </section>
        ) : (
          <section className="r-card p-4">
            <p className="mb-3 text-[16px] font-black">{STAGES[d.stage]?.label}</p>
            <Stepper stage={d.stage} times={d.times} />
          </section>
        )}

        <Section title="Customer">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[18px] font-extrabold">{d.customer.name}</p>
              <p className="r-muted text-[15px] font-semibold">📞 {d.customer.phoneMasked}</p>
            </div>
            {tel ? (
              <a href={tel} className="r-btn r-btn-green min-h-[48px] px-4" aria-label={`Call ${d.customer.name}`}>
                <Icon.phone s={19} /> Call
              </a>
            ) : null}
          </div>
        </Section>

        <Section title="Delivery address" right={d.distanceKm != null ? <span className="r-muted text-[13px] font-bold">{d.distanceKm} km away</span> : null}>
          <p className="text-[16px] font-bold leading-snug">{d.address.text || "-"}</p>
          {d.address.instructions ? (
            <p className="mt-2 rounded-2xl px-3 py-2 text-[14px] font-semibold" style={{ background: "var(--r-amber-soft)", color: "var(--r-amber)" }}>
              “{d.address.instructions}”
            </p>
          ) : null}
          {live && d.address.navUrl ? (
            <button type="button" className="r-btn r-btn-ghost mt-3 w-full" onClick={() => openMaps(d)}>
              <Icon.nav s={19} /> Open in Google Maps
            </button>
          ) : null}
        </Section>

        <Section title="Order">
          <ul className="space-y-1.5">
            {d.items.map((i, n) => (
              <li key={n} className="flex gap-2 text-[15px]">
                <span className="min-w-[36px] font-black">{i.quantity}×</span>
                <span className="min-w-0 flex-1">
                  <span className="font-bold">{i.name}</span>
                  {i.variant ? <span className="r-muted"> · {i.variant}</span> : null}
                  {i.extras?.length ? <span className="r-faint block text-[13px]">{i.extras.join(", ")}</span> : null}
                  {i.note ? <span className="r-faint block text-[13px] italic">“{i.note}”</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t pt-3 text-[14.5px]" style={{ borderColor: "var(--r-line)" }}>
            {extras.map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="r-muted">{k}</dt>
                <dd className="font-semibold">{rupees(v)}</dd>
              </div>
            ))}
            {d.bills.discount > 0 ? (
              <div className="flex justify-between" style={{ color: "var(--r-green)" }}>
                <dt>Discount</dt>
                <dd className="font-semibold">−{rupees(d.bills.discount)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between pt-1 text-[18px] font-black">
              <dt>Total</dt>
              <dd>{rupees(d.bills.total)}</dd>
            </div>
          </dl>
          {live ? (
            d.collect > 0 ? (
              <p className="mt-3 rounded-2xl px-4 py-3 text-[16px] font-black" style={{ background: "var(--r-amber-soft)", color: "var(--r-amber)" }}>
                <Icon.cash s={18} className="mr-1.5 inline" /> Collect {rupees(d.collect)} in cash
              </p>
            ) : (
              <p className="mt-3 rounded-2xl px-4 py-3 text-[15px] font-extrabold" style={{ background: "var(--r-green-soft)", color: "var(--r-green)" }}>
                Paid online: collect nothing
              </p>
            )
          ) : null}
        </Section>

        {d.store?.name ? (
          <Section title="Pick up from">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-extrabold">{d.store.name}</p>
                {d.store.address ? <p className="r-muted text-[14px]">{d.store.address}</p> : null}
              </div>
              {storeTel ? (
                <a href={storeTel} className="r-btn r-btn-ghost min-h-[48px] px-4" aria-label="Call the store">
                  <Icon.phone s={18} /> Store
                </a>
              ) : null}
            </div>
          </Section>
        ) : null}
      </div>

      {live ? (
        <div className="fixed inset-x-0 bottom-[64px] z-30 mx-auto max-w-[560px] border-t px-4 pt-3 r-safe-bottom" style={{ background: "var(--r-bg)", borderColor: "var(--r-line)" }}>
          <ActionButtons delivery={d} actions={actions} />
          <ActionSheets delivery={d} actions={actions} />
        </div>
      ) : null}
    </div>
  );
}
