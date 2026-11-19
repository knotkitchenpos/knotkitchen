import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSnackbar } from "notistack";
import { riderApi, errorMessage, errorCode } from "../api";
import { rupees, telHref, STAGES } from "../format";
import { Icon, StageBadge, Confirm, Sheet } from "./ui";

const REASONS = ["Too far", "Not available", "Vehicle issue", "Other"];

/** Opens Google Maps (the app on a phone) with the customer as the destination. */
export const openMaps = (d) => {
  const url = d?.address?.navUrl;
  if (!url) return false;
  window.open(url, "_blank", "noopener");
  return true;
};

/** Accept, reject, start, arrived, delivered: one place, with the confirmations. */
export function useDeliveryActions(delivery) {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const [rejecting, setRejecting] = useState(false);
  const [delivering, setDelivering] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["active"] });
    qc.invalidateQueries({ queryKey: ["me"] });
    qc.invalidateQueries({ queryKey: ["history"] });
  };
  const mutation = useMutation({
    mutationFn: ({ step, body }) => riderApi.act(delivery.orderId, step, body),
    onSuccess: (res, { step }) => {
      qc.setQueryData(["delivery", delivery.orderId], res);
      refresh();
      const done = { accept: "Delivery accepted", reject: "Delivery declined. The store has been told.", start: "Ride started. Drive safe!", arrived: "Marked as arrived", delivered: "Delivered! 🎉" }[step];
      if (done) enqueueSnackbar(done, { variant: step === "reject" ? "info" : "success" });
      setRejecting(false);
      setDelivering(false);
      // Declined: it isn't theirs any more, so back to Home.
      if (step === "reject") navigate("/", { replace: true });
    },
    onError: (err) => {
      const code = errorCode(err);
      enqueueSnackbar(errorMessage(err), { variant: code === "NOT_READY" ? "warning" : "error" });
      // The delivery changed under us (cancelled, reassigned): show the truth.
      qc.invalidateQueries({ queryKey: ["delivery", delivery.orderId] });
      refresh();
    },
  });
  const run = (step, body) => mutation.mutate({ step, body });

  return { run, busy: mutation.isPending, rejecting, setRejecting, delivering, setDelivering };
}

/** The sheets the actions open. Render once per screen. */
export function ActionSheets({ delivery, actions }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [collected, setCollected] = useState(false);
  const due = Number(delivery.collect) || 0;
  return (
    <>
      <Sheet open={actions.rejecting} onClose={() => actions.setRejecting(false)} title="Why can't you take it?">
        <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Reason">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={reason === r}
              onClick={() => setReason(r)}
              className="r-btn"
              style={{ background: reason === r ? "var(--r-brand-soft)" : "var(--r-card-2)", color: reason === r ? "var(--r-brand-ink)" : "var(--r-ink)", border: `2px solid ${reason === r ? "var(--r-brand)" : "var(--r-line)"}` }}
            >
              {r}
            </button>
          ))}
        </div>
        {reason === "Other" ? (
          <div className="mt-3">
            <label htmlFor="r-reject-note" className="r-label">
              Tell the store why
            </label>
            <input id="r-reject-note" className="r-input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Fuel low" />
          </div>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" className="r-btn r-btn-ghost" onClick={() => actions.setRejecting(false)}>
            Keep it
          </button>
          <button type="button" className="r-btn r-btn-danger" disabled={!reason || (reason === "Other" && !note.trim()) || actions.busy} onClick={() => actions.run("reject", { reason, note })}>
            {actions.busy ? "Please wait…" : "Decline"}
          </button>
        </div>
      </Sheet>

      <Confirm
        open={actions.delivering}
        onClose={() => actions.setDelivering(false)}
        title="Mark as delivered?"
        body={due > 0 ? undefined : "Only once the customer has the order in their hands."}
        confirmLabel="Delivered"
        tone="green"
        busy={actions.busy}
        disabled={due > 0 && !collected}
        onConfirm={() => actions.run("delivered", { collected: due > 0 })}
      >
        {due > 0 ? (
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl p-4" style={{ background: "var(--r-amber-soft)", border: "2px solid var(--r-amber)" }}>
            <input type="checkbox" className="h-6 w-6 accent-[var(--r-green)]" checked={collected} onChange={(e) => setCollected(e.target.checked)} />
            <span className="text-[15.5px] font-extrabold">I collected {rupees(due)} in cash</span>
          </label>
        ) : null}
      </Confirm>
    </>
  );
}

/** What to do next, as big buttons. */
export function ActionButtons({ delivery, actions, compact = false }) {
  const { stage } = delivery;
  const tel = telHref(delivery.customer?.phone);
  const call = tel ? (
    <a href={tel} className="r-btn r-btn-ghost flex-1" aria-label={`Call ${delivery.customer.name}`}>
      <Icon.phone s={19} /> Call
    </a>
  ) : null;
  const nav = delivery.address?.navUrl ? (
    <button type="button" className="r-btn r-btn-ghost flex-1" onClick={() => openMaps(delivery)}>
      <Icon.nav s={19} /> Navigate
    </button>
  ) : null;

  if (stage === "assigned") {
    return (
      <div className="space-y-2.5">
        <button type="button" className="r-btn r-btn-primary r-btn-lg w-full" disabled={actions.busy} onClick={() => actions.run("accept")}>
          <Icon.check /> {actions.busy ? "Accepting…" : "ACCEPT DELIVERY"}
        </button>
        <div className="flex gap-2.5">
          <button type="button" className="r-btn r-btn-danger flex-1" onClick={() => actions.setRejecting(true)}>
            <Icon.x s={19} /> Reject
          </button>
          {compact ? null : nav}
        </div>
      </div>
    );
  }
  if (stage === "accepted") {
    return (
      <div className="space-y-2.5">
        <button type="button" className="r-btn r-btn-primary r-btn-lg w-full" disabled={actions.busy || !delivery.foodReady} onClick={() => actions.run("start")}>
          <Icon.bike /> {actions.busy ? "Starting…" : "START RIDE"}
        </button>
        {!delivery.foodReady ? (
          <p className="text-center text-[13.5px] font-bold" style={{ color: "var(--r-amber)" }}>
            Waiting for the kitchen to mark it ready
          </p>
        ) : null}
        <div className="flex gap-2.5">
          {call}
          {nav}
        </div>
        {compact ? null : (
          <button type="button" className="r-faint w-full py-2 text-[13.5px] font-bold underline" onClick={() => actions.setRejecting(true)}>
            Can’t do this one?
          </button>
        )}
      </div>
    );
  }
  if (stage === "on_the_way") {
    return (
      <div className="space-y-2.5">
        <button type="button" className="r-btn r-btn-green r-btn-lg w-full" disabled={actions.busy} onClick={() => actions.run("arrived")}>
          <Icon.pin /> {actions.busy ? "Saving…" : "ARRIVED"}
        </button>
        <div className="flex gap-2.5">
          {call}
          {nav}
        </div>
      </div>
    );
  }
  if (stage === "arrived") {
    return (
      <div className="space-y-2.5">
        {tel ? (
          <a href={tel} className="r-btn r-btn-ghost r-btn-lg w-full">
            <Icon.phone /> CALL CUSTOMER
          </a>
        ) : null}
        <button type="button" className="r-btn r-btn-green r-btn-lg w-full" disabled={actions.busy} onClick={() => actions.setDelivering(true)}>
          <Icon.check /> MARK AS DELIVERED
        </button>
      </div>
    );
  }
  return null;
}

/** The delivery as a card: Home's main element and the Deliveries list. */
export function DeliveryCard({ delivery, primary = false }) {
  const actions = useDeliveryActions(delivery);
  const stage = STAGES[delivery.stage];
  const cancelled = delivery.stage === "cancelled";
  return (
    <article className="r-card overflow-hidden" style={primary && !cancelled ? { borderColor: "var(--r-brand)", borderWidth: 2 } : undefined} aria-label={`Order ${delivery.orderNumber}`}>
      <Link to={`/delivery/${delivery.orderId}`} className="r-focus block p-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-extrabold uppercase tracking-wider" style={{ color: cancelled ? "var(--r-red)" : "var(--r-brand-ink)" }}>
            {stage?.label || "Delivery"}
          </p>
          <StageBadge stage={delivery.stage} />
        </div>
        <h2 className="mt-1 text-[22px] font-black">Order #{delivery.orderNumber}</h2>
        <dl className="mt-2.5 space-y-2 text-[15px]">
          <div className="flex items-start gap-2.5">
            <dt className="sr-only">Customer</dt>
            <span className="r-faint mt-0.5">
              <Icon.user s={18} />
            </span>
            <dd className="font-bold">
              {delivery.customer.name}
              <span className="r-muted ml-2 font-semibold">{delivery.customer.phoneMasked}</span>
            </dd>
          </div>
          <div className="flex items-start gap-2.5">
            <dt className="sr-only">Address</dt>
            <span className="r-faint mt-0.5">
              <Icon.pin s={18} />
            </span>
            <dd className="font-semibold leading-snug">{delivery.address?.text || "Address on the order"}</dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {delivery.collect > 0 ? (
            <span className="rounded-xl px-3 py-1.5 text-[14px] font-black" style={{ background: "var(--r-amber-soft)", color: "var(--r-amber)" }}>
              Collect {rupees(delivery.collect)} cash
            </span>
          ) : (
            <span className="rounded-xl px-3 py-1.5 text-[14px] font-black" style={{ background: "var(--r-green-soft)", color: "var(--r-green)" }}>
              {rupees(delivery.bills.total)} · Paid
            </span>
          )}
          {delivery.distanceKm != null ? (
            <span className="r-muted rounded-xl px-3 py-1.5 text-[14px] font-bold" style={{ background: "var(--r-card-2)" }}>
              {delivery.distanceKm} km
            </span>
          ) : null}
        </div>
      </Link>
      {cancelled ? (
        <p className="px-4 pb-4 text-[14.5px] font-bold" style={{ color: "var(--r-red)" }}>
          Don’t deliver this one. If you already have the food, take it back to the store.
        </p>
      ) : (
        <div className="px-4 pb-4">
          <ActionButtons delivery={delivery} actions={actions} compact />
          <ActionSheets delivery={delivery} actions={actions} />
        </div>
      )}
    </article>
  );
}
