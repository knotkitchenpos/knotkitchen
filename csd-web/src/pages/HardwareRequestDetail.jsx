import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FiArrowLeft, FiCopy, FiPhone, FiSend } from "react-icons/fi";
import { hardwareRequests as hwApi, errorMessage } from "../api";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { dt, dOnly } from "../lib/format";

/**
 * One printer/tablet request. The next step for its status is the one big
 * button (accept, dispatch, deliver); cancelling refunds the store's wallet,
 * so only an admin sees it. Mutations answer with the whole request.
 */
const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 border-b border-navy-100 py-2.5 last:border-b-0">
    <dt className="text-xs font-semibold uppercase tracking-wider text-navy-500">{label}</dt>
    <dd className="text-right text-sm text-navy-900">{children || "—"}</dd>
  </div>
);

const Card = ({ title, children }) => (
  <section className="rounded-2xl border border-navy-200 bg-white p-5">
    <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-navy-700">{title}</h2>
    {children}
  </section>
);

const INPUT = "w-full rounded-xl border border-navy-200 px-3 py-2 text-sm outline-none focus:border-brand-500";
const PRIMARY = "rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50";
const SECONDARY = "rounded-xl border border-navy-300 bg-white px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-50";

const STEP = { REQUESTED: "Requested", ACCEPTED: "Accepted", DISPATCHED: "Dispatched", DELIVERED: "Delivered", CANCELLED: "Cancelled" };

const addressLines = (s) =>
  [s.name, s.phone, s.line1, s.line2, [s.city, s.state, s.postalCode].filter(Boolean).join(", ")].filter(Boolean);

const HardwareRequestDetail = () => {
  const { requestId } = useParams();
  const { isAdmin } = useAuth();
  const [r, setR] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dispatch, setDispatch] = useState({ courier: "", trackingNo: "", trackingUrl: "", expectedBy: "", note: "" });
  const [deliver, setDeliver] = useState({ deviceSerial: "", note: "" });
  const [note, setNote] = useState("");
  const [cancel, setCancel] = useState(null);
  const [copied, setCopied] = useState(false);

  const show = (d) => {
    setR(d);
    if (d.dispatch) {
      setDispatch((f) => ({
        ...f,
        courier: d.dispatch.courier || "",
        trackingNo: d.dispatch.trackingNo || "",
        trackingUrl: d.dispatch.trackingUrl || "",
        expectedBy: d.dispatch.expectedBy ? String(d.dispatch.expectedBy).slice(0, 10) : "",
      }));
    }
  };

  useEffect(() => {
    let alive = true;
    hwApi.get(requestId)
      .then((d) => alive && show(d))
      .catch((err) => alive && setError(errorMessage(err, "Could not load this request.")));
    return () => { alive = false; };
  }, [requestId]);

  const act = async (fn, failMsg) => {
    setBusy(true);
    setError("");
    try {
      show(await fn());
      return true;
    } catch (err) {
      setError(errorMessage(err, failMsg));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error && !r) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link to="/hardware" className="inline-flex items-center gap-1.5 text-sm text-navy-600 hover:text-navy-900">
          <FiArrowLeft aria-hidden="true" /> Back to hardware requests
        </Link>
        <p className="mt-6 text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!r) return <p className="text-sm text-navy-500">Loading request…</p>;

  const open = ["REQUESTED", "ACCEPTED", "DISPATCHED"].includes(r.status);
  const setD = (k) => (e) => setDispatch((f) => ({ ...f, [k]: e.target.value }));

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(addressLines(r.shipTo).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no clipboard permission: the address is on screen */
    }
  };

  const submitDispatch = async (e) => {
    e.preventDefault();
    // The note goes into the history once; the next save starts without it.
    if (await act(() => hwApi.dispatch(r.id, dispatch), "Could not save the dispatch.")) setDispatch((f) => ({ ...f, note: "" }));
  };
  const submitDeliver = (e) => {
    e.preventDefault();
    if (!window.confirm(`Mark ${r.requestNo} delivered? The store sees it as delivered.`)) return;
    act(() => hwApi.deliver(r.id, deliver), "Could not mark it delivered.");
  };
  const submitNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    if (await act(() => hwApi.note(r.id, note.trim()), "Could not add the note.")) setNote("");
  };
  const submitCancel = async (e) => {
    e.preventDefault();
    const refund = cancel.refund === "" ? "everything the store paid" : `₹${Number(cancel.refund)}`;
    if (!window.confirm(`Cancel ${r.requestNo} and refund ${refund} to the store's KnotKitchen wallet? This is audited.`)) return;
    if (await act(() => hwApi.cancel(r.id, { reason: cancel.reason, refund: cancel.refund }), "Could not cancel it.")) setCancel(null);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/hardware" className="inline-flex items-center gap-1.5 text-sm text-navy-600 hover:text-navy-900">
        <FiArrowLeft aria-hidden="true" /> Back to hardware requests
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-sm font-semibold text-brand-600">{r.requestNo}</span>
            <StatusBadge status={r.status.toLowerCase()} />
          </div>
          <h1 className="mt-1.5 text-2xl font-bold text-navy-900">{r.item.name}</h1>
          <p className="mt-1 text-sm text-navy-500">
            for{" "}
            <Link to={`/stores/${r.storeId}`} className="font-medium text-brand-600 hover:text-brand-700">
              {r.restaurantName || r.storeId}
            </Link>{" "}
            · <span className="font-mono">{r.storeId}</span> · requested {dt(r.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {r.status === "REQUESTED" && (
            <button type="button" disabled={busy} className={PRIMARY}
              onClick={() => act(() => hwApi.accept(r.id), "Could not accept it.")}>
              Accept request
            </button>
          )}
          {open && isAdmin && !cancel && (
            <button type="button" disabled={busy} className={`${SECONDARY} text-red-600`}
              onClick={() => setCancel({ reason: "", refund: "" })}>
              Cancel & refund
            </button>
          )}
        </div>
      </header>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {cancel && (
        <form onSubmit={submitCancel} className="mt-5 rounded-2xl border border-red-200 bg-red-50/50 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-red-700">Cancel and refund</h2>
          <p className="mt-1 text-sm text-navy-600">
            The refund goes to the store&apos;s KnotKitchen wallet (the store paid {r.payment.amount.label}
            {r.payment.method === "GATEWAY" ? " by card/UPI" : r.payment.method === "WALLET" ? " from its wallet" : ""}).
            {r.type === "TABLET" ? " The tablet rental stops now and the store gets its tablet top-up back." : " The printer is no longer counted as the store's."}
            {" "}Leave the amount empty to refund everything paid (for a tablet a renewal already billed, that share too).
            {" "}A full refund voids the invoice; a part refund is noted on it.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <input className={`${INPUT} sm:col-span-2`} placeholder="Reason (the store sees it)" value={cancel.reason}
              onChange={(e) => setCancel((c) => ({ ...c, reason: e.target.value }))} maxLength={300} required minLength={3} />
            <input className={INPUT} type="number" min="0" step="0.01"
              placeholder="Refund ₹ (empty: all of it)" value={cancel.refund}
              onChange={(e) => setCancel((c) => ({ ...c, refund: e.target.value }))} aria-label="Refund in rupees" />
          </div>
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={busy} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">
              Cancel and refund
            </button>
            <button type="button" disabled={busy} className={SECONDARY} onClick={() => setCancel(null)}>Keep it</button>
          </div>
        </form>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {(r.status === "ACCEPTED" || r.status === "DISPATCHED") && (
            <Card title={r.status === "DISPATCHED" ? "Update tracking" : "Dispatch"}>
              <form onSubmit={submitDispatch} className="grid gap-3 sm:grid-cols-2">
                <input className={INPUT} placeholder="Courier, or who is taking it" value={dispatch.courier} onChange={setD("courier")} required minLength={2} maxLength={60} />
                <input className={INPUT} placeholder="Tracking / AWB number" value={dispatch.trackingNo} onChange={setD("trackingNo")} maxLength={60} />
                <input className={INPUT} placeholder="Tracking link (https://…)" value={dispatch.trackingUrl} onChange={setD("trackingUrl")} maxLength={300} type="url" />
                <label className="flex items-center gap-2 text-sm text-navy-600">
                  Expected by
                  <input className={INPUT} type="date" value={dispatch.expectedBy} onChange={setD("expectedBy")} />
                </label>
                <input className={`${INPUT} sm:col-span-2`} placeholder="Note for the history (optional)" value={dispatch.note} onChange={setD("note")} maxLength={500} />
                <div className="sm:col-span-2">
                  <button type="submit" disabled={busy} className={PRIMARY}>
                    {r.status === "DISPATCHED" ? "Save tracking" : "Mark dispatched"}
                  </button>
                </div>
              </form>
            </Card>
          )}

          {(r.status === "ACCEPTED" || r.status === "DISPATCHED") && (
            <Card title="Delivered and set up">
              <form onSubmit={submitDeliver} className="grid gap-3 sm:grid-cols-2">
                <input className={INPUT} placeholder={r.type === "TABLET" ? "Device serial / IMEI" : "Printer serial number"} value={deliver.deviceSerial}
                  onChange={(e) => setDeliver((f) => ({ ...f, deviceSerial: e.target.value }))} maxLength={80} />
                <input className={INPUT} placeholder="Note (optional)" value={deliver.note}
                  onChange={(e) => setDeliver((f) => ({ ...f, note: e.target.value }))} maxLength={500} />
                <p className="text-xs text-navy-500 sm:col-span-2">
                  {r.type === "TABLET"
                    ? "Record the serial: the tablet is KnotKitchen's and comes back when the rental ends."
                    : "Record the serial for the warranty."}
                </p>
                <div className="sm:col-span-2">
                  <button type="submit" disabled={busy} className={PRIMARY}>Mark delivered</button>
                </div>
              </form>
            </Card>
          )}

          <Card title="Deliver to">
            <address className="not-italic text-sm leading-6 text-navy-900">
              {addressLines(r.shipTo).map((l) => <div key={l}>{l}</div>)}
            </address>
            {r.shipTo.note && <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{r.shipTo.note}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {r.shipTo.phone && (
                <a href={`tel:${r.shipTo.phone}`} className={`${SECONDARY} inline-flex items-center gap-2`}>
                  <FiPhone aria-hidden="true" /> Call
                </a>
              )}
              <button type="button" onClick={copyAddress} className={`${SECONDARY} inline-flex items-center gap-2`}>
                <FiCopy aria-hidden="true" /> {copied ? "Copied" : "Copy address"}
              </button>
            </div>
          </Card>

          <Card title="Internal notes">
            {r.notes.length === 0 ? (
              <p className="text-sm text-navy-400">None yet. Notes are never shown to the store.</p>
            ) : (
              <ul className="space-y-3">
                {r.notes.map((n) => (
                  <li key={n.id} className="rounded-xl bg-navy-50 px-3 py-2">
                    <p className="whitespace-pre-wrap text-sm text-navy-800">{n.body}</p>
                    <p className="mt-1 text-xs text-navy-400">{n.byName} · {dt(n.at)}</p>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={submitNote} className="mt-3 flex gap-2">
              <input className={INPUT} placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
              <button type="submit" disabled={busy || !note.trim()} className={`${PRIMARY} inline-flex items-center gap-2`} aria-label="Add note">
                <FiSend aria-hidden="true" />
              </button>
            </form>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Details">
            <dl>
              <Row label="Item">{r.item.name}</Row>
              <Row label="Paid">{r.payment.amount.label}</Row>
              <Row label="Paid via">{{ GATEWAY: "Card / UPI", WALLET: "Wallet", NONE: "Nothing (free)" }[r.payment.method]}</Row>
              {r.payment.gatewayOrderId && <Row label="Payment ref"><span className="font-mono text-xs">{r.payment.gatewayOrderId}</span></Row>}
              {r.dispatch && <Row label="Courier">{r.dispatch.courier}</Row>}
              {r.dispatch?.trackingNo && (
                <Row label="Tracking">
                  {r.dispatch.trackingUrl ? (
                    <a href={r.dispatch.trackingUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:text-brand-700">{r.dispatch.trackingNo}</a>
                  ) : r.dispatch.trackingNo}
                </Row>
              )}
              {r.dispatch?.expectedBy && <Row label="Expected by">{dOnly(r.dispatch.expectedBy)}</Row>}
              {r.deliveredAt && <Row label="Delivered">{dt(r.deliveredAt)}</Row>}
              {r.deviceSerial && <Row label="Device serial"><span className="font-mono text-xs">{r.deviceSerial}</span></Row>}
              {r.cancel && <Row label="Refunded">{r.cancel.refund.label}{r.cancel.settled ? "" : " (finishing)"}</Row>}
            </dl>
          </Card>

          <Card title="History">
            <ol className="space-y-3">
              {r.history.map((h, i) => (
                <li key={`${h.to}-${i}`} className="border-l-2 border-navy-200 pl-3">
                  <p className="text-sm font-semibold text-navy-900">{STEP[h.to] || h.to}</p>
                  <p className="text-xs text-navy-500">
                    {dt(h.at)} · {h.byType === "STORE" ? "Store" : h.byName || "KnotKitchen"}
                  </p>
                  {h.note && <p className="mt-0.5 text-sm text-navy-700">{h.note}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default HardwareRequestDetail;
